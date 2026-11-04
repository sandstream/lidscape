//! Filesystem operations for an independently packaged wallpaper host.
//!
//! The caller must establish whether the wallpaper is selected. This module
//! cannot inspect or change macOS wallpaper settings, register extensions, or
//! restore a previous wallpaper. Do not wire it into a UI until those flows
//! have been verified on macOS.

#[cfg(target_os = "macos")]
use std::ffi::{CStr, CString};
use std::fs::{self, OpenOptions};
use std::io;
#[cfg(target_os = "macos")]
use std::os::unix::ffi::{OsStrExt, OsStringExt};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

pub const BUNDLE_ID: &str = "se.sandstream.lidscape.wallpaper";
pub const TEAM_ID: &str = "VDE8E369XE";
// Require an Apple-issued Developer ID Application certificate as well as the
// team and identifier. A self-signed certificate can claim the same fields.
#[cfg(target_os = "macos")]
fn signing_requirement() -> String {
    format!("=anchor apple generic and identifier \"{BUNDLE_ID}\" and certificate leaf[subject.OU] = \"{TEAM_ID}\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists")
}
const APP_NAME: &str = "Lidscape Wallpaper.app";
const BACKUP_DIR: &str = "Lidscape Wallpaper Backups";
static NONCE: AtomicU64 = AtomicU64::new(0);

/// A user confirmation is not proof obtained from macOS.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WallpaperUse {
    UserConfirmedOtherWallpaper,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Installation {
    Missing,
    Owned,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WallpaperStatus {
    pub installation: Installation,
    /// Selection cannot be determined by this filesystem component.
    pub selected: WallpaperUse,
}

/// Validates ownership before an existing app is moved or removed.
pub trait BundleVerifier {
    fn verify(&self, bundle: &Path) -> Result<(), String>;
}

/// Verify the complete signature against an Apple Developer ID requirement.
pub struct MacBundleVerifier;

impl BundleVerifier for MacBundleVerifier {
    #[cfg(target_os = "macos")]
    fn verify(&self, bundle: &Path) -> Result<(), String> {
        require_real_directory(bundle)?;
        let verified = Command::new("/usr/bin/codesign")
            .args([
                "--verify",
                "--deep",
                "--strict",
                "-R",
                &signing_requirement(),
            ])
            .arg(bundle)
            .output()
            .map_err(|e| format!("Cannot run codesign: {e}"))?;
        if !verified.status.success() {
            return Err(
                "The wallpaper app does not have a valid Lidscape Developer ID signature".into(),
            );
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    fn verify(&self, _bundle: &Path) -> Result<(), String> {
        Err("Wallpaper installation requires macOS".into())
    }
}

fn require_real_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Cannot inspect app: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The wallpaper app must be a real directory".into());
    }
    Ok(())
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Cannot inspect app location: {e}")),
    }
}

fn require_user_confirmation(usage: WallpaperUse) -> Result<(), String> {
    if usage != WallpaperUse::UserConfirmedOtherWallpaper {
        return Err("Confirm that another wallpaper is selected on every display and Space".into());
    }
    Ok(())
}

// Prevent a newly created destination from being overwritten between checks.
// This module targets macOS and requires its exclusive rename operation.
#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    unsafe extern "C" {
        fn renamex_np(from: *const i8, to: *const i8, flags: u32) -> i32;
    }
    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid source path"))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid destination path"))?;
    // RENAME_EXCL fails if the destination already exists.
    let result = unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 0x0000_0004) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_exclusive(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Wallpaper installation requires macOS",
    ))
}

// Ask Finder's file manager to place the verified bundle in the user's Trash.
// The returned URL is needed to identify the recoverable copy.
#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<PathBuf, String> {
    use std::ffi::{c_char, c_void};
    type Id = *mut c_void;
    type Sel = *mut c_void;
    #[link(name = "Foundation", kind = "framework")]
    unsafe extern "C" {}
    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
    }
    let path =
        CString::new(path.as_os_str().as_bytes()).map_err(|_| "Invalid app path".to_string())?;
    unsafe {
        let send0: unsafe extern "C" fn(Id, Sel) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        let send_url: unsafe extern "C" fn(Id, Sel, *const c_char, bool, Id) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        let send_trash: unsafe extern "C" fn(Id, Sel, Id, *mut Id, *mut Id) -> bool =
            std::mem::transmute(objc_msgSend as *const ());
        let send_path: unsafe extern "C" fn(Id, Sel) -> *const c_char =
            std::mem::transmute(objc_msgSend as *const ());
        let class = |name: &CStr| objc_getClass(name.as_ptr());
        let sel = |name: &CStr| sel_registerName(name.as_ptr());
        let pool = send0(class(c"NSAutoreleasePool"), sel(c"new"));
        let url = send_url(
            class(c"NSURL"),
            sel(c"fileURLWithFileSystemRepresentation:isDirectory:relativeToURL:"),
            path.as_ptr(),
            true,
            std::ptr::null_mut(),
        );
        let manager = send0(class(c"NSFileManager"), sel(c"defaultManager"));
        let mut result_url: Id = std::ptr::null_mut();
        let ok = send_trash(
            manager,
            sel(c"trashItemAtURL:resultingItemURL:error:"),
            url,
            &mut result_url,
            std::ptr::null_mut(),
        );
        let result = if ok && !result_url.is_null() {
            let bytes = send_path(result_url, sel(c"fileSystemRepresentation"));
            if bytes.is_null() {
                Err("The app moved to Trash, but its new path is unavailable".into())
            } else {
                Ok(PathBuf::from(std::ffi::OsString::from_vec(
                    CStr::from_ptr(bytes).to_bytes().to_vec(),
                )))
            }
        } else if ok {
            Err("The app moved to Trash, but its new path is unavailable".into())
        } else {
            Err("Cannot move the wallpaper app to Trash".into())
        };
        let send_void: unsafe extern "C" fn(Id, Sel) =
            std::mem::transmute(objc_msgSend as *const ());
        send_void(pool, sel(c"drain"));
        result
    }
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(_path: &Path) -> Result<PathBuf, String> {
    Err("Wallpaper installation requires macOS".into())
}

