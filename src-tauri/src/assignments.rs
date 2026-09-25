// Owner decision 2026-09-23 (DECISIONS.md, option B): which session_id sits in which corner
// survives a GUI restart but not a reboot. Stored next to the session state files, on
// tmpfs: $XDG_RUNTIME_DIR/zofia/assignments.json (0600, dir 0700). It holds ids and the
// labels the owner typed, never any session content. Restored corners are marked as
// such in the UI, and "Clear all" empties this file.
//
// Registration stays deliberate (PLAN.md §2.1): this only ever replays the owner's own
// earlier assignments from this boot; it never discovers a session.

use crate::session_reader::{is_valid_session_id, sessions_dir};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

const VERSION: u32 = 1;
const MAX_LABEL: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assignment {
    pub corner: u8,
    pub session_id: String,
    pub label: String,
    pub assigned_at: i64,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    corners: Vec<Assignment>,
}

/// Beside the sessions dir, so it follows the same XDG_RUNTIME_DIR (or test override).
pub fn assignments_path() -> PathBuf {
    let sessions = sessions_dir();
    sessions.parent().map(|p| p.to_path_buf()).unwrap_or(sessions).join("assignments.json")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn valid(a: &Assignment) -> bool {
    a.corner <= 3 && is_valid_session_id(&a.session_id) && a.label.chars().count() <= MAX_LABEL
}

/// The saved assignments, one per corner at most. No file means none. A file that isn't
/// ours, or isn't this format, is an error rather than a guess; entries that fail
/// validation are dropped.
pub fn load() -> Result<Vec<Assignment>, String> {
    let path = assignments_path();
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("can't read {}: {e}", path.display())),
    };
    crate::platform::check_owned(&meta, &path).map_err(|e| format!("{e}; not restoring from it"))?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("can't read {}: {e}", path.display()))?;
    let file: File = serde_json::from_str(&text).map_err(|e| format!("{} isn't a valid assignments file: {e}", path.display()))?;
    if file.version != VERSION {
        return Err(format!("{} has version {}, expected {VERSION}", path.display(), file.version));
    }
    let mut out: Vec<Assignment> = Vec::new();
    for a in file.corners.into_iter().filter(valid) {
        if !out.iter().any(|b| b.corner == a.corner || b.session_id == a.session_id) {
            out.push(a);
        }
    }
    out.sort_by_key(|a| a.corner);
    Ok(out)
}

