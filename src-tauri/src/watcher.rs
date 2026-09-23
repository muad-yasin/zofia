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

use crate::session_reader::{default_is_pid_alive, derive_snapshot, read_session_state, sessions_dir, unknown_snapshot, SessionSnapshot};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct RegisteredSessions(pub Mutex<HashSet<String>>);

/// Kept in Tauri-managed state for the app's lifetime — dropping it stops the watch.
pub struct WatcherHandle(#[allow(dead_code)] pub Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>);

/// Re-derive cadence for registered sessions between file events (audit F3, 2026-09-23).
/// "stale (last event Ns ago)" and the dead-PID "ended" check both depend on *now*, so
/// without a tick a session whose terminal was killed mid-tool read "running tool" forever.
/// Placeholder: well under session_reader's 120s stale threshold, so a stale label shows
/// within ~135s of the last event rather than up to ~240s; each tick is a few small reads.
const REDERIVE_EVERY: Duration = Duration::from_secs(15);

fn now_epoch_s() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(serde::Serialize, Clone)]
struct SnapshotEvent {
    session_id: String,
    snapshot: SessionSnapshot,
}

/// A state file that exists but doesn't parse (audit F9: e.g. `resets_at` arriving as a
/// float) is reported as that parse error, not as "no state file / shim not installed",
/// matching the Node reader, which also surfaces the parse error.
fn snapshot_for(session_id: &str, now: i64) -> SessionSnapshot {
    match read_session_state(session_id) {
        Ok(raw) => derive_snapshot(session_id, raw.as_ref(), now, &default_is_pid_alive),
        Err(e) => unknown_snapshot(session_id, &e),
    }
}

fn emit_snapshot(app: &AppHandle, session_id: &str) {
    let snapshot = snapshot_for(session_id, now_epoch_s());
    let _ = app.emit("zofia://snapshot", SnapshotEvent { session_id: session_id.to_string(), snapshot });
}

#[tauri::command]
pub fn register_session(app: AppHandle, session_id: String) -> Result<(), String> {
    // The owner types this; it becomes a file name, so "../x" is refused (audit F10).
    if !crate::session_reader::is_valid_session_id(&session_id) {
        return Err(format!("\"{session_id}\" is not a valid session_id (letters, digits, '-' and '_' only)"));
    }
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

    let tick_handle = app.clone();
    spawn_ticker(REDERIVE_EVERY, move || {
        let registered = tick_handle.state::<RegisteredSessions>().0.lock().map(|s| s.clone()).unwrap_or_default();
        for id in &registered {
            emit_snapshot(&tick_handle, id);
        }
    });

    let mut debouncer = new_debouncer(Duration::from_millis(250), handler).expect("failed to create the session-state file watcher");
    if let Err(e) = debouncer.watcher().watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("zofia: could not watch {dir:?}: {e} — corner panes will only update on manual re-registration");
    }
    WatcherHandle(debouncer)
}

/// Calls `f` every `every`, on its own thread, for the life of the process.
fn spawn_ticker(every: Duration, f: impl Fn() + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || loop {
        std::thread::sleep(every);
        f();
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn ticker_fires_repeatedly_without_any_file_event() {
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        spawn_ticker(Duration::from_millis(5), move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        std::thread::sleep(Duration::from_millis(100));
        assert!(n.load(Ordering::SeqCst) >= 3);
    }

    fn with_state_file<R>(session_id: &str, body: &str, f: impl FnOnce() -> R) -> R {
        let _guard = crate::session_reader::tests::ENV_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("zofia-watcher-{session_id}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{session_id}.json")), body).unwrap();
        std::env::set_var("ZOFIA_SESSIONS_DIR", &dir);
        let out = f();
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::fs::remove_dir_all(&dir).ok();
        out
    }

    // Audit F9: a parse failure used to be swallowed into "the shim isn't installed". (A
    // single mistyped field no longer fails the file at all; session_reader's own tests.)
    #[test]
    fn unparseable_state_reports_the_parse_error_not_missing_shim() {
        let body = r#"{"pid":1,"latest_statusline":{"observed_at":10,"#;
        let snap = with_state_file("f9", body, || snapshot_for("f9", 100));
        assert_eq!(snap.model.availability, "unknown");
        assert!(snap.model.source.contains("not valid JSON"), "{}", snap.model.source);
        assert!(!snap.model.source.contains("shim isn't installed"));
    }

    // Audit F3: the same file, re-derived later with no new write, must go stale.
    #[test]
    fn rederiving_without_a_file_event_turns_a_running_tool_stale() {
        let body = r#"{"latest_hook_event":{"observed_at":1000,"hook_event_name":"PreToolUse","tool_name":"Bash"}}"#;
        let (fresh, later) = with_state_file("f3", body, || (snapshot_for("f3", 1010), snapshot_for("f3", 1000 + 121)));
        assert!(!fresh.activity_state.value.clone().unwrap_or_default().starts_with("stale"));
        assert_eq!(later.activity_state.value.as_deref(), Some("stale (last event 121s ago)"));
    }

    #[test]
    fn rederive_interval_is_well_under_the_stale_threshold() {
        assert!(REDERIVE_EVERY.as_secs() * 4 <= 120);
    }
}
