// Quality check Q3 (2026-09-23): assigning a corner meant copying a session UUID out of
// `ls $XDG_RUNTIME_DIR/zofia/sessions/`, with nothing saying which terminal was which.
// This lists the sessions the shim has already written state for, named by their working
// folder, so the owner picks one per corner with a click. Still the owner's own explicit
// assignment (PLAN.md §2.1): nothing is registered or read continuously until they pick;
// this only reads the same local state files the corners do, once per call.

use crate::session_reader::{default_is_pid_alive, derive_snapshot, is_valid_session_id, read_session_state, sessions_dir};
use serde::Serialize;

/// At most this many are offered, most recently active first.
const MAX_OFFERED: usize = 12;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DetectedSession {
    pub session_id: String,
    pub cwd: Option<String>,
    /// The cwd's last path component, or "session <first 8 chars of the id>" without one.
    pub project: String,
    pub activity: Option<String>,
    pub last_active: Option<i64>,
    pub model: Option<String>,
}

/// Every session with a state file whose process is not known to be gone and which has not
/// sent SessionEnd, most recently active first.
pub fn detect_sessions(now: i64, is_pid_alive: &dyn Fn(u32) -> bool) -> Vec<DetectedSession> {
    let Ok(entries) = std::fs::read_dir(sessions_dir()) else { return Vec::new() };
    let mut out: Vec<DetectedSession> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json").map(str::to_string))
        .filter(|id| is_valid_session_id(id))
        .filter_map(|id| {
            let raw = read_session_state(&id).ok()??;
            if raw.pid.is_some_and(|p| !is_pid_alive(p)) {
                return None;
            }
            if raw.latest_hook_event.as_ref().is_some_and(|h| h.hook_event_name == "SessionEnd") {
                return None;
            }
            let snap = derive_snapshot(&id, Some(&raw), now, is_pid_alive);
            let cwd = raw.cwd.clone().filter(|c| !c.is_empty());
            let project = cwd
                .as_deref()
                .and_then(|c| std::path::Path::new(c).file_name())
                .and_then(|n| n.to_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("session {}", &id[..id.len().min(8)]));
            Some(DetectedSession {
                project,
                cwd,
                activity: snap.activity_state.value,
                last_active: snap.last_active_time.value,
                model: snap.model.value.map(|m| m.display_name),
                session_id: id,
            })
        })
        .collect();
    out.sort_by(|a, b| b.last_active.cmp(&a.last_active).then_with(|| a.session_id.cmp(&b.session_id)));
    out.truncate(MAX_OFFERED);
    out
}

#[tauri::command]
pub fn detected_sessions() -> Vec<DetectedSession> {
    detect_sessions(crate::watcher::now_epoch_s(), &default_is_pid_alive)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_dir<R>(files: &[(&str, &str)], f: impl FnOnce() -> R) -> R {
        let _guard = crate::session_reader::tests::ENV_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("zofia-detect-{}-{}", std::process::id(), files.len()));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, body) in files {
            std::fs::write(dir.join(name), body).unwrap();
        }
        std::env::set_var("ZOFIA_SESSIONS_DIR", &dir);
        let out = f();
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::fs::remove_dir_all(&dir).ok();
        out
    }

    fn hook(at: i64, name: &str) -> String {
        format!(r#"{{"observed_at":{at},"hook_event_name":"{name}"}}"#)
    }

    #[test]
    fn lists_live_sessions_by_folder_newest_first_and_skips_ended_ones() {
        let files = [
            ("aaaa1111-old.json", format!(r#"{{"pid":1,"cwd":"/home/u/Projects/SMO","latest_hook_event":{}}}"#, hook(100, "Stop"))),
            ("bbbb2222-new.json", format!(r#"{{"pid":1,"cwd":"/home/u/Projects/Zofia","latest_hook_event":{}}}"#, hook(200, "SessionStart"))),
            ("cccc3333-dead.json", format!(r#"{{"pid":2,"cwd":"/x/Gone","latest_hook_event":{}}}"#, hook(300, "Stop"))),
            ("dddd4444-ended.json", format!(r#"{{"pid":1,"cwd":"/x/Ended","latest_hook_event":{}}}"#, hook(400, "SessionEnd"))),
            ("eeee5555-nocwd.json", format!(r#"{{"latest_hook_event":{}}}"#, hook(50, "Stop"))),
            ("not a session!.json", "{}".to_string()),
            (".eeee5555-nocwd.lock", String::new()),
        ];
        let refs: Vec<(&str, &str)> = files.iter().map(|(n, b)| (*n, b.as_str())).collect();
        let found = with_dir(&refs, || detect_sessions(1000, &|pid| pid == 1));
        let names: Vec<(&str, &str)> = found.iter().map(|d| (d.project.as_str(), d.session_id.as_str())).collect();
        assert_eq!(names, vec![("Zofia", "bbbb2222-new"), ("SMO", "aaaa1111-old"), ("session eeee5555", "eeee5555-nocwd")]);
        assert_eq!(found[0].activity.as_deref(), Some("ready"));
        assert_eq!(found[0].last_active, Some(200));
        assert_eq!(found[0].cwd.as_deref(), Some("/home/u/Projects/Zofia"));
    }

    #[test]
    fn no_sessions_dir_means_an_empty_list() {
        let _guard = crate::session_reader::tests::ENV_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("ZOFIA_SESSIONS_DIR", "/nonexistent/zofia-detect-test");
        assert!(detect_sessions(0, &|_| true).is_empty());
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
    }
}
