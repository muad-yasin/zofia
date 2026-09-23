// PLAN.md §3, §1 disposition ledger row 6: "CLAUDE.md/.claude/.mcp.json hash sweep +
// trust-level tags", adapted from Sophi-A's sensitivePathsSweep
// (~/Projects/sophi-a/src/orchestrator/index.js) — same threat model, scoped down to
// the center seat's own workspace only ("it can vouch for nothing inside the owner's
// foreign corner terminals", PLAN.md §1 row 6's own reason).
//
// The threat: a running seat (or an injected instruction inside its own output) writes
// CLAUDE.md/.claude/.mcp.json into its own workdir. Those files are auto-loaded by
// Claude Code on every later turn, so a change that isn't the owner's own doing can
// persist an instruction across the whole session. The center seat launches with §3's
// read-only allow-list (`center_seat::policy_args`: --restricted --tools Read,Grep,Glob),
// so its own tools shouldn't be able to write here; whether the CLI really refuses is
// item 8's probe to measure. This sweep is defense-in-depth on top of that (PLAN.md §12:
// "defense in depth beats 'moved upstream'"), and it also catches writes by anything
// else on the machine.

use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// The two settings files are also fingerprinted on their own, outside the `.claude`
/// walk: the walk stops at MAX_ENTRIES in name order, so under a large `.claude` (a
/// workdir of $HOME holds every transcript) an edit to settings.json went unseen
/// (audit 2026-09-23 #6).
pub const SENSITIVE_PATHS: [&str; 5] =
    ["CLAUDE.md", ".claude", ".mcp.json", ".claude/settings.json", ".claude/settings.local.json"];

/// A fingerprint of the sensitive paths under one workdir at one point in time.
/// `None` for a path that doesn't exist — absence is itself part of the fingerprint, so
/// "a file was created where none existed" is detected the same way as "a file changed".
pub type Fingerprint = BTreeMap<&'static str, Option<String>>;

/// Walk bounds. A symlink loop, or a workdir of $HOME (whose `.claude` holds every session
/// transcript), must not hang or abort the GUI. Past a bound the fingerprint records a
/// `truncated` marker instead of reading more, so it stays deterministic.
const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 2_000;
const MAX_HASHED_BYTES: u64 = 1 << 20; // larger files are fingerprinted by their stat key

/// Everything the kernel changes when a file's content could have changed: a write moves
/// mtime *and* ctime, and resetting mtime afterwards (utimensat, `touch -d`) moves ctime
/// again. ctime can't be set back without root or a clock change, so an unchanged key
/// means unchanged content in practice (audit follow-up 2026-09-23: re-hashing ~70 MiB
/// every 5s with workdir = $HOME). dev+ino catch a file replaced by another.
type StatKey = (u64, u64, u64, i64, i64, i64, i64);

fn stat_key(m: &std::fs::Metadata) -> StatKey {
    use std::os::unix::fs::MetadataExt;
    (m.dev(), m.ino(), m.size(), m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec())
}

/// Memory-only (hashes, never content), one per seat. Entries not seen in a sweep are
/// dropped at its end, so the cache never outgrows the current tree.
#[derive(Default)]
pub struct SweepCache {
    hashes: HashMap<PathBuf, (StatKey, String)>,
    seen: HashSet<PathBuf>,
    /// Files actually read and hashed by the last sweep (cache misses), for tests.
    pub hashed_last_sweep: usize,
}

impl SweepCache {
    /// The stat key is taken *before* reading, so a write racing the read leaves a stale
    /// key behind and the next sweep re-hashes.
    fn file_hash(&mut self, path: &Path, meta: &std::fs::Metadata) -> Option<String> {
        let key = stat_key(meta);
        self.seen.insert(path.to_path_buf());
        if let Some((k, h)) = self.hashes.get(path) {
            if *k == key {
                return Some(h.clone());
            }
        }
        let h = if meta.len() > MAX_HASHED_BYTES {
            format!("large:{key:?}")
        } else {
            self.hashed_last_sweep += 1;
            format!("{:x}", Sha256::digest(&std::fs::read(path).ok()?))
        };
        self.hashes.insert(path.to_path_buf(), (key, h.clone()));
        Some(h)
    }
}

