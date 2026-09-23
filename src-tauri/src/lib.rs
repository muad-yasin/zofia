// Week 1, Track B (HANDOFF.md item 2) shipped the static shell alone. Item 3 wires the
// observation bridge (PLAN.md §2) into it: `session_reader` ports the reader CLI's
// field-deriving rules to Rust (a packaged binary can't shell out to the Node-based
// `reader/` CLI without bundling a Node runtime — see session_reader.rs's own header),
// `watcher` feeds derived snapshots to the frontend over Tauri's own authenticated event
// transport. Item 4 adds the owned center seat: `pty_seat` (PTY + ownership checks) and
// `center_seat` (its Tauri commands and the item 8 gate on the real CLI).

mod center_seat;
mod hash_sweep;
mod pty_seat;
mod session_reader;
mod watcher;

use tauri::Manager;
use watcher::RegisteredSessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RegisteredSessions::default())
        .manage(center_seat::CenterSeat::default())
        .invoke_handler(tauri::generate_handler![
            watcher::register_session,
            center_seat::center_preflight,
            center_seat::center_spawn,
            center_seat::center_write,
            center_seat::center_resize,
            center_seat::center_stop,
            center_seat::center_resweep
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(watcher::start_watcher(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                center_seat::shutdown(&app.state::<center_seat::CenterSeat>());
            }
        });
}
