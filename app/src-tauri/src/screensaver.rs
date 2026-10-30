use serde::Serialize;
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::fs;
use std::io;
#[cfg(target_os = "macos")]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

const BUNDLE_ID: &str = "se.sandstream.lidscape.screensaver";
const LEGACY_BUNDLE_ID: &str = "se.sandstream.lidscape.saver";
const SAVER_NAME: &str = "LidscapeScreenSaver.saver";
const LEGACY_SAVER_NAME: &str = "Lidscape.saver";
const TEAM_ID: &str = "VDE8E369XE";
static NEXT_TRANSACTION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct ScreenSaverStatus {
    pub installed: bool,
    pub available: bool,
    #[serde(rename = "installationPending")]
    pub installation_pending: bool,
}

struct SaverPaths {
    source: PathBuf,
    installed: PathBuf,
    legacy_installed: PathBuf,
}

impl SaverPaths {
    fn for_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let source = resources.join(SAVER_NAME);
        #[cfg(debug_assertions)]
        let source = if source.exists() {
            source
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target/screensaver")
                .join(SAVER_NAME)
        };
        Ok(Self {
            source,
            installed: home.join("Library/Screen Savers").join(SAVER_NAME),
            legacy_installed: home.join("Library/Screen Savers").join(LEGACY_SAVER_NAME),
        })
    }
}

fn bundle_id(path: &Path) -> Option<String> {
    if !path.is_dir() || path.is_symlink() {
        return None;
    }
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(path.join("Contents/Info.plist"))
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn owned_bundle(path: &Path) -> bool {
    matches!(
        bundle_id(path).as_deref(),
        Some(BUNDLE_ID | LEGACY_BUNDLE_ID)
    )
}

fn current_bundle(path: &Path) -> bool {
    bundle_id(path).as_deref() == Some(BUNDLE_ID)
}

fn macos_27_or_newer() -> bool {
    let Ok(output) = Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    String::from_utf8_lossy(&output.stdout)
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 27)
}

fn status(paths: &SaverPaths) -> Result<ScreenSaverStatus, String> {
    Ok(ScreenSaverStatus {
        installed: current_bundle(&paths.installed) || owned_bundle(&paths.legacy_installed),
        available: macos_27_or_newer() && current_bundle(&paths.source),
        installation_pending: false,
    })
}

#[tauri::command]
pub fn screensaver_status(app: tauri::AppHandle) -> Result<ScreenSaverStatus, String> {
    status(&SaverPaths::for_app(&app)?)
}

fn request_install_with(
    paths: &SaverPaths,
    verify: impl Fn(&Path) -> Result<(), String>,
    open: impl Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if !current_bundle(&paths.source) {
        return Err("The Lidscape screen saver is missing from the app".into());
    }
    verify(&paths.source).map_err(|error| {
        if error == "LIDSCAPE_SAVER_UNVERIFIED" {
            "LIDSCAPE_SAVER_SOURCE_UNVERIFIED".into()
        } else {
            error
        }
    })?;
    let directory = paths
        .installed
        .parent()
        .ok_or("The screen saver has no parent directory")?;
    if path_exists(directory)? {
        real_directory(directory)?;
    }
    if path_exists(&paths.installed)? {
        verify(&paths.installed)
            .map_err(|error| format!("Cannot replace the screen saver: {error}"))?;
    }
    open(&paths.source)
}

fn request_install(paths: &SaverPaths) -> Result<(), String> {
    request_install_with(paths, verify_owned_bundle, |source| {
        let opened = Command::new("/usr/bin/open")
            .arg(source)
            .status()
            .map_err(|error| error.to_string())?;
        if !opened.success() {
            return Err("macOS could not open the screen saver installer".into());
        }
        Ok(())
    })
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Cannot inspect the screen saver: {error}")),
    }
}

fn real_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect the screen saver: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The screen saver must be a real directory, not a link".into());
    }
    Ok(())
}