fn hash_file(path: &Path, cache: &mut SweepCache) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    cache.file_hash(path, &meta)
}

fn hash_file_following(path: &Path, cache: &mut SweepCache) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    cache.file_hash(path, &meta)
}

/// A symlink is fingerprinted by its target string and never followed, so a link loop or
/// a link out of the workdir can't make the sweep read beyond it.
fn hash_entry(path: &Path, ft: std::fs::FileType, cache: &mut SweepCache) -> String {
    if ft.is_symlink() {
        let target = std::fs::read_link(path).map(|t| t.to_string_lossy().to_string()).unwrap_or_default();
        format!("symlink:{target}")
    } else if ft.is_file() {
        hash_file(path, cache).unwrap_or_else(|| "unreadable".to_string())
    } else {
        "dir".to_string()
    }
}

/// Mirrors Sophi-A's `hashPath`: a file hashes its own bytes; a directory hashes a
/// sorted `name:hash` listing of every entry inside it (recursively, bounded), so a rename
/// or a moved/added/removed file changes the fingerprint even if no single file's own
/// bytes did.
fn hash_path(path: &Path, cache: &mut SweepCache) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        // A top-level link (e.g. CLAUDE.md -> a shared file, or a `.claude` dir kept
        // elsewhere) is what Claude Code reads through, so its target counts too, one hop:
        // a file's bytes, or a directory's bounded walk. Links inside that walk are still
        // never followed. (Audit 2026-09-23 #6: a symlinked `.claude` was fingerprinted by
        // its link target string only.)
        let target = std::fs::metadata(path).ok();
        let content = match target {
            Some(m) if m.is_file() => hash_file_following(path, cache).unwrap_or_default(),
            Some(m) if m.is_dir() => walk_listing(path, cache),
            _ => String::new(),
        };
        return Some(format!("{}|{}", hash_entry(path, meta.file_type(), cache), content));
    }
    if !meta.is_dir() {
        return Some(hash_entry(path, meta.file_type(), cache));
    }
    Some(walk_listing(path, cache))
}

fn walk_listing(dir: &Path, cache: &mut SweepCache) -> String {
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut truncated = false;
    walk_dir(dir, 0, &mut entries, &mut truncated, dir, cache);
    entries.sort();
    if truncated {
        entries.push(("~truncated".to_string(), MAX_ENTRIES.to_string()));
    }
    entries.into_iter().map(|(name, hash)| format!("{name}:{hash}")).collect::<Vec<_>>().join("|")
}

