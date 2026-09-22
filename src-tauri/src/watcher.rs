// PLAN.md §2.1: "A Rust inotify watcher (250ms debounce, placeholder) feeds the
// existing authenticated frontend transport" — Tauri's own event system, reachable only
// from this app's own webview, is that transport; nothing here opens a socket.
//
// Privacy (PLAN.md §2.1, "registration is explicit, never automatic discovery"): the
// shim writes state for every Claude Code session on the machine once installed
// (DECISIONS.md, 2026-09-22), not only the ones the owner has assigned to a corner. This
// watcher sees every file change in the sessions directory but only ever derives and
// emits a snapshot for a session_id the frontend explicitly registered — an unregistered
// session's state is never read past the fact that its file changed.

use crate::session_reader::{default_is_pid_alive, derive_snapshot, read_session_state, sessions_dir, SessionSnapshot};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct RegisteredSessions(pub Mutex<HashSet<String>>);

/// Kept in Tauri-managed state for the app's lifetime — dropping it stops the watch.
pub struct WatcherHandle(#[allow(dead_code)] pub Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>);

fn now_epoch_s() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(serde::Serialize, Clone)]
struct SnapshotEvent {
    session_id: String,
    snapshot: SessionSnapshot,
}

fn emit_snapshot(app: &AppHandle, session_id: &str) {
    let raw = read_session_state(session_id).unwrap_or(None);
    let snapshot = derive_snapshot(session_id, raw.as_ref(), now_epoch_s(), &default_is_pid_alive);
    let _ = app.emit("zofia://snapshot", SnapshotEvent { session_id: session_id.to_string(), snapshot });
}

#[tauri::command]
pub fn register_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<RegisteredSessions>();
    state.0.lock().map_err(|e| e.to_string())?.insert(session_id.clone());
    emit_snapshot(&app, &session_id); // don't leave the pane on "no snapshot yet" until the next fs event
    Ok(())
}

/// Starts the debounced watch over the sessions directory. Safe to call even if the
/// directory doesn't exist yet (shim not installed, or nothing observed this boot) —
/// creates it so the watch has something to attach to; a session registered later still
/// gets its immediate snapshot from `register_session` regardless of watch state.
pub fn start_watcher(app: &AppHandle) -> WatcherHandle {
    let dir = sessions_dir();
    let _ = std::fs::create_dir_all(&dir);

    let app_handle = app.clone();
    let handler = move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let mut changed_ids: HashSet<String> = HashSet::new();
        for event in events {
            if let Some(stem) = event.path.file_stem().and_then(|s| s.to_str()) {
                changed_ids.insert(stem.to_string());
            }
        }
        if changed_ids.is_empty() {
            return;
        }
        let state = app_handle.state::<RegisteredSessions>();
        let registered = state.0.lock().map(|s| s.clone()).unwrap_or_default();
        for id in changed_ids.intersection(&registered) {
            emit_snapshot(&app_handle, id);
        }
    };

    let mut debouncer = new_debouncer(Duration::from_millis(250), handler).expect("failed to create the session-state file watcher");
    if let Err(e) = debouncer.watcher().watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("zofia: could not watch {dir:?}: {e} — corner panes will only update on manual re-registration");
    }
    WatcherHandle(debouncer)
}