fn verify_owned_bundle(path: &Path) -> Result<(), String> {
    real_directory(path)?;
    let identifier = bundle_id(path).ok_or("The screen saver has no valid identifier")?;
    if identifier != BUNDLE_ID && identifier != LEGACY_BUNDLE_ID {
        return Err("The screen saver at this location does not belong to Lidscape".into());
    }
    let requirement = format!("=anchor apple generic and identifier \"{identifier}\" and certificate leaf[subject.OU] = \"{TEAM_ID}\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists");
    let result = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict", "-R", &requirement])
        .arg(path)
        .output()
        .map_err(|error| format!("Cannot verify the screen saver: {error}"))?;
    if !result.status.success() {
        return Err("LIDSCAPE_SAVER_UNVERIFIED".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn rename_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
    unsafe extern "C" {
        fn renamex_np(source: *const i8, destination: *const i8, flags: u32) -> i32;
    }
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid source path"))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid destination path"))?;
    if unsafe { renamex_np(source.as_ptr(), destination.as_ptr(), 0x0000_0004) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_exclusive(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "The screen saver requires macOS",
    ))
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<PathBuf, String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let path = path
        .to_str()
        .ok_or("The screen saver path cannot be represented")?;
    let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), true);
    let mut destination = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut destination))
        .map_err(|error| format!("Cannot move the screen saver to Trash: {error}"))?;
    let destination = destination
        .and_then(|url| url.path())
        .ok_or("The screen saver moved to Trash, but its new path is unavailable")?;
    Ok(PathBuf::from(destination.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(_path: &Path) -> Result<PathBuf, String> {
    Err("The screen saver requires macOS".into())
}

fn transaction_dir(parent: &Path) -> Result<PathBuf, String> {
    real_directory(parent)?;
    for _ in 0..32 {
        let id = NEXT_TRANSACTION.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".lidscape-saver-{}-{id}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Cannot prepare screen saver removal: {error}")),
        }
    }
    Err("Cannot prepare screen saver removal".into())
}

fn uninstall_bundle_with(
    paths: &SaverPaths,
    verify: impl Fn(&Path) -> Result<(), String>,
    trash: impl Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let mut present = Vec::new();
    for path in [&paths.installed, &paths.legacy_installed] {
        if path_exists(path)? {
            let parent = path
                .parent()
                .ok_or("The screen saver has no parent directory")?;
            real_directory(parent)?;
            verify(path)?;
            present.push(path);
        }
    }
    if present.is_empty() {
        return Err("The screen saver is already absent. Refresh its status.".into());
    }
    let mut moved_count = 0;
    for path in present {
        let partial = if moved_count > 0 {
            " LIDSCAPE_SAVER_PARTIAL_REMOVAL"
        } else {
            ""
        };
        let parent = path
            .parent()
            .ok_or("The screen saver has no parent directory")?;
        let transaction = transaction_dir(parent).map_err(|error| format!("{error}{partial}"))?;
        let name = path
            .file_name()
            .ok_or("The screen saver has no file name")?;
        let staged = transaction.join(name);
        if let Err(error) = rename_exclusive(path, &staged) {
            let _ = fs::remove_dir(&transaction);
            return Err(format!("Cannot move the screen saver: {error}.{partial}"));
        }
        let moved = verify(&staged).and_then(|()| trash(&staged));
        if let Err(error) = moved {
            if path_exists(&staged)? {
                if let Err(restore) = rename_exclusive(&staged, path) {
                    return Err(format!(
                        "{error}. The screen saver remains at {}: {restore}.{partial}",
                        staged.display()
                    ));
                }
                let _ = fs::remove_dir(&transaction);
                return Err(format!(
                    "{error}. The screen saver remains installed.{partial}"
                ));
            }
            return Err(format!(
                "{error}. The screen saver is no longer at {}; check the Trash.{partial}",
                path.display()
            ));
        }
        if path_exists(&staged)? {
            return Err(format!(
                "The screen saver was not moved to Trash. It remains at {}.{partial}",
                staged.display()
            ));
        }
        let _ = fs::remove_dir(&transaction);
        moved_count += 1;
    }
    Ok(())
}

fn uninstall_bundle(paths: &SaverPaths) -> Result<(), String> {
    uninstall_bundle_with(paths, verify_owned_bundle, |path| {
        move_to_trash(path).map(|_| ())
    })
}

#[tauri::command]
pub fn install_screensaver(app: tauri::AppHandle) -> Result<ScreenSaverStatus, String> {
    let paths = SaverPaths::for_app(&app)?;
    if !macos_27_or_newer() {
        return Err("The screen saver needs macOS 27 or newer".into());
    }
    request_install(&paths)?;
    let mut current = status(&paths)?;
    current.installation_pending = !current.installed;
    Ok(current)
}

#[tauri::command]
pub fn uninstall_screensaver(app: tauri::AppHandle) -> Result<ScreenSaverStatus, String> {
    let paths = SaverPaths::for_app(&app)?;
    uninstall_bundle(&paths)?;
    status(&paths)
}