fn save(corners: &[Assignment]) -> Result<(), String> {
    let path = assignments_path();
    let dir = path.parent().ok_or("assignments path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let dmeta = std::fs::metadata(dir).map_err(|e| e.to_string())?;
    crate::platform::check_owned(&dmeta, dir).map_err(|e| format!("{e}; not writing there"))?;
    crate::platform::make_dir_private(dir);
    let body = serde_json::to_string_pretty(&File { version: VERSION, corners: corners.to_vec() }).map_err(|e| e.to_string())?;
    // Atomic: a crash mid-write leaves the old file, never a torn one.
    let tmp = dir.join(format!(".assignments.json.{}", std::process::id()));
    let mut f = crate::platform::private_file(std::fs::OpenOptions::new().write(true).create(true).truncate(true))
        .open(&tmp)
        .map_err(|e| format!("can't write {}: {e}", tmp.display()))?;
    f.write_all(body.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("can't replace {}: {e}", path.display()))
}

/// Records the owner's assignment of `session_id` to `corner`, replacing whatever was
/// there and removing that session from any other corner.
pub fn set(corner: u8, session_id: &str, label: &str) -> Result<(), String> {
    let a = Assignment { corner, session_id: session_id.to_string(), label: label.to_string(), assigned_at: now() };
    if !valid(&a) {
        return Err(format!("not a valid assignment: corner {corner}, session_id {session_id:?}"));
    }
    let mut corners = load().unwrap_or_default();
    corners.retain(|b| b.corner != corner && b.session_id != session_id);
    corners.push(a);
    corners.sort_by_key(|a| a.corner);
    save(&corners)
}

/// "Clear all": nothing is restored at the next launch.
pub fn clear() -> Result<(), String> {
    save(&[])
}

#[tauri::command]
pub fn assignments_get() -> Result<Vec<Assignment>, String> {
    load()
}

#[tauri::command]
pub fn assignment_set(corner: u8, session_id: String, label: String) -> Result<(), String> {
    set(corner, &session_id, &label)
}

#[tauri::command]
pub fn assignments_clear() -> Result<(), String> {
    clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_reader::tests::ENV_TEST_LOCK;

    fn with_dir<R>(tag: &str, f: impl FnOnce(&std::path::Path) -> R) -> R {
        let _guard = ENV_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(format!("zofia-assign-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::env::set_var("ZOFIA_SESSIONS_DIR", root.join("sessions"));
        let out = f(&root);
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::fs::remove_dir_all(&root).ok();
        out
    }

    #[test]
    fn nothing_saved_means_nothing_restored() {
        with_dir("empty", |_| assert_eq!(load().unwrap(), vec![]));
    }

    #[test]
    fn set_round_trips_privately_and_one_session_holds_one_corner() {
        with_dir("roundtrip", |root| {
            set(0, "aaaa-1", "repo A").unwrap();
            set(2, "bbbb-2", "SMO").unwrap();
            set(1, "aaaa-1", "repo A moved").unwrap(); // moves, doesn't duplicate
            set(2, "cccc-3", "replaces SMO").unwrap();
            let got = load().unwrap();
            let pairs: Vec<(u8, &str)> = got.iter().map(|a| (a.corner, a.session_id.as_str())).collect();
            assert_eq!(pairs, vec![(1, "aaaa-1"), (2, "cccc-3")]);
            assert_eq!(got[0].label, "repo A moved");

            let path = root.join("assignments.json");
            assert_eq!(path, assignments_path());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
                assert_eq!(std::fs::metadata(root).unwrap().permissions().mode() & 0o777, 0o700);
            }
            assert!(!std::fs::read_dir(root).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".assignments")), "temp file left behind");
        });
    }

    #[test]
    fn clear_all_empties_it() {
        with_dir("clear", |_| {
            set(0, "aaaa-1", "A").unwrap();
            clear().unwrap();
            assert_eq!(load().unwrap(), vec![]);
        });
    }

    #[test]
    fn invalid_input_is_refused_and_bad_entries_are_dropped_on_load() {
        with_dir("invalid", |root| {
            assert!(set(4, "aaaa-1", "A").is_err());
            assert!(set(0, "../escape", "A").is_err());
            assert!(set(0, "aaaa-1", &"x".repeat(201)).is_err());
            std::fs::create_dir_all(root).unwrap();
            std::fs::write(
                root.join("assignments.json"),
                r#"{"version":1,"corners":[
                    {"corner":0,"session_id":"ok-1","label":"A","assigned_at":1},
                    {"corner":0,"session_id":"dup-corner","label":"B","assigned_at":1},
                    {"corner":9,"session_id":"bad-corner","label":"C","assigned_at":1},
                    {"corner":1,"session_id":"../x","label":"D","assigned_at":1},
                    {"corner":2,"session_id":"ok-1","label":"dup id","assigned_at":1}]}"#,
            )
            .unwrap();
            let ids: Vec<String> = load().unwrap().into_iter().map(|a| a.session_id).collect();
            assert_eq!(ids, vec!["ok-1"]);

            std::fs::write(root.join("assignments.json"), r#"{"version":2,"corners":[]}"#).unwrap();
            assert!(load().unwrap_err().contains("version 2"));
            std::fs::write(root.join("assignments.json"), "not json").unwrap();
            assert!(load().is_err());
        });
    }
}
