//! The wallpaper host has its own settings and a separate installation.
//! macOS remains responsible for choosing the active wallpaper.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::Manager;
use self::installer::BundleVerifier;

#[path = "../../../wallpaper/installation/installer.rs"]
mod installer;

const HOST_NAME: &str = "Lidscape Wallpaper.app";
const HOST_ARCHIVE: &str = "Lidscape Wallpaper.zip";
const GROUP: &str = "VDE8E369XE.se.sandstream.lidscape.wallpaper";
const SETTINGS_FILE: &str = "wallpaper-settings.json";
const EXTENSION_ID: &str = "se.sandstream.lidscape.wallpaper.extension";
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

// Keep a stable lock file so that different Lidscape processes share one lock.
// Never unlink it: a later process could otherwise lock a different inode.
struct WallpaperLock { _file: File }

impl WallpaperLock {
    #[cfg(target_os = "macos")]
    fn acquire(applications: &Path) -> Result<Self, String> {
        let metadata = fs::symlink_metadata(applications).map_err(|error| format!("Cannot inspect Applications: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("The Applications location must be a real directory".into());
        }
        let file = OpenOptions::new().read(true).write(true).create(true).mode(0o600)
            .custom_flags(0x00000100) // O_NOFOLLOW on macOS
            .open(applications.join(".lidscape-wallpaper.lock"))
            .map_err(|error| format!("Cannot open wallpaper operation lock: {error}"))?;
        if !file.metadata().map_err(|error| error.to_string())?.is_file() {
            return Err("The wallpaper operation lock is not a file".into());
        }
        unsafe extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
        // LOCK_EX | LOCK_NB. Return promptly when another operation is active.
        if unsafe { flock(file.as_raw_fd(), 0x02 | 0x04) } != 0 {
            return Err(format!("Another wallpaper operation is in progress or the lock failed: {}", std::io::Error::last_os_error()));
        }
        Ok(Self { _file: file })
    }

    #[cfg(not(target_os = "macos"))]
    fn acquire(_applications: &Path) -> Result<Self, String> { Err("Wallpaper requires macOS".into()) }
}

impl Drop for WallpaperLock {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
            // LOCK_UN releases the shared lock even if a descriptor was copied.
            let _ = unsafe { flock(self._file.as_raw_fd(), 0x08) };
        }
    }
}

#[derive(Debug)]
enum RollbackError { Unregister(String), Restore(String) }

