use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

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

/// The running bridge, stopped when the app quits. If another bridge already holds
/// the port, this one exits at once and the page uses the other.
struct Bridge(Mutex<Option<Child>>);

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let child = match Command::new(bridge_path()).spawn() {
                Ok(child) => Some(child),
                Err(err) => {
                    eprintln!("Lidscape: lid bridge did not start: {err}");
                    None
                }
            };
            app.manage(Bridge(Mutex::new(child)));
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
