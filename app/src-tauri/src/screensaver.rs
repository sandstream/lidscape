use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const BUNDLE_ID: &str = "se.sandstream.lidscape.saver";
const SAVER_NAME: &str = "Lidscape.saver";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct ScreenSaverSettings {
    pub city: String,
    pub theme: String,
    pub variant: String,
    pub view: String,
}

impl Default for ScreenSaverSettings {
    fn default() -> Self {
        Self {
            city: "stockholm".into(),
            theme: "paper".into(),
            variant: String::new(),
            view: "city".into(),
        }
    }
}

impl ScreenSaverSettings {
    fn validate(&self) -> Result<(), String> {
        for (name, value, empty) in [
            ("city", self.city.as_str(), false),
            ("theme", self.theme.as_str(), false),
            ("variant", self.variant.as_str(), true),
        ] {
            if value.len() > 64
                || (!empty && value.is_empty())
                || !value
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            {
                return Err(format!("Invalid screen saver {name}"));
            }
        }
        if self.view != "city" && self.view != "map" {
            return Err("Invalid screen saver view".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub struct ScreenSaverStatus {
    pub installed: bool,
    pub available: bool,
    pub settings: ScreenSaverSettings,
    #[serde(rename = "installationPending")]
    pub installation_pending: bool,
}

struct SaverPaths {
    source: PathBuf,
    installed: PathBuf,
    settings: PathBuf,
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
            settings: home.join("Library/Application Support/Lidscape/screensaver.json"),
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

fn read_settings(path: &Path) -> Result<ScreenSaverSettings, String> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ScreenSaverSettings::default())
        }
        Err(err) => return Err(err.to_string()),
    };
    let settings: ScreenSaverSettings = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    settings.validate()?;
    Ok(settings)
}

fn temporary_name(parent: &Path, purpose: &str) -> PathBuf {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    parent.join(format!(
        ".Lidscape.{}.{}.{}",
        std::process::id(),
        time,
        purpose
    ))
}

fn write_settings(path: &Path, settings: &ScreenSaverSettings) -> Result<(), String> {
    settings.validate()?;
    let parent = path
        .parent()
        .ok_or("Screen saver settings path is invalid")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = temporary_name(parent, "settings");
    let data = serde_json::to_vec(settings).map_err(|e| e.to_string())?;
    fs::write(&temporary, data).map_err(|e| e.to_string())?;
    if let Err(err) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(err.to_string());
    }
    Ok(())
}

fn status(paths: &SaverPaths) -> Result<ScreenSaverStatus, String> {
    Ok(ScreenSaverStatus {
        installed: owned_bundle(&paths.installed),
        available: macos_27_or_newer() && owned_bundle(&paths.source),
        settings: read_settings(&paths.settings)?,
        installation_pending: false,
    })
}

#[tauri::command]
pub fn screensaver_status(app: tauri::AppHandle) -> Result<ScreenSaverStatus, String> {
    status(&SaverPaths::for_app(&app)?)
}

#[tauri::command]
pub fn save_screensaver_settings(
    app: tauri::AppHandle,
    settings: ScreenSaverSettings,
) -> Result<ScreenSaverStatus, String> {
    let paths = SaverPaths::for_app(&app)?;
    write_settings(&paths.settings, &settings)?;
    status(&paths)
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
    fn validates_options_before_they_reach_the_screen_saver() {
        let mut settings = ScreenSaverSettings::default();
        assert!(settings.validate().is_ok());
        settings.view = "map".into();
        settings.variant = "christmas".into();
        assert!(settings.validate().is_ok());
        settings.city = "../other".into();
        assert!(settings.validate().is_err());
        settings.city = "stockholm".into();
        settings.view = "camera".into();
        assert!(settings.validate().is_err());
    }

    #[test]
    fn saves_and_reads_options_with_defaults() {
        let dir = std::env::temp_dir().join(format!("lidscape-saver-test-{}", std::process::id()));
        let path = dir.join("screen saver.json");
        let settings = ScreenSaverSettings {
            city: "tallinn".into(),
            view: "map".into(),
            ..Default::default()
        };
        write_settings(&path, &settings).unwrap();
        let result = read_settings(&path).unwrap();
        assert_eq!(result.city, "tallinn");
        assert_eq!(result.view, "map");
        fs::remove_dir_all(dir).unwrap();
    }

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
            settings: dir.join("settings.json"),
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
