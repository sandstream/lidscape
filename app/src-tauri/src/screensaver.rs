use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const BUNDLE_ID: &str = "se.sandstream.lidscape.saver";
const SAVER_NAME: &str = "Lidscape.saver";

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
        })
    }
}

fn bundle_id(path: &Path) -> Option<String> {
    if !path.is_dir() || path.is_symlink() {
        return None;
    }
    let output = Command::new("plutil")
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
    bundle_id(path).as_deref() == Some(BUNDLE_ID)
}

fn macos_27_or_newer() -> bool {
    let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() else {
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
        installed: owned_bundle(&paths.installed),
        available: macos_27_or_newer() && owned_bundle(&paths.source),
        installation_pending: false,
    })
}

#[tauri::command]
pub fn screensaver_status(app: tauri::AppHandle) -> Result<ScreenSaverStatus, String> {
    status(&SaverPaths::for_app(&app)?)
}

fn request_install(paths: &SaverPaths) -> Result<(), String> {
    if !owned_bundle(&paths.source) {
        return Err("The Lidscape screen saver is missing from the app".into());
    }
    if paths.installed.exists() && !owned_bundle(&paths.installed) {
        return Err("Another screen saver uses the Lidscape.saver location".into());
    }
    let opened = Command::new("open")
        .arg(&paths.source)
        .status()
        .map_err(|e| e.to_string())?;
    if !opened.success() {
        return Err("macOS could not open the screen saver installer".into());
    }
    Ok(())
}

fn uninstall_bundle(paths: &SaverPaths) -> Result<(), String> {
    if paths.installed.exists() {
        if !owned_bundle(&paths.installed) {
            return Err("The screen saver at this location does not belong to Lidscape".into());
        }
        fs::remove_dir_all(&paths.installed).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_its_own_bundle() {
        let dir = std::env::temp_dir().join(format!(
            "lidscape-saver-install-test-{}",
            std::process::id()
        ));
        let source = dir.join("source.saver");
        let installed = dir.join("Screen Savers/Lidscape.saver");
        let info = source.join("Contents/Info.plist");
        fs::create_dir_all(info.parent().unwrap()).unwrap();
        fs::write(&info, format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string></dict></plist>")).unwrap();
        let paths = SaverPaths {
            source,
            installed,
        };
        fs::create_dir_all(paths.installed.join("Contents")).unwrap();
        fs::copy(&info, paths.installed.join("Contents/Info.plist")).unwrap();
        assert!(owned_bundle(&paths.installed));
        uninstall_bundle(&paths).unwrap();
        assert!(!paths.installed.exists());

        fs::create_dir_all(paths.installed.join("Contents")).unwrap();
        fs::write(paths.installed.join("Contents/Info.plist"), "<plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>other.saver</string></dict></plist>").unwrap();
        assert!(uninstall_bundle(&paths).is_err());
        assert!(paths.installed.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