// Verification extracts outside Applications so that macOS does not discover
// a second copy of the extension. Each temporary directory is private to this
// process and removed when verification finishes.
struct VerificationDirectory(PathBuf);
impl VerificationDirectory {
    fn create() -> Result<Self, String> {
        for _ in 0..32 {
            let id = NONCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("lidscape-backup-check-{}-{id}", std::process::id()));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            builder.mode(0o700);
            match builder.create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Cannot prepare backup verification: {error}")),
            }
        }
        Err("Cannot prepare backup verification".into())
    }
}
impl Drop for VerificationDirectory {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

/// Stages a complete copy before moving an existing app. The target path is
/// fixed within the supplied Applications directory.
pub struct Installer<V> {
    applications: PathBuf,
    verifier: V,
}

impl<V: BundleVerifier> Installer<V> {
    #[cfg(target_os = "macos")]
    pub fn new(applications: PathBuf, verifier: V) -> Result<Self, String> {
        require_real_directory(&applications)?;
        Ok(Self {
            applications,
            verifier,
        })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn new(_applications: PathBuf, _verifier: V) -> Result<Self, String> {
        Err("Wallpaper installation requires macOS".into())
    }

    pub fn installed_path(&self) -> PathBuf {
        self.applications.join(APP_NAME)
    }

    pub fn status(&self) -> Result<WallpaperStatus, String> {
        let target = self.installed_path();
        let installation = if !path_exists(&target)? {
            Installation::Missing
        } else if self.verifier.verify(&target).is_ok() {
            Installation::Owned
        } else {
            Installation::Other
        };
        Ok(WallpaperStatus {
            installation,
            selected: WallpaperUse::Unknown,
        })
    }

    /// Installs or updates an owned app without changing system settings.
    /// An update returns the path of the preserved previous app.
    pub fn install(&self, source: &Path, usage: WallpaperUse) -> Result<Option<PathBuf>, String> {
        self.verifier.verify(source)?;
        let target = self.installed_path();
        let replacing = path_exists(&target)?;
        if replacing {
            require_user_confirmation(usage)?;
            self.verifier.verify(&target)?;
        }
        let transaction = self.transaction_dir()?;
        let staged = transaction.join("new.app");
        let backup = transaction.join("previous-backup");
        let result = (|| {
            let copied = Command::new("/usr/bin/ditto")
                .args(["--rsrc", "--extattr", "--acl", "--qtn"])
                .arg(source)
                .arg(&staged)
                .status()
                .map_err(|e| format!("Cannot copy wallpaper app: {e}"))?;
            if !copied.success() {
                return Err("Cannot copy wallpaper app".into());
            }
            self.verifier.verify(&staged)?;
            if replacing {
                rename_exclusive(&target, &backup)
                    .map_err(|e| format!("Cannot preserve previous app: {e}"))?;
                if let Err(error) = self.verifier.verify(&backup) {
                    if let Err(restore) = rename_exclusive(&backup, &target) {
                        return Err(format!(
                            "The previous app changed: {error}. It remains at {}: {restore}",
                            backup.display()
                        ));
                    }
                    return Err(format!("The previous app changed: {error}"));
                }
            } else if path_exists(&target)? {
                return Err("Another app appeared at the installation location".into());
            }
            if let Err(error) = rename_exclusive(&staged, &target) {
                if replacing {
                    if let Err(restore) = rename_exclusive(&backup, &target) {
                        return Err(format!(
                            "Cannot install app: {error}. Previous app remains at {}: {restore}",
                            backup.display()
                        ));
                    }
                }
                return Err(format!("Cannot install app: {error}"));
            }
            Ok(replacing.then(|| backup.clone()))
        })();
        // Never remove a backup left after a failed restore.
        if !path_exists(&backup)? {
            let _ = fs::remove_dir_all(&transaction);
        }
        result
    }

    /// Keeps the backup control reachable if the host app or bundled source
    /// has been removed. The open operation validates the paths again.
    pub fn has_backups(&self) -> bool {
        match fs::symlink_metadata(self.applications.join(BACKUP_DIR)) {
            Ok(_) => return true,
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(_) => return true,
        }
        let Ok(entries) = fs::read_dir(&self.applications) else { return true; };
        entries.filter_map(Result::ok).any(|entry| {
            entry.file_name().to_str().is_some_and(|name| name.starts_with(".lidscape-wallpaper-"))
                && entry.file_type().is_ok_and(|kind| kind.is_dir())
                && path_exists(&entry.path().join("previous-backup")).unwrap_or(true)
        })
    }

    /// Returns the visible location for backups without following a symlink.
    pub fn ensure_backup_dir(&self) -> Result<PathBuf, String> {
        let directory = self.applications.join(BACKUP_DIR);
        match fs::create_dir(&directory) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(format!("Cannot create wallpaper backup folder: {error}")),
        }
        require_real_directory(&directory)
            .map_err(|error| format!("Cannot use wallpaper backup folder: {error}"))?;
        Ok(directory)
    }

