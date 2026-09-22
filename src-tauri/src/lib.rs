// Week 1, Track B (HANDOFF.md item 2) shipped the static shell alone. Item 3 wires the
// observation bridge (PLAN.md §2) into it: `session_reader` ports the reader CLI's
// field-deriving rules to Rust (a packaged binary can't shell out to the Node-based
// `reader/` CLI without bundling a Node runtime — see session_reader.rs's own header),
// `watcher` feeds derived snapshots to the frontend over Tauri's own authenticated event
// transport. No center-seat PTY yet (item 4).

mod session_reader;
mod watcher;

use tauri::Manager;
use watcher::RegisteredSessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RegisteredSessions::default())
        .invoke_handler(tauri::generate_handler![watcher::register_session])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(watcher::start_watcher(&handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
