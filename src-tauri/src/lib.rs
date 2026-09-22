// Week 1, Track B (HANDOFF.md item 2): the static shell alone — just the window and
// the frontend it loads. No reader wiring (item 3), no center-seat PTY (item 4) yet.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