    /// Archives a verified transaction backup in a visible folder. A ZIP does
    /// not expose another app extension to macOS while it is stored.
    pub fn make_backup_visible(&self, backup: &Path) -> Result<PathBuf, String> {
        let parent = backup.parent().ok_or("Invalid wallpaper backup path")?;
        let valid = backup.file_name().is_some_and(|name| name == "previous-backup")
            && parent.parent() == Some(self.applications.as_path())
            && parent.file_name().and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".lidscape-wallpaper-"));
        if !valid { return Err("The backup is not a wallpaper transaction backup".into()); }
        require_real_directory(parent)?;
        self.verifier.verify(backup).map_err(|error| format!("Cannot preserve backup at {}: {error}", backup.display()))?;
        let directory = self.ensure_backup_dir().map_err(|error| format!("{error}. Backup remains at {}", backup.display()))?;
        let work = VerificationDirectory::create().map_err(|error| format!("{error}. Backup remains at {}", backup.display()))?;
        let zip = work.0.join("backup.zip");
        let result = (|| {
            let output = Command::new("/usr/bin/ditto").args(["-c", "-k", "--keepParent", "--rsrc", "--extattr", "--acl", "--qtn"])
                .arg(backup).arg(&zip).status().map_err(|error| format!("Cannot archive backup: {error}"))?;
            if !output.success() { return Err("Cannot archive backup".into()); }
            let check = work.0.join("check");
            fs::create_dir(&check).map_err(|error| format!("Cannot check backup: {error}"))?;
            let extracted = Command::new("/usr/bin/ditto").args(["-x", "-k", "--rsrc", "--extattr", "--acl", "--qtn"])
                .arg(&zip).arg(&check).status().map_err(|error| format!("Cannot check backup: {error}"))?;
            if !extracted.success() { return Err("Cannot unpack backup for verification".into()); }
            self.verifier.verify(&check.join("previous-backup"))
                .map_err(|error| format!("The archived backup is invalid: {error}"))?;
            self.verifier.verify(backup).map_err(|error| format!("The original backup changed: {error}"))?;
            for _ in 0..32 {
                let id = NONCE.fetch_add(1, Ordering::Relaxed);
                let partial = directory.join(format!("Incomplete Lidscape Wallpaper backup {}-{id}.zip", std::process::id()));
                let destination = directory.join(format!("Lidscape Wallpaper backup {}-{id}.zip", std::process::id()));
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut output = match options.open(&partial) {
                    Ok(output) => output,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(format!("Cannot prepare visible backup: {error}")),
                };
                let copy = (|| {
                    let mut source = fs::File::open(&zip).map_err(|error| error.to_string())?;
                    let expected = source.metadata().map_err(|error| error.to_string())?.len();
                    let written = io::copy(&mut source, &mut output).map_err(|error| error.to_string())?;
                    if written != expected { return Err("Incomplete backup archive".into()); }
                    output.sync_all().map_err(|error| error.to_string())?;
                    drop(output);
                    let copied_check = work.0.join("copied-check");
                    fs::create_dir(&copied_check).map_err(|error| error.to_string())?;
                    let checked = Command::new("/usr/bin/ditto").args(["-x", "-k", "--rsrc", "--extattr", "--acl", "--qtn"])
                        .arg(&partial).arg(&copied_check).status().map_err(|error| error.to_string())?;
                    if !checked.success() { return Err("Cannot unpack the saved backup".into()); }
                    self.verifier.verify(&copied_check.join("previous-backup"))
                        .map_err(|error| format!("The saved backup is invalid: {error}"))?;
                    rename_exclusive(&partial, &destination).map_err(|error| format!("Cannot name backup archive: {error}"))?;
                    Ok(())
                })();
                if let Err(error) = copy {
                    // This path was created exclusively in this operation.
                    let _ = fs::remove_file(&partial);
                    return Err(error);
                }
                if let Err(error) = fs::remove_dir_all(backup) {
                    return Err(format!("Backup archive saved at {}. The original may remain at {}: {error}", destination.display(), backup.display()));
                }
                let _ = fs::remove_dir(parent);
                return Ok(destination);
            }
            Err("Cannot name backup archive".into())
        })();
        if let Err(error) = result {
            return Err(format!("{error}. Check the original backup at {}", backup.display()));
        }
        result
    }

    /// Preserve backups left by interrupted operations before starting another
    /// update or opening the backup folder. Never follow transaction symlinks.
    pub fn preserve_pending_backups(&self) -> Result<(), String> {
        let entries = fs::read_dir(&self.applications)
            .map_err(|error| format!("Cannot inspect wallpaper backups: {error}"))?;
        let mut backups = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| format!("Cannot inspect wallpaper backups: {error}"))?;
            let name = entry.file_name();
            if !name.to_str().is_some_and(|name| name.starts_with(".lidscape-wallpaper-")) { continue; }
            if !entry.file_type().map_err(|error| error.to_string())?.is_dir() { continue; }
            let backup = entry.path().join("previous-backup");
            if path_exists(&backup)? { backups.push(backup); }
        }
        backups.sort();
        let mut errors = Vec::new();
        for backup in backups {
            if let Err(error) = self.make_backup_visible(&backup) { errors.push(error); }
        }
        if errors.is_empty() { Ok(()) } else { Err(errors.join("; ")) }
    }

    /// Restores a prior update backup. If an owned app occupies the target,
    /// its path in a separate recoverable backup is returned. This does not
    /// change wallpaper selection or extension registration.
    pub fn restore_backup(
        &self,
        backup: &Path,
        usage: WallpaperUse,
    ) -> Result<Option<PathBuf>, String> {
        require_user_confirmation(usage)?;
        let parent = backup.parent().ok_or("Invalid wallpaper backup path")?;
        let valid_name = backup
            .file_name()
            .is_some_and(|name| name == "previous-backup");
        let valid_parent = parent.parent() == Some(self.applications.as_path())
            && parent
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".lidscape-wallpaper-"));
        if !valid_name || !valid_parent {
            return Err("The backup is not an update backup in the Applications directory".into());
        }
        require_real_directory(parent)?;
        self.verifier
            .verify(backup)
            .map_err(|error| format!("Cannot restore backup: {error}"))?;
        let target = self.installed_path();
        let replacing = path_exists(&target)?;
        if replacing {
            self.verifier
                .verify(&target)
                .map_err(|error| format!("Cannot replace the installed app: {error}"))?;
        }
        let transaction = self.transaction_dir()?;
        let displaced = transaction.join("previous-backup");
        if replacing {
            if let Err(error) = rename_exclusive(&target, &displaced) {
                let _ = fs::remove_dir(&transaction);
                return Err(format!("Cannot preserve the installed app: {error}"));
            }
            if let Err(error) = self.verifier.verify(&displaced) {
                if let Err(restore) = rename_exclusive(&displaced, &target) {
                    return Err(format!(
                        "The installed app changed: {error}. It remains at {}: {restore}",
                        displaced.display()
                    ));
                }
                let _ = fs::remove_dir(&transaction);
                return Err(format!("The installed app changed: {error}"));
            }
        }
        if let Err(error) = rename_exclusive(backup, &target) {
            if replacing {
                if let Err(restore) = rename_exclusive(&displaced, &target) {
                    return Err(format!("Cannot restore backup: {error}. The installed app remains at {}: {restore}", displaced.display()));
                }
            }
            let _ = fs::remove_dir(&transaction);
            return Err(format!(
                "Cannot restore backup: {error}. Backup remains at {}",
                backup.display()
            ));
        }
        if let Err(error) = self.verifier.verify(&target) {
            if let Err(restore) = rename_exclusive(&target, backup) {
                return Err(format!("The backup changed: {error}. It remains at {}: {restore}. The displaced app is at {}", target.display(), displaced.display()));
            }
            if replacing {
                if let Err(restore) = rename_exclusive(&displaced, &target) {
                    return Err(format!(
                        "The backup changed: {error}. The installed app remains at {}: {restore}",
                        displaced.display()
                    ));
                }
            }
            let _ = fs::remove_dir(&transaction);
            return Err(format!(
                "The backup changed: {error}. Backup remains at {}",
                backup.display()
            ));
        }
        let _ = fs::remove_dir(parent);
        if replacing {
            Ok(Some(displaced))
        } else {
            let _ = fs::remove_dir(&transaction);
            Ok(None)
        }
    }

    /// Moves an owned app to the macOS Trash. This does not unregister
    /// the extension. The caller must inform the user and verify that step.
    pub fn remove(&self, usage: WallpaperUse) -> Result<Option<PathBuf>, String> {
        let target = self.installed_path();
        if !path_exists(&target)? {
            return Ok(None);
        }
        require_user_confirmation(usage)?;
        self.verifier.verify(&target)?;
        let transaction = self.transaction_dir()?;
        let staged = transaction.join(APP_NAME);
        if let Err(error) = rename_exclusive(&target, &staged) {
            let _ = fs::remove_dir(&transaction);
            return Err(format!("Cannot move wallpaper app: {error}"));
        }
        if let Err(error) = self.verifier.verify(&staged) {
            if let Err(restore) = rename_exclusive(&staged, &target) {
                return Err(format!(
                    "The app changed: {error}. It remains at {}: {restore}",
                    staged.display()
                ));
            }
            let _ = fs::remove_dir(&transaction);
            return Err(format!("The app changed: {error}"));
        }
        match move_to_trash(&staged) {
            Ok(path) => {
                let _ = fs::remove_dir(&transaction);
                Ok(Some(path))
            }
            Err(error) => {
                if path_exists(&staged)? {
                    if let Err(restore) = rename_exclusive(&staged, &target) {
                        return Err(format!(
                            "{error}. The app remains at {}: {restore}",
                            staged.display()
                        ));
                    }
                    let _ = fs::remove_dir(&transaction);
                }
                Err(error)
            }
        }
    }

    fn transaction_dir(&self) -> Result<PathBuf, String> {
        for _ in 0..32 {
            let id = NONCE.fetch_add(1, Ordering::Relaxed);
            let path = self
                .applications
                .join(format!(".lidscape-wallpaper-{}-{id}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(path),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Cannot prepare app installation: {e}")),
            }
        }
        Err("Cannot allocate a temporary installation directory".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    struct FakeVerifier;
    impl BundleVerifier for FakeVerifier {
        fn verify(&self, bundle: &Path) -> Result<(), String> {
            require_real_directory(bundle)?;
            match fs::read_to_string(bundle.join("owner")) {
                Ok(id) if id == BUNDLE_ID => Ok(()),
                _ => Err("Foreign app".into()),
            }
        }
    }

    struct Fixture {
        root: PathBuf,
        source: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "lidscape-install-test-{}-{}",
                std::process::id(),
                NONCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            let source = root.join("source.app");
            fs::create_dir(&source).unwrap();
            fs::write(source.join("owner"), BUNDLE_ID).unwrap();
            fs::write(source.join("version"), "one").unwrap();
            Self { root, source }
        }
        fn installer(&self) -> Installer<FakeVerifier> {
            Installer::new(self.root.clone(), FakeVerifier).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn install_update_and_remove_owned_app() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        assert_eq!(
            installer.status().unwrap(),
            WallpaperStatus {
                installation: Installation::Missing,
                selected: WallpaperUse::Unknown
            }
        );
        let initial_backup = installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        assert_eq!(initial_backup, None);
        assert_eq!(
            installer.status().unwrap(),
            WallpaperStatus {
                installation: Installation::Owned,
                selected: WallpaperUse::Unknown
            }
        );
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
        fs::write(fixture.source.join("version"), "two").unwrap();
        assert!(installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .is_err());
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
        let previous = installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .expect("the previous app is retained");
        assert_eq!(fs::read_to_string(previous.join("version")).unwrap(), "one");
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "two"
        );
        assert!(installer.remove(WallpaperUse::Unknown).is_err());
        let removed = installer
            .remove(WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .expect("the removed app is retained");
        assert_eq!(fs::read_to_string(removed.join("version")).unwrap(), "two");
        rename_exclusive(&removed, &fixture.root.join("recovered.app")).unwrap();
        assert!(!installer.installed_path().exists());
        assert_eq!(installer.remove(WallpaperUse::Unknown).unwrap(), None);
    }

    #[test]
    fn backup_preserves_metadata_even_when_ditto_default_is_disabled() {
        let result = Command::new(std::env::current_exe().unwrap())
            .arg("metadata_child_probe")
            .env("DITTONORSRC", "1")
            .env("LIDSCAPE_METADATA_CHILD", "1")
            .output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    }

    #[test]
    fn metadata_child_probe() {
        if std::env::var_os("LIDSCAPE_METADATA_CHILD").is_none() { return; }
        let fixture = Fixture::new();
        let owner = fixture.source.join("owner");
        let attribute = "com.example.lidscape-metadata-test";
        assert!(Command::new("/usr/bin/xattr").args(["-w", attribute, "preserved"]).arg(&owner).status().unwrap().success());
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let archive = installer.make_backup_visible(&backup).unwrap();
        let restored = fixture.root.join("metadata-restored");
        fs::create_dir(&restored).unwrap();
        assert!(Command::new("/usr/bin/ditto").args(["-x", "-k", "--rsrc", "--extattr", "--acl", "--qtn"])
            .arg(&archive).arg(&restored).status().unwrap().success());
        let result = Command::new("/usr/bin/xattr").args(["-p", attribute]).arg(restored.join("previous-backup/owner")).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        assert_eq!(String::from_utf8_lossy(&result.stdout).trim(), "preserved");
    }

    #[test]
    fn visible_backups_are_distinct_and_can_be_restored_manually() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        fs::write(fixture.source.join("version"), "two").unwrap();
        let first = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let first_parent = first.parent().unwrap().to_path_buf();
        let visible = installer.make_backup_visible(&first).unwrap();
        assert!(visible.starts_with(fixture.root.join(BACKUP_DIR)));
        assert_eq!(visible.extension().and_then(|part| part.to_str()), Some("zip"));
        assert!(!first.exists());
        assert!(!first_parent.exists());
        let extraction = fixture.root.join("extracted-backup");
        fs::create_dir(&extraction).unwrap();
        assert!(Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&visible).arg(&extraction).status().unwrap().success());
        assert_eq!(fs::read_to_string(extraction.join("previous-backup/version")).unwrap(), "one");
        fs::write(fixture.source.join("version"), "three").unwrap();
        let second = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let visible_second = installer.make_backup_visible(&second).unwrap();
        assert_ne!(visible, visible_second);
        let extraction_second = fixture.root.join("extracted-backup-two");
        fs::create_dir(&extraction_second).unwrap();
        assert!(Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&visible_second).arg(&extraction_second).status().unwrap().success());
        assert_eq!(fs::read_to_string(extraction_second.join("previous-backup/version")).unwrap(), "two");
        let current = fixture.root.join("current-app-for-test");
        rename_exclusive(&installer.installed_path(), &current).unwrap();
        rename_exclusive(&extraction.join("previous-backup"), &installer.installed_path()).unwrap();
        assert_eq!(installer.status().unwrap().installation, Installation::Owned);
        assert_eq!(fs::read_to_string(installer.installed_path().join("version")).unwrap(), "one");
        assert_eq!(fs::read_to_string(current.join("version")).unwrap(), "three");
    }

    #[test]
    fn opening_backups_recovers_an_interrupted_update() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        assert!(!installer.has_backups());
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        assert!(installer.has_backups());
        installer.preserve_pending_backups().unwrap();
        assert!(!backup.exists());
        assert!(installer.has_backups());
        let entries: Vec<_> = fs::read_dir(fixture.root.join(BACKUP_DIR)).unwrap().collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].as_ref().unwrap().path().extension().and_then(|part| part.to_str()), Some("zip"));
        installer.preserve_pending_backups().unwrap();
        assert_eq!(fs::read_dir(fixture.root.join(BACKUP_DIR)).unwrap().count(), 1);
    }

    #[test]
    fn preserves_multiple_interrupted_backups_without_skipping_entries() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let mut originals = Vec::new();
        for _ in 0..5 {
            originals.push(installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap());
        }
        installer.preserve_pending_backups().unwrap();
        assert!(originals.iter().all(|path| !path.exists()));
        assert_eq!(fs::read_dir(fixture.root.join(BACKUP_DIR)).unwrap().count(), 5);
    }

    #[test]
    fn corrupt_pending_backup_does_not_block_preservation_of_valid_copies() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let bad = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let good = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        fs::write(bad.join("owner"), "foreign").unwrap();
        let error = installer.preserve_pending_backups().unwrap_err();
        assert!(error.contains(&bad.display().to_string()));
        assert_eq!(fs::read_to_string(bad.join("owner")).unwrap(), "foreign");
        assert!(!good.exists());
        assert_eq!(fs::read_dir(fixture.root.join(BACKUP_DIR)).unwrap().count(), 1);
    }

    #[test]
    fn backup_recovery_preserves_an_unrelated_archive_symlink() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let user_file = fixture.root.join("important");
        fs::write(&user_file, "keep").unwrap();
        symlink(&user_file, backup.parent().unwrap().join("backup.zip")).unwrap();
        installer.preserve_pending_backups().unwrap();
        assert!(!backup.exists());
        assert!(backup.parent().unwrap().join("backup.zip").is_symlink());
        assert_eq!(fs::read_to_string(user_file).unwrap(), "keep");
    }

    #[test]
    fn backup_keeps_original_when_archive_verification_fails() {
        struct RejectArchive;
        impl BundleVerifier for RejectArchive {
            fn verify(&self, bundle: &Path) -> Result<(), String> {
                FakeVerifier.verify(bundle)?;
                if bundle.ancestors().any(|path| path.file_name().and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("lidscape-backup-check-"))) {
                    return Err("Archive verification failed".into());
                }
                Ok(())
            }
        }
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let rejecting = Installer::new(fixture.root.clone(), RejectArchive).unwrap();
        let result = rejecting.make_backup_visible(&backup).unwrap_err();
        assert!(result.contains("Archive verification failed"));
        assert_eq!(fs::read_to_string(backup.join("owner")).unwrap(), BUNDLE_ID);
        assert_eq!(fs::read_dir(fixture.root.join(BACKUP_DIR)).unwrap().count(), 0);
    }

    #[test]
    fn backup_folder_refuses_to_replace_an_existing_user_file() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let user_file = fixture.root.join(BACKUP_DIR);
        fs::write(&user_file, "keep").unwrap();
        assert!(installer.preserve_pending_backups().is_err());
        assert!(backup.exists());
        assert_eq!(fs::read_to_string(user_file).unwrap(), "keep");
    }

    #[test]
    fn visible_backup_refuses_foreign_source_and_symlink_folder() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer.install(&fixture.source, WallpaperUse::Unknown).unwrap();
        let backup = installer.install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let user_directory = fixture.root.join("user-data");
        fs::create_dir(&user_directory).unwrap();
        fs::write(user_directory.join("important"), "keep").unwrap();
        symlink(&user_directory, fixture.root.join(BACKUP_DIR)).unwrap();
        assert!(installer.make_backup_visible(&backup).is_err());
        assert!(backup.exists());
        assert_eq!(fs::read_to_string(user_directory.join("important")).unwrap(), "keep");
        assert!(installer.make_backup_visible(&fixture.source).is_err());
    }

    #[test]
    fn restore_backup_preserves_installed_version_and_refuses_foreign_targets() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        fs::write(fixture.source.join("version"), "two").unwrap();
        let backup = installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .unwrap();
        assert!(installer
            .restore_backup(&backup, WallpaperUse::Unknown)
            .is_err());
        fs::write(installer.installed_path().join("owner"), "foreign").unwrap();
        assert!(installer
            .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("owner")).unwrap(),
            "foreign"
        );
        assert_eq!(fs::read_to_string(backup.join("version")).unwrap(), "one");
        fs::write(installer.installed_path().join("owner"), BUNDLE_ID).unwrap();
        let displaced = installer
            .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .unwrap();
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
        assert_eq!(
            fs::read_to_string(displaced.join("version")).unwrap(),
            "two"
        );
        assert!(!backup.exists());
    }

    #[test]
    fn restore_rejects_untrusted_backup_and_supports_missing_target() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        assert!(installer
            .restore_backup(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        let backup = installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .unwrap();
        fs::write(backup.join("owner"), "foreign").unwrap();
        assert!(installer
            .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert!(installer.installed_path().exists());
        fs::write(backup.join("owner"), BUNDLE_ID).unwrap();
        fs::remove_dir_all(installer.installed_path()).unwrap();
        assert_eq!(
            installer
                .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
                .unwrap(),
            None
        );
        assert!(installer.installed_path().exists());
    }

    #[test]
    fn restore_rolls_back_if_restored_app_fails_verification() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        struct RejectRestored(Arc<AtomicBool>);
        impl BundleVerifier for RejectRestored {
            fn verify(&self, path: &Path) -> Result<(), String> {
                FakeVerifier.verify(path)?;
                if self.0.load(Ordering::Relaxed)
                    && path.file_name().is_some_and(|name| name == APP_NAME)
                    && fs::read_to_string(path.join("version")).unwrap() == "one"
                {
                    return Err("Restored app failed verification".into());
                }
                Ok(())
            }
        }
        let fixture = Fixture::new();
        let reject = Arc::new(AtomicBool::new(false));
        let installer =
            Installer::new(fixture.root.clone(), RejectRestored(reject.clone())).unwrap();
        installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        fs::write(fixture.source.join("version"), "two").unwrap();
        let backup = installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .unwrap()
            .unwrap();
        reject.store(true, Ordering::Relaxed);
        assert!(installer
            .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(fs::read_to_string(backup.join("version")).unwrap(), "one");
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "two"
        );
    }

    #[test]
    fn refuses_foreign_app_and_symlink_without_modifying_them() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        let target = installer.installed_path();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("owner"), "other").unwrap();
        assert_eq!(
            installer.status().unwrap(),
            WallpaperStatus {
                installation: Installation::Other,
                selected: WallpaperUse::Unknown
            }
        );
        assert!(installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert!(installer
            .remove(WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(fs::read_to_string(target.join("owner")).unwrap(), "other");
        fs::remove_dir_all(&target).unwrap();
        symlink(&fixture.source, &target).unwrap();
        assert!(installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert!(installer
            .remove(WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_to_string(fixture.source.join("version")).unwrap(),
            "one"
        );
    }

    #[test]
    fn refuses_invalid_source_before_changing_the_installed_app() {
        let fixture = Fixture::new();
        let installer = fixture.installer();
        installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        fs::write(fixture.source.join("owner"), "foreign").unwrap();
        assert!(installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
    }

    #[test]
    fn restores_target_if_verification_fails_after_move() {
        struct RejectMoved;
        impl BundleVerifier for RejectMoved {
            fn verify(&self, bundle: &Path) -> Result<(), String> {
                FakeVerifier.verify(bundle)?;
                let in_transaction = bundle
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".lidscape-wallpaper-"));
                if in_transaction
                    && matches!(
                        bundle.file_name().and_then(|name| name.to_str()),
                        Some("previous-backup" | APP_NAME)
                    )
                {
                    return Err("App changed while moving".into());
                }
                Ok(())
            }
        }
        let fixture = Fixture::new();
        let installer = Installer::new(fixture.root.clone(), RejectMoved).unwrap();
        installer
            .install(&fixture.source, WallpaperUse::Unknown)
            .unwrap();
        fs::write(fixture.source.join("version"), "two").unwrap();
        assert!(installer
            .install(&fixture.source, WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
        assert!(installer
            .remove(WallpaperUse::UserConfirmedOtherWallpaper)
            .is_err());
        assert_eq!(
            fs::read_to_string(installer.installed_path().join("version")).unwrap(),
            "one"
        );
    }

    #[test]
    fn refuses_ad_hoc_signature() {
        let fixture = Fixture::new();
        fs::remove_file(fixture.source.join("owner")).unwrap();
        fs::remove_file(fixture.source.join("version")).unwrap();
        let contents = fixture.source.join("Contents");
        fs::create_dir_all(contents.join("MacOS")).unwrap();
        fs::copy("/usr/bin/true", contents.join("MacOS/test")).unwrap();
        fs::write(contents.join("Info.plist"), format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string><key>CFBundleExecutable</key><string>test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>")).unwrap();
        let signed = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(&fixture.source)
            .output()
            .unwrap();
        assert!(
            signed.status.success(),
            "{}",
            String::from_utf8_lossy(&signed.stderr)
        );
        let signature_valid = Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(&fixture.source)
            .status()
            .unwrap();
        assert!(signature_valid.success());
        let details = Command::new("/usr/bin/codesign")
            .args(["-dv", "--verbose=4"])
            .arg(&fixture.source)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&details.stderr)
            .lines()
            .any(|line| line == format!("Identifier={BUNDLE_ID}")));
        assert!(MacBundleVerifier.verify(&fixture.source).is_err());
    }

    #[test]
    #[ignore = "requires LIDSCAPE_INSTALL_TEST_SIGNED_APP"]
    fn verifies_supplied_signed_probe_when_available() {
        let path = std::env::var_os("LIDSCAPE_INSTALL_TEST_SIGNED_APP").expect("signed probe path");
        MacBundleVerifier.verify(Path::new(&path)).unwrap();
        for rule in [
            format!("=anchor apple generic and identifier \"wrong.bundle.identifier\" and certificate leaf[subject.OU] = \"{TEAM_ID}\""),
            format!("=anchor apple generic and identifier \"{BUNDLE_ID}\" and certificate leaf[subject.OU] = \"WRONGTEAM0\""),
        ] {
            let result = Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict", "-R", &rule])
                .arg(&path)
                .output()
                .unwrap();
            assert!(!result.status.success());
        }
    }

    #[test]
    #[ignore = "requires LIDSCAPE_INSTALL_TEST_SIGNED_APP"]
    fn copies_signed_probe_when_available() {
        {
            let path =
                std::env::var_os("LIDSCAPE_INSTALL_TEST_SIGNED_APP").expect("signed probe path");
            let fixture = Fixture::new();
            let installer = Installer::new(fixture.root.clone(), MacBundleVerifier).unwrap();
            installer
                .install(Path::new(&path), WallpaperUse::Unknown)
                .unwrap();
            assert_eq!(
                installer.status().unwrap().installation,
                Installation::Owned
            );
            // The temporary copy was never registered or selected.
            let backup = installer
                .install(Path::new(&path), WallpaperUse::UserConfirmedOtherWallpaper)
                .unwrap()
                .unwrap();
            let displaced = installer
                .restore_backup(&backup, WallpaperUse::UserConfirmedOtherWallpaper)
                .unwrap()
                .unwrap();
            MacBundleVerifier.verify(&displaced).unwrap();
            MacBundleVerifier
                .verify(&installer.installed_path())
                .unwrap();
            let removed = installer
                .remove(WallpaperUse::UserConfirmedOtherWallpaper)
                .unwrap()
                .unwrap();
            rename_exclusive(&removed, &fixture.root.join("recovered.app")).unwrap();
            assert_eq!(
                installer.status().unwrap().installation,
                Installation::Missing
            );
        }
    }

    #[test]
    #[ignore = "requires LIDSCAPE_INSTALL_TEST_SIGNED_APP"]
    fn archives_and_restores_a_signed_probe() {
        let path = std::env::var_os("LIDSCAPE_INSTALL_TEST_SIGNED_APP").expect("signed probe path");
        let fixture = Fixture::new();
        let installer = Installer::new(fixture.root.clone(), MacBundleVerifier).unwrap();
        installer.install(Path::new(&path), WallpaperUse::Unknown).unwrap();
        let old = installer.install(Path::new(&path), WallpaperUse::UserConfirmedOtherWallpaper).unwrap().unwrap();
        let archive = installer.make_backup_visible(&old).unwrap();
        assert!(!old.exists());
        let restored = fixture.root.join("restored");
        fs::create_dir(&restored).unwrap();
        assert!(Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&archive).arg(&restored).status().unwrap().success());
        MacBundleVerifier.verify(&restored.join("previous-backup")).unwrap();
        rename_exclusive(&installer.installed_path(), &fixture.root.join("replaced-app")).unwrap();
        rename_exclusive(&restored.join("previous-backup"), &installer.installed_path()).unwrap();
        MacBundleVerifier.verify(&installer.installed_path()).unwrap();
    }

    #[test]
    #[ignore = "requires LIDSCAPE_INSTALL_TEST_SIGNED_APP"]
    fn rejects_modified_signed_probe() {
        let path = std::env::var_os("LIDSCAPE_INSTALL_TEST_SIGNED_APP").expect("signed probe path");
        let fixture = Fixture::new();
        let copy = fixture.root.join("modified.app");
        assert!(Command::new("/usr/bin/ditto")
            .arg(&path)
            .arg(&copy)
            .status()
            .unwrap()
            .success());
        MacBundleVerifier.verify(&copy).unwrap();
        let info = copy.join("Contents/Info.plist");
        let mut data = fs::read(&info).unwrap();
        data.push(b' ');
        fs::write(info, data).unwrap();
        assert!(MacBundleVerifier.verify(&copy).is_err());
    }
}
