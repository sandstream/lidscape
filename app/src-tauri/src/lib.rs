mod update;
mod screensaver;


use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, WebviewWindowBuilder};

/// The lid bridge ships next to the app binary, as Lyssna's audio helper does.
/// In development it is in `src-tauri/binaries/` with the target triple appended.
fn bridge_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let bundled = dir.join("lid-bridge");
    #[cfg(debug_assertions)]
    if !bundled.exists() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/lid-bridge-aarch64-apple-darwin");
    }
    bundled
}

/// The Mac's language for this app, chosen among the languages in Info.plist
/// (CFBundleLocalizations), so it honours a per-app language in System Settings.
/// The web view's navigator.language does not, so the page gets it from here.
fn mac_language() -> String {
    #[cfg(target_os = "macos")]
    {
        let list = objc2_foundation::NSBundle::mainBundle().preferredLocalizations();
        if let Some(first) = list.iter().next() {
            return first.to_string();
        }
    }
    String::new()
}

/// A newer Lidscape on GitHub, or None. None also when GitHub cannot be reached.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Option<update::Update> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        update::check(&current).unwrap_or_else(|err| {
            eprintln!("Lidscape: update check failed: {err:#}");
            None
        })
    })
    .await
    .unwrap_or(None)
}

const REPO: &str = "https://github.com/sandstream/lidscape";

/// True for the repository's own pages, such as a release or CONTRIBUTING.md.
fn repo_link(url: &str) -> bool {
    !url.chars().any(char::is_whitespace) && (url == REPO || url.starts_with(&format!("{REPO}/")))
}

/// Opens a page of the Lidscape repository in the browser, and no other page.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !repo_link(&url) {
        return Err("not a Lidscape page".into());
    }
    Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// The running bridge, stopped when the app quits. If another bridge already holds
/// the port, this one exits at once and the page uses the other.
struct Bridge(Mutex<Option<Child>>);

pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_update,
            open_link,
            screensaver::screensaver_status,
            screensaver::save_screensaver_settings,
            screensaver::install_screensaver,
            screensaver::uninstall_screensaver,
            screensaver::open_screensaver_settings,
        ])
        .setup(|app| {
            let child = match Command::new(bridge_path()).spawn() {
                Ok(child) => Some(child),
                Err(err) => {
                    eprintln!("Lidscape: lid bridge did not start: {err}");
                    None
                }
            };
            app.manage(Bridge(Mutex::new(child)));

            // The window is made here, not from the config alone, so the page can
            // read the Mac's language before its own scripts run.
            let lang: String = mac_language().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
            let config = app.config().app.windows[0].clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(&format!("window.lidscapeMacLanguage = '{lang}'"))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lidscape");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Bridge>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_pages_in_the_repository() {
        assert!(repo_link("https://github.com/sandstream/lidscape"));
        assert!(repo_link("https://github.com/sandstream/lidscape/blob/main/CONTRIBUTING.md"));
        assert!(repo_link("https://github.com/sandstream/lidscape/releases/tag/v0.1.1"));
        assert!(!repo_link("https://github.com/sandstream/lidscape-releases"));
        assert!(!repo_link("https://github.com/sandstream/lidscape/x y"));
        assert!(!repo_link("https://evil.example/?https://github.com/sandstream/lidscape/"));
        assert!(!repo_link("file:///etc/passwd"));
    }
}