// The restore closure must not run unless the old registration is confirmed absent.
fn restore_after_unregistration<T>(
    check: impl Fn() -> Result<bool, String>,
    unregister: impl FnOnce() -> Result<(), String>,
    restore: impl FnOnce() -> Result<T, String>,
) -> Result<T, RollbackError> {
    if check().map_err(RollbackError::Unregister)? {
        unregister().map_err(RollbackError::Unregister)?;
    }
    if check().map_err(RollbackError::Unregister)? {
        return Err(RollbackError::Unregister("The registration is still present".into()));
    }
    restore().map_err(RollbackError::Restore)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WallpaperSettings {
    city: String,
    theme: String,
    variant: String,
}

impl Default for WallpaperSettings {
    fn default() -> Self {
        Self { city: "stockholm".into(), theme: "paper".into(), variant: String::new() }
    }
}

#[derive(Deserialize)]
struct OptionItem { id: String }

#[derive(Deserialize)]
struct Options { cities: Vec<OptionItem>, themes: Vec<OptionItem>, variants: Vec<OptionItem> }

impl Options {
    fn accepts(&self, value: &WallpaperSettings) -> bool {
        self.cities.iter().any(|item| item.id == value.city)
            && self.themes.iter().any(|item| item.id == value.theme)
            && (value.variant.is_empty() || self.variants.iter().any(|item| item.id == value.variant))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperStatus {
    available: bool,
    installed: bool,
    selection: &'static str,
    registration: &'static str,
    can_uninstall: bool,
    update_available: bool,
    has_backups: bool,
    settings: Option<WallpaperSettings>,
}

struct Paths { source: PathBuf, applications: PathBuf, version: String }

impl Paths {
    fn for_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let home = app.path().home_dir().map_err(|error| error.to_string())?;
        let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
        let source = resources.join(HOST_ARCHIVE);
        #[cfg(debug_assertions)]
        let source = if source.exists() { source } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/wallpaper").join(HOST_ARCHIVE)
        };
        Ok(Self { source, applications: home.join("Applications"), version: app.package_info().version.to_string() })
    }
    fn installed(&self) -> PathBuf { self.applications.join(HOST_NAME) }
}

fn options(host: &Path) -> Result<Options, String> {
    let path = host.join("Contents/Extensions/LidscapeWallpaperExtension.appex/Contents/Resources/options.json");
    let data = fs::read(&path).map_err(|error| format!("Cannot read wallpaper choices: {error}"))?;
    serde_json::from_slice(&data).map_err(|error| format!("Invalid wallpaper choices: {error}"))
}

#[cfg(target_os = "macos")]
fn settings_dir() -> Result<PathBuf, String> {
    use objc2_foundation::{NSFileManager, NSString};
    let group = NSString::from_str(GROUP);
    let url = NSFileManager::defaultManager().containerURLForSecurityApplicationGroupIdentifier(&group)
        .ok_or("The wallpaper settings container is unavailable")?;
    let path = url.path().ok_or("The wallpaper settings container has no path")?;
    Ok(PathBuf::from(path.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn settings_dir() -> Result<PathBuf, String> { Err("Wallpaper requires macOS".into()) }

fn load_settings(dir: &Path, choices: &Options) -> Result<WallpaperSettings, String> {
    let path = dir.join(SETTINGS_FILE);
    let value = match fs::read(path) {
        Ok(data) => serde_json::from_slice(&data).map_err(|error| format!("Invalid wallpaper settings: {error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => WallpaperSettings::default(),
        Err(error) => return Err(format!("Cannot read wallpaper settings: {error}")),
    };
    if !choices.accepts(&value) { return Err("The saved wallpaper choice is unavailable".into()); }
    Ok(value)
}

fn save_settings(dir: &Path, choices: &Options, value: &WallpaperSettings) -> Result<(), String> {
    if !choices.accepts(value) { return Err("The wallpaper choice is unavailable".into()); }
    if !dir.is_dir() { return Err("The wallpaper settings container is unavailable".into()); }
    let data = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let path = dir.join(format!(".wallpaper-{}-{}.tmp", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&path)
            .map_err(|error| format!("Cannot create wallpaper settings: {error}"))?;
        file.write_all(&data).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&path, dir.join(SETTINGS_FILE)).map_err(|error| format!("Cannot save wallpaper settings: {error}"))
    })();
    if result.is_err() { let _ = fs::remove_file(path); }
    result
}

fn supported() -> bool {
    Command::new("/usr/bin/sw_vers").arg("-productVersion").output().ok().filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.split('.').next()?.parse::<u32>().ok())
        .is_some_and(|major| major >= 27)
}

// The archive is a sealed resource of the signed Lidscape app. Verify that
// signature before extracting it, then verify the embedded host separately.
fn verify_running_app() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundle = executable.parent().and_then(Path::parent).and_then(Path::parent)
        .ok_or("Cannot locate the signed Lidscape app")?;
    let requirement = "=anchor apple generic and identifier \"se.sandstream.lidscape\" and certificate leaf[subject.OU] = \"VDE8E369XE\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
    let result = Command::new("/usr/bin/codesign").args(["--verify", "--strict", "-R", requirement])
        .arg(bundle).output().map_err(|error| format!("Cannot verify Lidscape: {error}"))?;
    if !result.status.success() { return Err("Install the signed Lidscape app before installing its wallpaper".into()); }
    Ok(())
}

struct ExtractedHost { dir: PathBuf }
impl Drop for ExtractedHost {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.dir); }
}
impl ExtractedHost {
    fn from_archive(archive: &Path) -> Result<Self, String> {
        let root = std::env::temp_dir();
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        let dir = root.join(format!("lidscape-wallpaper-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        builder.create(&dir).map_err(|error| format!("Cannot prepare wallpaper: {error}"))?;
        let extracted = Self { dir };
        let result = Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(archive).arg(&extracted.dir)
            .status().map_err(|error| format!("Cannot unpack wallpaper: {error}"))?;
        if !result.success() { return Err("Cannot unpack wallpaper".into()); }
        installer::MacBundleVerifier.verify(&extracted.host())?;
        Ok(extracted)
    }
    fn host(&self) -> PathBuf { self.dir.join(HOST_NAME) }
}

fn update_needed(installed: &str, bundled: &str) -> bool {
    fn numbers(version: &str) -> Option<Vec<u32>> {
        version.split('.').map(|part| part.parse::<u32>().ok()).collect()
    }
    match (numbers(installed), numbers(bundled)) {
        (Some(installed), Some(bundled)) => bundled > installed,
        _ => true,
    }
}

fn installed_version(host: &Path) -> Option<String> {
    let result = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
        .arg(host.join("Contents/Info.plist")).output().ok()?;
    if !result.status.success() { return None; }
    Some(String::from_utf8(result.stdout).ok()?.trim().to_string())
}

fn status(paths: &Paths) -> Result<WallpaperStatus, String> {
    let available = supported() && paths.source.is_file();
    let installed = if paths.applications.is_dir() {
        match installer::Installer::new(paths.applications.clone(), installer::MacBundleVerifier)?.status()?.installation {
            installer::Installation::Owned => true,
            installer::Installation::Missing => false,
            installer::Installation::Other => return Err("Another app uses the Lidscape wallpaper location".into()),
        }
    } else { false };
    let settings = if installed {
        options(&paths.installed()).and_then(|choices| load_settings(&settings_dir()?, &choices)).ok()
    } else { None };
    let registration = if installed {
        match registered_at(&paths.installed().join("Contents/Extensions/LidscapeWallpaperExtension.appex")) {
            Ok(true) => "registered",
            Ok(false) => "missing",
            Err(_) => "unknown",
        }
    } else { "missing" };
    let update_available = available && installed && installed_version(&paths.installed())
        .map_or(true, |version| update_needed(&version, &paths.version));
    let has_backups = if paths.applications.is_dir() {
        installer::Installer::new(paths.applications.clone(), installer::MacBundleVerifier)?.has_backups()
    } else { false };
    Ok(WallpaperStatus { available, installed, selection: "unknown", registration, can_uninstall: installed, update_available, has_backups, settings })
}

#[tauri::command]
pub fn wallpaper_status(app: tauri::AppHandle) -> Result<WallpaperStatus, String> {
    status(&Paths::for_app(&app)?)
}

fn install(paths: &Paths) -> Result<WallpaperStatus, String> {
    if !supported() { return Err("The wallpaper needs macOS 27 or newer".into()); }
    fs::create_dir_all(&paths.applications).map_err(|error| error.to_string())?;
    let _lock = WallpaperLock::acquire(&paths.applications)?;
    let installer = installer::Installer::new(paths.applications.clone(), installer::MacBundleVerifier)?;
    if installer.status()?.installation != installer::Installation::Owned {
        verify_running_app()?;
        let host = ExtractedHost::from_archive(&paths.source)?;
        installer.install(&host.host(), installer::WallpaperUse::Unknown)?;
    }
    register(paths)?;
    status(paths)
}

fn register(paths: &Paths) -> Result<(), String> {
    installer::MacBundleVerifier.verify(&paths.installed())?;
    let result = Command::new("/usr/bin/open").args(["-g", "-j"]).arg(paths.installed())
        .args(["--args", "--register-only"]).status().map_err(|error| error.to_string())?;
    if !result.success() { return Err("The wallpaper was copied but macOS could not open it".into()); }
    let extension = paths.installed().join("Contents/Extensions/LidscapeWallpaperExtension.appex");
    let deadline = Instant::now() + Duration::from_secs(12);
    while !registered_at(&extension)? {
        if Instant::now() >= deadline {
            return Err("The wallpaper was copied, but macOS has not discovered its extension. Try again.".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_wallpaper(app: tauri::AppHandle) -> Result<WallpaperStatus, String> {
    let paths = Paths::for_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || install(&paths)).await.map_err(|error| error.to_string())?
}

fn update(paths: &Paths) -> Result<WallpaperStatus, String> {
    if !supported() || !paths.source.is_file() { return Err("The wallpaper update is unavailable".into()); }
    let _lock = WallpaperLock::acquire(&paths.applications)?;
    let installer = installer::Installer::new(paths.applications.clone(), installer::MacBundleVerifier)?;
    installer.preserve_pending_backups()?;
    if installer.status()?.installation != installer::Installation::Owned {
        return Err("Install the wallpaper before updating it".into());
    }
    verify_running_app()?;
    let host = ExtractedHost::from_archive(&paths.source)?;
    let extension = paths.installed().join("Contents/Extensions/LidscapeWallpaperExtension.appex");
    if registration_at(&extension, false)? {
        let result = Command::new("/usr/bin/pluginkit").arg("-r").arg(&extension).status()
            .map_err(|error| format!("Cannot unregister the wallpaper: {error}"))?;
        if !result.success() || !matches!(registration_at(&extension, false), Ok(false)) {
            let _ = register(paths);
            return Err("Cannot confirm that macOS unregistered the wallpaper. Check its status and try again.".into());
        }
    }
    let backup = match installer.install(&host.host(), installer::WallpaperUse::UserConfirmedOtherWallpaper) {
        Ok(Some(backup)) => backup,
        Ok(None) => return Err("The previous wallpaper app disappeared during the update. Refresh its status.".into()),
        Err(error) => {
            let restored = register(paths);
            return Err(format!("Cannot update the wallpaper: {error}. Registration of the previous app: {}", if restored.is_ok() { "restored" } else { "not verified; retry registration" }));
        }
    };
    if let Err(error) = register(paths) {
        let rollback = restore_after_unregistration(
            || registration_at(&extension, false),
            || {
                let result = Command::new("/usr/bin/pluginkit").arg("-r").arg(&extension).status()
                    .map_err(|error| format!("Cannot unregister the update: {error}"))?;
                if !result.success() { return Err("macOS could not unregister the update".into()); }
                Ok(())
            },
            || installer.restore_backup(&backup, installer::WallpaperUse::UserConfirmedOtherWallpaper),
        );
        return match rollback {
            Ok(displaced) => {
                let restored = register(paths);
                let saved = displaced.map(|path| match installer.make_backup_visible(&path) {
                    Ok(visible) => format!("; new app saved at {}", visible.display()),
                    Err(detail) => format!("; cannot move the new app to the backup folder: {detail}"),
                }).unwrap_or_default();
                Err(format!("Cannot register the update: {error}. Previous app restored{saved}; registration {}.",
                    if restored.is_ok() { "restored" } else { "not verified; retry registration" }))
            }
            Err(RollbackError::Unregister(detail)) => {
                let location = match installer.make_backup_visible(&backup) {
                    Ok(visible) => visible.display().to_string(),
                    Err(reason) => format!("{} ({reason})", backup.display()),
                };
                Err(format!("Cannot register the update: {error}. Cannot verify removal of the new registration: {detail}. The new app remains at {}. The previous app remains at {location}.", paths.installed().display()))
            },
            Err(RollbackError::Restore(detail)) => Err(format!("Cannot register the update: {error}. Cannot restore the previous app from {}: {detail}", backup.display())),
        };
    }
    installer.make_backup_visible(&backup).map_err(|error| format!(
        "The wallpaper was updated, but its previous version could not be moved to the backup folder: {error}"
    ))?;
    status(paths)
}

#[tauri::command]
pub async fn update_wallpaper(app: tauri::AppHandle, confirmed_unused: bool) -> Result<WallpaperStatus, String> {
    if !confirmed_unused { return Err("Choose another wallpaper on all displays and Spaces first".into()); }
    let paths = Paths::for_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || update(&paths)).await.map_err(|error| error.to_string())?
}

fn matches_entry(output: &str, expected: &Path, require_enabled: bool) -> bool {
    output.lines().any(|line| {
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() < 4 { return false; }
        let id = fields[0].trim();
        if require_enabled && id.starts_with('-') { return false; }
        let id = id.strip_prefix('+').or_else(|| id.strip_prefix('-')).unwrap_or(id).trim();
        id.starts_with(&format!("{EXTENSION_ID}(")) && Path::new(fields[fields.len() - 1].trim()) == expected
    })
}

fn registered_at(path: &Path) -> Result<bool, String> {
    registration_at(path, true)
}

fn registration_at(path: &Path, require_enabled: bool) -> Result<bool, String> {
    let result = Command::new("/usr/bin/pluginkit").args(["-m", "-A", "-D", "-v", "-i", EXTENSION_ID])
        .output().map_err(|error| format!("Cannot check wallpaper registration: {error}"))?;
    if !result.status.success() { return Err("Cannot check wallpaper registration".into()); }
    Ok(matches_entry(&String::from_utf8_lossy(&result.stdout), path, require_enabled))
}

#[tauri::command]
pub fn save_wallpaper_settings(app: tauri::AppHandle, settings: WallpaperSettings) -> Result<WallpaperStatus, String> {
    let paths = Paths::for_app(&app)?;
    let _lock = WallpaperLock::acquire(&paths.applications)?;
    if !status(&paths)?.installed { return Err("Install the wallpaper first".into()); }
    save_settings(&settings_dir()?, &options(&paths.installed())?, &settings)?;
    status(&paths)
}

fn recover_and_open_backups(
    preserve: impl FnOnce() -> Result<(), String>,
    open: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let preserved = preserve();
    let opened = open();
    match (preserved, opened) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(format!("The backup folder opened, but some unfinished backups need attention: {error}")),
        (Ok(()), Err(error)) => Err(error),
        (Err(preserve), Err(open)) => Err(format!("Cannot preserve unfinished backups: {preserve}. Cannot open the backup folder: {open}")),
    }
}

fn open_location(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    let result = Command::new("/usr/bin/open").arg(target).status().map_err(|error| error.to_string())?;
    if !result.success() { return Err("macOS could not open the requested location".into()); }
    Ok(())
}

#[tauri::command]
pub async fn open_wallpaper_settings(app: tauri::AppHandle, backups: Option<bool>) -> Result<(), String> {
    let paths = if backups.unwrap_or(false) { Some(Paths::for_app(&app)?) } else { None };
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(paths) = paths {
            fs::create_dir_all(&paths.applications).map_err(|error| error.to_string())?;
            let _lock = WallpaperLock::acquire(&paths.applications)?;
            let installer = installer::Installer::new(paths.applications, installer::MacBundleVerifier)?;
            let directory = installer.ensure_backup_dir()?;
            recover_and_open_backups(|| installer.preserve_pending_backups(), || open_location(&directory))
        } else {
            open_location("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension")
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn uninstall_wallpaper(app: tauri::AppHandle, confirmed_unused: bool) -> Result<WallpaperStatus, String> {
    if !confirmed_unused { return Err("Choose another wallpaper on all displays and Spaces first".into()); }
    let paths = Paths::for_app(&app)?;
    let _lock = WallpaperLock::acquire(&paths.applications)?;
    let installer = installer::Installer::new(paths.applications.clone(), installer::MacBundleVerifier)?;
    match installer.status()?.installation {
        installer::Installation::Missing => return Err("The wallpaper app is already absent. Refresh its status.".into()),
        installer::Installation::Other => return Err("Another app uses the Lidscape wallpaper location".into()),
        installer::Installation::Owned => {
        installer::MacBundleVerifier.verify(&paths.installed())?;
        let extension = paths.installed().join("Contents/Extensions/LidscapeWallpaperExtension.appex");
        if registration_at(&extension, false)? {
            let result = Command::new("/usr/bin/pluginkit").arg("-r").arg(&extension).status()
                .map_err(|error| format!("Cannot unregister the wallpaper: {error}"))?;
            let check = registration_at(&extension, false);
            if !result.success() || !matches!(check, Ok(false)) {
                let restored = Command::new("/usr/bin/pluginkit").arg("-a").arg(&extension).status();
                let detail = if restored.is_ok_and(|status| status.success()) && matches!(registration_at(&extension, false), Ok(true)) {
                    "The previous registration was restored."
                } else { "Open Lidscape Wallpaper again to restore its registration." };
                return Err(format!("macOS could not verify removal of the wallpaper registration. {detail}"));
            }
        }
        let removed = match installer.remove(installer::WallpaperUse::UserConfirmedOtherWallpaper) {
            Ok(removed) => removed,
            Err(error) => {
                let restored = Command::new("/usr/bin/pluginkit").arg("-a").arg(&extension).status();
                let detail = if restored.is_ok_and(|status| status.success()) && matches!(registration_at(&extension, false), Ok(true)) {
                    "The previous registration was restored."
                } else { "Open Lidscape Wallpaper again to restore its registration." };
                return Err(format!("{error}. {detail}"));
            }
        };
        let removed = removed.ok_or("The wallpaper app disappeared before it could be moved. Refresh its status.")?;
        if !matches!(registration_at(&extension, false), Ok(false)) {
            let location = removed.display().to_string();
            return Err(format!("The app moved to {location}, but macOS could not confirm that its extension was removed."));
        }
        }
    }
    status(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choices() -> Options {
        serde_json::from_str(r#"{"cities":[{"id":"stockholm"}],"themes":[{"id":"paper"},{"id":"miniature"}],"variants":[{"id":"christmas"}]}"#).unwrap()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn operation_lock_prevents_overlapping_changes_and_releases() {
        let dir = std::env::temp_dir().join(format!("lidscape-operation-lock-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        let first = WallpaperLock::acquire(&dir).unwrap();
        assert!(WallpaperLock::acquire(&dir).is_err());
        let child = |expected: &str| Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "wallpaper::tests::operation_lock_child_probe"])
            .env("LIDSCAPE_TEST_LOCK_DIR", &dir)
            .env("LIDSCAPE_TEST_LOCK_EXPECTED", expected)
            .output().unwrap();
        assert!(child("busy").status.success());
        // Another thread may spawn a child while this descriptor is open.
        // A copied descriptor must not extend the lock after the guard ends.
        let duplicated = first._file.try_clone().unwrap();
        drop(first);
        assert!(WallpaperLock::acquire(&dir).is_ok());
        drop(duplicated);
        assert!(child("free").status.success());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn operation_lock_child_probe() {
        let Some(dir) = std::env::var_os("LIDSCAPE_TEST_LOCK_DIR") else { return; };
        let expected = std::env::var("LIDSCAPE_TEST_LOCK_EXPECTED").unwrap();
        assert_eq!(WallpaperLock::acquire(Path::new(&dir)).is_ok(), expected == "free");
    }

    #[test]
    fn backup_folder_opens_even_when_a_pending_copy_is_damaged() {
        use std::cell::Cell;
        let opened = Cell::new(false);
        let error = recover_and_open_backups(
            || Err("Original remains at /example/previous-backup".into()),
            || { opened.set(true); Ok(()) },
        ).unwrap_err();
        assert!(opened.get());
        assert!(error.contains("backup folder opened"));
        assert!(error.contains("/example/previous-backup"));
    }

    #[test]
    fn backup_folder_reports_both_recovery_and_open_errors() {
        let error = recover_and_open_backups(
            || Err("Cannot preserve original".into()),
            || Err("Finder unavailable".into()),
        ).unwrap_err();
        assert!(error.contains("Cannot preserve original"));
        assert!(error.contains("Finder unavailable"));
        assert!(!error.contains("backup folder opened"));
    }

    #[test]
    fn rollback_never_restores_until_registration_is_confirmed_absent() {
        use std::cell::Cell;
        let present = Cell::new(true);
        let restored = Cell::new(false);
        let failed = restore_after_unregistration(
            || Ok(present.get()),
            || Err("failed".into()),
            || { restored.set(true); Ok(()) },
        );
        assert!(matches!(failed, Err(RollbackError::Unregister(_))));
        assert!(!restored.get());
        let still_present = restore_after_unregistration(
            || Ok(present.get()),
            || Ok(()),
            || { restored.set(true); Ok(()) },
        );
        assert!(matches!(still_present, Err(RollbackError::Unregister(_))));
        assert!(!restored.get());
        let succeeded = restore_after_unregistration(
            || Ok(present.get()),
            || { present.set(false); Ok(()) },
            || { restored.set(true); Ok(()) },
        );
        assert!(succeeded.is_ok());
        assert!(restored.get());
    }

    #[test]
    fn detects_newer_versions_without_downgrading() {
        assert!(update_needed("0.1.0", "0.2.0"));
        assert!(!update_needed("0.2.0", "0.2.0"));
        assert!(!update_needed("0.3.0", "0.2.0"));
        assert!(update_needed("unknown", "0.2.0"));
    }

    #[test]
    fn settings_round_trip_and_reject_invalid_values() {
        let dir = std::env::temp_dir().join(format!("lidscape-wallpaper-settings-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        let valid = WallpaperSettings { city: "stockholm".into(), theme: "miniature".into(), variant: "christmas".into() };
        assert_eq!(load_settings(&dir, &choices()).unwrap(), WallpaperSettings::default());
        save_settings(&dir, &choices(), &valid).unwrap();
        assert_eq!(load_settings(&dir, &choices()).unwrap(), valid);
        let invalid = WallpaperSettings { city: "unknown".into(), ..valid.clone() };
        assert!(save_settings(&dir, &choices(), &invalid).is_err());
        assert_eq!(load_settings(&dir, &choices()).unwrap(), valid);
        fs::write(dir.join(SETTINGS_FILE), b"broken").unwrap();
        assert!(load_settings(&dir, &choices()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn registration_must_match_the_enabled_id_and_exact_path() {
        let path = Path::new("/Users/test/Applications/Lidscape Wallpaper.app/Contents/Extensions/LidscapeWallpaperExtension.appex");
        let line = format!("    {EXTENSION_ID}(1)\tUUID\tdate\t{}", path.display());
        assert!(matches_entry(&line, path, true));
        assert!(!matches_entry(&line.replace(EXTENSION_ID, "other.extension"), path, true));
        let disabled = line.replace("    ", " -  ");
        assert!(!matches_entry(&disabled, path, true));
        assert!(matches_entry(&disabled, path, false));
        assert!(!matches_entry(&line, Path::new("/other"), true));
        assert!(!matches_entry("(no matches)", path, false));
    }
}