#[tauri::command]
pub fn open_screensaver_settings() -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::os::unix::fs::symlink;

    struct Fixture {
        root: PathBuf,
        paths: SaverPaths,
    }
    impl Fixture {
        fn new() -> Self {
            let id = NEXT_TRANSACTION.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "lidscape-saver-install-test-{}-{id}",
                std::process::id()
            ));
            let directory = root.join("Screen Savers");
            fs::create_dir_all(&directory).unwrap();
            Self {
                paths: SaverPaths {
                    source: root.join("source.saver"),
                    installed: directory.join(SAVER_NAME),
                    legacy_installed: directory.join(LEGACY_SAVER_NAME),
                },
                root,
            }
        }
        fn bundle(path: &Path, identifier: &str) {
            let info = path.join("Contents/Info.plist");
            fs::create_dir_all(info.parent().unwrap()).unwrap();
            fs::write(info, format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>{identifier}</string></dict></plist>")).unwrap();
        }
        fn trash(&self, path: &Path) -> Result<(), String> {
            fs::rename(path, self.root.join("trash-copy")).map_err(|error| error.to_string())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn fake_verify(path: &Path) -> Result<(), String> {
        real_directory(path)?;
        if owned_bundle(path) {
            Ok(())
        } else {
            Err("Foreign bundle".into())
        }
    }

    #[test]
    fn installation_opens_only_after_verifying_source_and_destination() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.source, BUNDLE_ID);
        let opened = Cell::new(false);
        let open = |_: &Path| -> Result<(), String> {
            opened.set(true);
            Ok(())
        };
        let result = request_install_with(
            &fixture.paths,
            |_| Err("LIDSCAPE_SAVER_UNVERIFIED".into()),
            open,
        );
        assert_eq!(result.unwrap_err(), "LIDSCAPE_SAVER_SOURCE_UNVERIFIED");
        assert!(!opened.get());
        Fixture::bundle(&fixture.paths.installed, "other.saver");
        assert!(request_install_with(&fixture.paths, fake_verify, open).is_err());
        assert!(!opened.get());
        assert!(fixture.paths.installed.is_dir());
        fs::remove_dir_all(&fixture.paths.installed).unwrap();
        symlink(&fixture.paths.source, &fixture.paths.installed).unwrap();
        assert!(request_install_with(&fixture.paths, fake_verify, open).is_err());
        assert!(!opened.get());
        fs::remove_file(&fixture.paths.installed).unwrap();
        request_install_with(&fixture.paths, fake_verify, open).unwrap();
        assert!(opened.get());
    }

    #[test]
    fn installation_rejects_a_linked_saver_directory_but_allows_a_missing_one() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.source, BUNDLE_ID);
        let directory = fixture.paths.installed.parent().unwrap();
        let outside = fixture.root.join("other-directory");
        fs::create_dir(&outside).unwrap();
        fs::remove_dir(directory).unwrap();
        symlink(&outside, directory).unwrap();
        let opened = Cell::new(false);
        let open = |_: &Path| -> Result<(), String> {
            opened.set(true);
            Ok(())
        };
        assert!(request_install_with(&fixture.paths, fake_verify, open).is_err());
        assert!(!opened.get());
        assert!(directory.is_symlink());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        fs::remove_file(directory).unwrap();
        fs::write(directory, b"not a directory").unwrap();
        assert!(request_install_with(&fixture.paths, fake_verify, open).is_err());
        assert!(!opened.get());
        assert_eq!(fs::read(directory).unwrap(), b"not a directory");
        fs::remove_file(directory).unwrap();
        request_install_with(&fixture.paths, fake_verify, open).unwrap();
        assert!(opened.get());
        assert!(!directory.exists());
    }

    #[test]
    fn status_does_not_remove_the_legacy_bundle() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        Fixture::bundle(&fixture.paths.legacy_installed, LEGACY_BUNDLE_ID);
        assert!(status(&fixture.paths).unwrap().installed);
        assert!(fixture.paths.installed.is_dir());
        assert!(fixture.paths.legacy_installed.is_dir());
    }

    #[test]
    fn absent_bundle_is_not_reported_as_moved_to_trash() {
        let fixture = Fixture::new();
        let error = uninstall_bundle_with(&fixture.paths, fake_verify, |path| fixture.trash(path))
            .unwrap_err();
        assert!(error.contains("already absent"));
        assert!(!fixture.root.join("trash-copy").exists());
    }

    #[test]
    fn refuses_unverified_foreign_and_symlinked_bundles_without_moving_them() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        assert!(uninstall_bundle(&fixture.paths).is_err());
        assert!(fixture.paths.installed.is_dir());
        Fixture::bundle(&fixture.paths.legacy_installed, "other.saver");
        assert!(
            uninstall_bundle_with(&fixture.paths, fake_verify, |path| fixture.trash(path)).is_err()
        );
        assert!(fixture.paths.installed.is_dir());
        assert!(fixture.paths.legacy_installed.is_dir());
        fs::remove_dir_all(&fixture.paths.legacy_installed).unwrap();
        symlink(&fixture.paths.installed, &fixture.paths.legacy_installed).unwrap();
        assert!(
            uninstall_bundle_with(&fixture.paths, fake_verify, |path| fixture.trash(path)).is_err()
        );
        assert!(fixture.paths.installed.is_dir());
        assert!(fixture.paths.legacy_installed.is_symlink());
    }

    #[test]
    fn failed_trash_and_failed_second_verification_restore_the_original() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        let result =
            uninstall_bundle_with(&fixture.paths, fake_verify, |_| Err("Trash failed".into()));
        assert!(result.is_err());
        assert!(fixture.paths.installed.is_dir());
        let calls = Cell::new(0);
        let result = uninstall_bundle_with(
            &fixture.paths,
            |path| {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    Err("The staged bundle changed".into())
                } else {
                    fake_verify(path)
                }
            },
            |path| fixture.trash(path),
        );
        assert!(result.is_err());
        assert!(fixture.paths.installed.is_dir());
        assert!(!fixture.root.join("trash-copy").exists());
    }

    #[test]
    fn reports_partial_removal_if_trash_fails_for_the_second_bundle() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        Fixture::bundle(&fixture.paths.legacy_installed, LEGACY_BUNDLE_ID);
        let count = Cell::new(0);
        let result = uninstall_bundle_with(&fixture.paths, fake_verify, |path| {
            count.set(count.get() + 1);
            if count.get() == 1 {
                fixture.trash(path)
            } else {
                Err("Trash failed".into())
            }
        });
        let error = result.unwrap_err();
        assert!(error.contains("LIDSCAPE_SAVER_PARTIAL_REMOVAL"));
        assert!(!fixture.paths.installed.exists());
        assert!(fixture.paths.legacy_installed.is_dir());
        assert!(fixture.root.join("trash-copy").is_dir());
    }

    #[test]
    fn reports_partial_removal_if_the_second_bundle_disappears() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        Fixture::bundle(&fixture.paths.legacy_installed, LEGACY_BUNDLE_ID);
        let result = uninstall_bundle_with(&fixture.paths, fake_verify, |path| {
            fixture.trash(path)?;
            fs::remove_dir_all(&fixture.paths.legacy_installed)
                .map_err(|error| error.to_string())?;
            Ok(())
        });
        assert!(result
            .unwrap_err()
            .contains("LIDSCAPE_SAVER_PARTIAL_REMOVAL"));
        assert!(fixture.root.join("trash-copy").is_dir());
    }

    #[test]
    fn moves_a_verified_bundle_to_a_recoverable_destination() {
        let fixture = Fixture::new();
        Fixture::bundle(&fixture.paths.installed, BUNDLE_ID);
        uninstall_bundle_with(&fixture.paths, fake_verify, |path| fixture.trash(path)).unwrap();
        assert!(!fixture.paths.installed.exists());
        assert!(fixture.root.join("trash-copy").is_dir());
    }

    #[test]
    #[ignore = "requires LIDSCAPE_SAVER_SIGNED_TEST_MODULE and a writable Trash"]
    fn macos_trash_can_recover_a_real_signed_bundle() {
        let fixture = Fixture::new();
        let source = std::env::var_os("LIDSCAPE_SAVER_SIGNED_TEST_MODULE")
            .expect("set LIDSCAPE_SAVER_SIGNED_TEST_MODULE");
        assert!(Command::new("/usr/bin/ditto")
            .arg(source)
            .arg(&fixture.paths.installed)
            .status()
            .unwrap()
            .success());
        let destination = RefCell::new(None);
        uninstall_bundle_with(&fixture.paths, verify_owned_bundle, |path| {
            destination.replace(Some(move_to_trash(path)?));
            Ok(())
        })
        .unwrap();
        let trashed = destination
            .into_inner()
            .expect("the real Trash returned a path");
        assert!(!fixture.paths.installed.exists());
        assert!(trashed.is_dir());
        verify_owned_bundle(&trashed).unwrap();
        fs::rename(&trashed, &fixture.paths.installed).unwrap();
        verify_owned_bundle(&fixture.paths.installed).unwrap();
    }

    #[test]
    #[ignore = "requires LIDSCAPE_SAVER_SIGNED_TEST_MODULE"]
    fn moves_a_real_developer_id_signed_bundle() {
        let fixture = Fixture::new();
        let source = std::env::var_os("LIDSCAPE_SAVER_SIGNED_TEST_MODULE")
            .expect("set LIDSCAPE_SAVER_SIGNED_TEST_MODULE");
        assert!(Command::new("/usr/bin/ditto")
            .arg(source)
            .arg(&fixture.paths.installed)
            .status()
            .unwrap()
            .success());
        verify_owned_bundle(&fixture.paths.installed).unwrap();
        uninstall_bundle_with(&fixture.paths, verify_owned_bundle, |path| {
            fixture.trash(path)
        })
        .unwrap();
        verify_owned_bundle(&fixture.root.join("trash-copy")).unwrap();
        assert!(!fixture.paths.installed.exists());
    }
}