fn walk_dir(dir: &Path, depth: usize, out: &mut Vec<(String, String)>, truncated: &mut bool, root: &Path, cache: &mut SweepCache) {
    if depth > MAX_DEPTH {
        *truncated = true;
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut children: Vec<_> = read.flatten().collect();
    children.sort_by_key(|e| e.file_name()); // deterministic truncation point
    for entry in children {
        if out.len() >= MAX_ENTRIES {
            *truncated = true;
            return;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue }; // does not follow symlinks
        let name = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();
        out.push((name, hash_entry(&path, ft, cache)));
        if ft.is_dir() {
            walk_dir(&path, depth + 1, out, truncated, root, cache);
        }
    }
}

/// Fingerprints the sensitive paths under `workdir` right now, from scratch.
#[cfg_attr(not(test), allow(dead_code))] // the seat always sweeps through its cache
pub fn sweep(workdir: &Path) -> Fingerprint {
    sweep_cached(workdir, &mut SweepCache::default())
}

/// Same fingerprint as `sweep`, re-hashing only files whose stat key changed since the
/// last sweep that used this cache.
pub fn sweep_cached(workdir: &Path, cache: &mut SweepCache) -> Fingerprint {
    cache.seen.clear();
    cache.hashed_last_sweep = 0;
    let fp = SENSITIVE_PATHS.iter().map(|&p| (p, hash_path(&workdir.join(p), cache))).collect();
    let seen = std::mem::take(&mut cache.seen);
    cache.hashes.retain(|p, _| seen.contains(p));
    fp
}

/// Compares two fingerprints of the same workdir, returning the sensitive paths that
/// differ (empty if nothing changed). `None` on either side means "first ever sweep" is
/// the caller's job to distinguish — this function only ever compares two real snapshots.
pub fn changed_paths(baseline: &Fingerprint, current: &Fingerprint) -> Vec<&'static str> {
    SENSITIVE_PATHS.iter().filter(|&&p| baseline.get(p) != current.get(p)).copied().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_workdir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zofia-hash-sweep-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_workdir_every_path_absent() {
        let dir = tmp_workdir("empty");
        let fp = sweep(&dir);
        assert_eq!(fp.len(), SENSITIVE_PATHS.len());
        assert!(fp.values().all(|v| v.is_none()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unchanged_content_same_fingerprint() {
        let dir = tmp_workdir("unchanged");
        fs::write(dir.join("CLAUDE.md"), "hello").unwrap();
        let a = sweep(&dir);
        let b = sweep(&dir);
        assert_eq!(changed_paths(&a, &b), Vec::<&str>::new());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_appearing_where_none_existed_is_detected() {
        let dir = tmp_workdir("appear");
        let baseline = sweep(&dir); // nothing exists yet
        fs::write(dir.join(".mcp.json"), "{}").unwrap();
        let current = sweep(&dir);
        assert_eq!(changed_paths(&baseline, &current), vec![".mcp.json"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_edited_in_place_is_detected() {
        let dir = tmp_workdir("edit");
        fs::write(dir.join("CLAUDE.md"), "original").unwrap();
        let baseline = sweep(&dir);
        fs::write(dir.join("CLAUDE.md"), "injected instruction").unwrap();
        let current = sweep(&dir);
        assert_eq!(changed_paths(&baseline, &current), vec!["CLAUDE.md"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_directory_entry_renamed_inside_dot_claude_is_detected() {
        let dir = tmp_workdir("dirrename");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(dir.join(".claude").join("settings.json"), "{}").unwrap();
        let baseline = sweep(&dir);
        fs::rename(dir.join(".claude").join("settings.json"), dir.join(".claude").join("settings-2.json")).unwrap();
        let current = sweep(&dir);
        // settings.json vanished from its own key too (it's fingerprinted separately).
        assert_eq!(changed_paths(&baseline, &current), vec![".claude", ".claude/settings.json"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_symlink_loop_inside_dot_claude_terminates_and_is_fingerprinted() {
        let dir = tmp_workdir("symloop");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        std::os::unix::fs::symlink(dir.join(".claude"), dir.join(".claude").join("loop")).unwrap();
        let a = sweep(&dir);
        assert!(a[".claude"].as_deref().unwrap().contains("symlink:"));
        fs::remove_file(dir.join(".claude").join("loop")).unwrap();
        std::os::unix::fs::symlink("/elsewhere", dir.join(".claude").join("loop")).unwrap();
        assert_eq!(changed_paths(&a, &sweep(&dir)), vec![".claude"], "retargeted link must be detected");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_top_level_claude_md_symlink_tracks_its_target_content() {
        let dir = tmp_workdir("toplink");
        let target = dir.join("shared.md");
        fs::write(&target, "v1").unwrap();
        std::os::unix::fs::symlink(&target, dir.join("CLAUDE.md")).unwrap();
        let a = sweep(&dir);
        fs::write(&target, "v2 injected").unwrap();
        assert_eq!(changed_paths(&a, &sweep(&dir)), vec!["CLAUDE.md"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_huge_dot_claude_is_bounded_not_walked_whole() {
        let dir = tmp_workdir("huge");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        for i in 0..(MAX_ENTRIES + 50) {
            fs::write(dir.join(".claude").join(format!("t{i:05}")), "x").unwrap();
        }
        let fp = sweep(&dir);
        let v = fp[".claude"].as_deref().unwrap();
        assert!(v.contains("~truncated"));
        assert_eq!(fp, sweep(&dir), "bounded fingerprint must stay deterministic");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unrelated_files_in_the_workdir_never_affect_the_fingerprint() {
        let dir = tmp_workdir("unrelated");
        fs::write(dir.join("README.md"), "not sensitive").unwrap();
        let baseline = sweep(&dir);
        fs::write(dir.join("README.md"), "changed but still not sensitive").unwrap();
        fs::write(dir.join("notes.txt"), "brand new but still not sensitive").unwrap();
        let current = sweep(&dir);
        assert_eq!(changed_paths(&baseline, &current), Vec::<&str>::new());
        fs::remove_dir_all(&dir).ok();
    }

    /// Audit 2026-09-23 #6a: past the 2,000-entry walk cap an edit to settings.json used
    /// to go unseen.
    #[test]
    fn a_settings_edit_is_seen_even_past_the_walk_cap() {
        let dir = tmp_workdir("cap");
        fs::create_dir_all(dir.join(".claude/projects")).unwrap();
        for i in 0..2_100 {
            fs::write(dir.join(format!(".claude/projects/t{i:05}.jsonl")), "x").unwrap();
        }
        fs::write(dir.join(".claude/settings.json"), "{}").unwrap();
        let before = sweep(&dir);
        fs::write(dir.join(".claude/settings.json"), r#"{"permissions":{"allow":["Bash(*)"]}}"#).unwrap();
        let changed = changed_paths(&before, &sweep(&dir));
        assert!(changed.contains(&".claude/settings.json"), "got {changed:?}");
        fs::remove_dir_all(&dir).ok();
    }

    /// Audit 2026-09-23 #6b: a symlinked `.claude` directory.
    #[test]
    fn a_change_inside_a_symlinked_claude_dir_is_seen() {
        let dir = tmp_workdir("symlinked");
        let real = tmp_workdir("symlinked-target");
        fs::write(real.join("hooks.json"), "{}").unwrap();
        std::os::unix::fs::symlink(&real, dir.join(".claude")).unwrap();
        let before = sweep(&dir);
        fs::write(real.join("hooks.json"), r#"{"Stop":[]}"#).unwrap();
        assert!(changed_paths(&before, &sweep(&dir)).contains(&".claude"));
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&real).ok();
    }

    /// C&C follow-up 2026-09-23: an unchanged tree is not re-read, but a same-size edit
    /// whose mtime was put back afterwards is still caught (ctime moved).
    #[test]
    fn the_cache_skips_unchanged_files_but_catches_an_edit_with_mtime_reset() {
        let dir = tmp_workdir("cache");
        fs::create_dir_all(dir.join(".claude/projects")).unwrap();
        for i in 0..50 {
            fs::write(dir.join(format!(".claude/projects/t{i}.jsonl")), format!("line {i}")).unwrap();
        }
        let target = dir.join(".claude/projects/t7.jsonl");
        let mut cache = SweepCache::default();
        let baseline = sweep_cached(&dir, &mut cache);
        assert!(cache.hashed_last_sweep >= 50);

        assert_eq!(sweep_cached(&dir, &mut cache), baseline);
        assert_eq!(cache.hashed_last_sweep, 0, "an unchanged tree was re-read");

        let mtime = fs::metadata(&target).unwrap().modified().unwrap();
        fs::write(&target, "LINE 7").unwrap(); // same length as "line 7"
        fs::File::options().write(true).open(&target).unwrap().set_modified(mtime).unwrap();
        assert_eq!(fs::metadata(&target).unwrap().modified().unwrap(), mtime, "mtime reset");
        let after = sweep_cached(&dir, &mut cache);
        assert_eq!(changed_paths(&baseline, &after), vec![".claude"]);
        assert_eq!(cache.hashed_last_sweep, 1, "only the edited file is re-read");
        // And the cached result equals a from-scratch sweep.
        assert_eq!(after, sweep(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_cache_forgets_deleted_files() {
        let dir = tmp_workdir("cache-prune");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(dir.join(".claude/a"), "a").unwrap();
        let mut cache = SweepCache::default();
        sweep_cached(&dir, &mut cache);
        fs::remove_file(dir.join(".claude/a")).unwrap();
        sweep_cached(&dir, &mut cache);
        assert!(cache.hashes.keys().all(|p| !p.ends_with("a")));
        fs::remove_dir_all(&dir).ok();
    }
}
