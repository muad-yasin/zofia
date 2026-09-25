// PLAN.md §3: the owned-PTY center seat. "Ownership is a capability boundary, checked
// on every Tauri/WebSocket/MCP control path: only the owned center PTY may receive
// input, resize, or a termination signal." There is exactly one center seat at a time —
// CENTER_SEAT_SESSION_ID is a fixed sentinel, not a secret; every input/resize/stop path
// takes a session_id and rejects anything that isn't this exact value, so an attempt
// aimed at an observed corner session_id fails a real check in this module, not merely
// "there's no code path for it" (HANDOFF.md item 4's own acceptance wording).
//
// The kill-then-confirm shape and the env allowlist are adapted from Sophi-A's
// claudeCodeSubprocess.js (~/Projects/sophi-a/src/orchestrator/adapters/
// claudeCodeSubprocess.js) — that file spawns a headless, non-interactive `claude -p ...
// --output-format stream-json` subprocess per turn, not a PTY, so only the safety
// patterns carry over, not the mechanism, and not verbatim (see PtySeat::stop's own doc
// comment for a real deviation found while testing this against the mock). TERM is set
// explicitly rather than passed through (Sophi-A's model never rendered a terminal): the
// seat's terminal is always xterm.js, whatever launched the GUI (audit 2026-09-23 #4).

use crate::hash_sweep::{self, Fingerprint, SweepCache};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const CENTER_SEAT_SESSION_ID: &str = "center-seat";
const KILL_ESCALATION_MS: u64 = 5_000; // matches Sophi-A's own KILL_ESCALATION_MS
/// Input chunks (one per xterm onData, so a whole paste is one chunk) queued for a child
/// that isn't reading. Past this the write is refused, not blocked on.
const INPUT_QUEUE: usize = 256;

// XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS: without them the child's per-user runtime
// files fall back to shared /tmp and a keyring-backed credential store can't be reached.
// Both are what the owner's own terminals already pass (DECISIONS.md, 2026-09-23).
const SAFE_ENV_KEYS: [&str; 11] = [
    "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "USER", "SHELL",
    "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
];
/// Windows: without SystemRoot and friends a child can't load system DLLs or find its
/// profile, and Claude Code looks for Git Bash itself (CLAUDE_CODE_GIT_BASH_PATH).
#[cfg(windows)]
const WINDOWS_ENV_KEYS: [&str; 12] = [
    "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "USERPROFILE", "USERNAME",
    "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "CLAUDE_CODE_GIT_BASH_PATH",
];

/// What the child is told about its terminal. The PTY's other end is always the webview's
/// xterm.js, so this is fixed, never inherited: launched from a desktop entry or the
/// AppImage the GUI has no TERM at all (the seat rendered monochrome), and launched from
/// a terminal it had that terminal's TERM (e.g. xterm-kitty), which xterm.js is not.
const SEAT_TERM: [(&str, &str); 2] = [("TERM", "xterm-256color"), ("COLORTERM", "truecolor")];

pub struct PtySeat {
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    /// To the seat's one writer thread: ordered, and write_input never blocks on a child
    /// that stopped reading (item 4 audit backlog: a 256 KiB paste into a stalled child
    /// held the seat lock for >3s).
    input: SyncSender<Vec<u8>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    baseline: Fingerprint,
    workdir: PathBuf,
    /// Shared with each resweep so only changed files are re-read (hash_sweep::SweepCache).
    sweep_cache: Arc<Mutex<SweepCache>>,
    #[cfg_attr(not(test), allow(dead_code))]
    pid: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ForeignSettingsInfo {
    pub settings_json: Option<String>,
    pub settings_local_json: Option<String>,
    pub mcp_json: Option<String>,
    /// SHA-256 over the three files' exact bytes (or their absence). The owner's
    /// confirmation carries this back, so a file that changes between the dialog and the
    /// spawn invalidates it (item 4 audit backlog: the confirmation was a bare boolean).
    pub digest: String,
}

/// The file's contents for the confirmation dialog if anything exists at `path`, `None`
/// only if nothing does. Presence decides, never readability (audit 2026-09-23 #3): a
/// file with one invalid UTF-8 byte, or one we can't read, is still a file Claude Code may
/// load, so it's shown (lossily, or as a note) rather than treated as absent.
fn foreign_file(path: &Path, hasher: &mut sha2::Sha256) -> Option<String> {
    use sha2::Digest;
    hasher.update(path.file_name().map(|n| n.as_encoded_bytes()).unwrap_or_default());
    if std::fs::symlink_metadata(path).is_err() {
        hasher.update(b"\0absent\0");
        return None;
    }
    Some(match std::fs::read(path) {
        Ok(bytes) => {
            hasher.update((bytes.len() as u64).to_le_bytes());
            hasher.update(&bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        }
        Err(e) => {
            hasher.update(b"\0unreadable\0");
            format!("(present but unreadable: {e})")
        }
    })
}

/// Pure, side-effect-free: does `workdir` contain its own `.claude/settings.json`,
/// `.claude/settings.local.json` or `.mcp.json`? PLAN.md §3: "Foreign project settings are
/// not silently inherited ... shows the owner that file's permission/MCP entries and
/// requires confirmation before launch." Returns `None` if none exists.
pub fn detect_foreign_settings(workdir: &Path) -> Option<ForeignSettingsInfo> {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    let settings_json = foreign_file(&workdir.join(".claude").join("settings.json"), &mut h);
    let settings_local_json = foreign_file(&workdir.join(".claude").join("settings.local.json"), &mut h);
    let mcp_json = foreign_file(&workdir.join(".mcp.json"), &mut h);
    let info = ForeignSettingsInfo { settings_json, settings_local_json, mcp_json, digest: format!("{:x}", h.finalize()) };
    if info.settings_json.is_none() && info.settings_local_json.is_none() && info.mcp_json.is_none() {
        return None;
    }
    Some(info)
}

fn safe_env() -> Vec<(String, String)> {
    #[cfg(windows)]
    let keys = SAFE_ENV_KEYS.iter().chain(WINDOWS_ENV_KEYS.iter());
    #[cfg(not(windows))]
    let keys = SAFE_ENV_KEYS.iter();
    keys.filter_map(|&k| std::env::var(k).ok().map(|v| (k.to_string(), v))).collect()
}

/// Spawns `command` under an owned PTY in `workdir`. Returns the seat handle plus a
/// boxed reader for the caller to forward PTY output from — kept out of this struct on
/// purpose, so this module owns lifecycle/ownership/hash-sweep only, never the transport
/// (ws_gate.rs's job) or a thread of its own.
pub fn spawn(command: &str, args: &[&str], workdir: &Path) -> Result<(PtySeat, Box<dyn Read + Send>), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("failed to open a pty: {e}"))?;

    let mut cmd = CommandBuilder::new(command);
    cmd.args(args);
    cmd.cwd(workdir);
    cmd.env_clear();
    for (k, v) in safe_env() {
        cmd.env(k, v);
    }
    for (k, v) in SEAT_TERM {
        cmd.env(k, v);
    }

    // Baseline first: a child that writes CLAUDE.md in its first milliseconds must show up
    // as a change, not be folded into the baseline.
    let mut cache = SweepCache::default();
    let baseline = hash_sweep::sweep_cached(workdir, &mut cache);
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("failed to spawn {command}: {e}"))?;
    let pid = child.process_id();

    // The slave end is only needed to spawn the child; portable-pty's own contract is
    // that the master stays open for the lifetime of the session (dropping the slave
    // handle here does not close the pty).
    drop(pair.slave);

    let mut writer = pair.master.take_writer().map_err(|e| format!("failed to take the pty writer: {e}"))?;
    let (input, queued) = sync_channel::<Vec<u8>>(INPUT_QUEUE);
    // Ends when the seat (the sender) is dropped, or the pty stops accepting input.
    std::thread::spawn(move || {
        for chunk in queued {
            if writer.write_all(&chunk).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });
    let reader = pair.master.try_clone_reader().map_err(|e| format!("failed to clone the pty reader: {e}"))?;

    let seat = PtySeat {
        master: Mutex::new(pair.master),
        input,
        child: Mutex::new(child),
        baseline,
        workdir: workdir.to_path_buf(),
        sweep_cache: Arc::new(Mutex::new(cache)),
        pid,
    };
    Ok((seat, reader))
}

impl PtySeat {
    #[cfg_attr(not(test), allow(dead_code))] // tests and item 6's PID-tree audit
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Whether the seat's own process has exited (not merely closed the pty: a child can
    /// keep the pty open after the leader is gone). Doesn't reap; stop() does.
    pub fn leader_exited(&self) -> bool {
        let Some(pid) = self.pid else { return false };
        crate::platform::leader_exited(pid)
    }

    /// Ownership boundary (PLAN.md §3): only `CENTER_SEAT_SESSION_ID` may ever write.
    /// Anything else — including a real observed corner session_id — is rejected here,
    /// not merely absent from the API surface.
    pub fn write_input(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        if session_id != CENTER_SEAT_SESSION_ID {
            return Err(format!("ownership check failed: \"{session_id}\" is not the owned center seat"));
        }
        match self.input.try_send(data.to_vec()) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("the center seat isn't reading its input; this input was dropped".to_string()),
            Err(TrySendError::Disconnected(_)) => Err("the center seat's input is closed".to_string()),
        }
    }

    /// Ownership boundary again: only the owned center seat may be resized.
    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        if session_id != CENTER_SEAT_SESSION_ID {
            return Err(format!("ownership check failed: \"{session_id}\" is not the owned center seat"));
        }
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
    }

    /// Re-sweeps the workdir's sensitive paths (`hash_sweep::SENSITIVE_PATHS`) against
    /// the baseline captured at spawn time; returns the paths that changed, if any.
    #[cfg_attr(not(test), allow(dead_code))] // center_resweep uses sweep_inputs, off the lock
    pub fn resweep(&self) -> Vec<&'static str> {
        let (workdir, baseline, cache) = self.sweep_inputs();
        resweep_with(&workdir, &baseline, &cache)
    }

    /// What a resweep needs, cloned, so a caller can run the (possibly slow) sweep without
    /// holding the seat's lock (audit 2026-09-23 #6: it ran on the GUI main thread).
    pub fn sweep_inputs(&self) -> (PathBuf, Fingerprint, Arc<Mutex<SweepCache>>) {
        (self.workdir.clone(), self.baseline.clone(), self.sweep_cache.clone())
    }

    /// Stops the owned seat's whole process group, escalating, then confirms the leader
    /// exited, returning an error rather than pretending success if it didn't.
    ///
    /// Mirrors Sophi-A's killEscalating with SIGHUP in place of SIGTERM (a PTY hangup is
    /// what a closed terminal sends). Two real findings, recorded in DECISIONS.md:
    /// - portable-pty 0.9's cloned `ChildKiller` sends SIGHUP **only**, never SIGKILL, so a
    ///   child that trapped SIGHUP survived the pre-2026-09-23 stop()
    ///   (`stop_escalates_when_the_child_ignores_the_polite_signal`).
    /// - Signalling only the leader pid leaves its own children (a real CLI's tool
    ///   subprocesses) running. portable-pty starts the child with setsid, so its pid is
    ///   its process group id; both signals go to the group.
    /// Stops the seat and reaps its leader. `Ok` carries how the leader ended ("exited with
    /// code 0", "ended by signal SIGHUP"), as first reaped (quality check Q11): for a seat that
    /// exited on its own, that is its real exit, since the leader is already a zombie here.
    pub fn stop(&self, session_id: &str) -> Result<Option<String>, String> {
        if session_id != CENTER_SEAT_SESSION_ID {
            return Err(format!("ownership check failed: \"{session_id}\" is not the owned center seat"));
        }
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        stop_owned(&mut **child, self.pid)
    }
}

#[cfg(unix)]
fn stop_owned(child: &mut (dyn portable_pty::Child + Send + Sync), pid: Option<u32>) -> Result<Option<String>, String> {
    let pgid = pid.ok_or("the center seat has no pid to signal")? as i32;
    if pgid <= 1 {
        return Err(format!("refusing to signal process group {pgid}"));
    }
    // Listed before any signal: once the leader dies its orphans are reparented and the
    // link to the seat is gone. Catches descendants that left the group with setsid.
    // /proc only: on macOS this list is empty and the group signal alone applies.
    let tree = descendants(pgid as u32);
    signal_group(pgid, libc::SIGHUP);
    let first = wait_for_exit(child, KILL_ESCALATION_MS);
    // SIGKILL the group either way: members that ignored SIGHUP must not outlive the
    // seat even when the leader itself exited politely. ESRCH (group gone) is fine.
    signal_group(pgid, libc::SIGKILL);
    kill_listed(&tree);
    match first.or_else(|| wait_for_exit(child, 1_000)) {
        Some(status) => Ok(Some(describe_exit(&status))),
        None => Err("center seat process survived SIGKILL escalation".to_string()),
    }
}

/// TODO(windows): no process group here. TerminateProcess ends the leader only; its own
/// children (a real CLI's tool subprocesses) need a Job Object with
/// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE assigned at spawn, which portable-pty 0.9 doesn't do.
#[cfg(windows)]
fn stop_owned(child: &mut (dyn portable_pty::Child + Send + Sync), _pid: Option<u32>) -> Result<Option<String>, String> {
    let _ = child.kill();
    match wait_for_exit(child, KILL_ESCALATION_MS) {
        Some(status) => Ok(Some(describe_exit(&status))),
        None => Err("center seat process survived TerminateProcess".to_string()),
    }
}

/// The paths changed since `baseline`, re-hashing only files the cache says changed.
pub fn resweep_with(workdir: &Path, baseline: &Fingerprint, cache: &Mutex<SweepCache>) -> Vec<&'static str> {
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    hash_sweep::changed_paths(baseline, &hash_sweep::sweep_cached(workdir, &mut cache))
}

/// (pid, start time) of every live descendant of `root`, from /proc. The start time
/// guards the later kill against pid reuse. A descendant already orphaned before this
/// runs (a double-forking daemon) isn't found: only a cgroup would hold those.
#[cfg(unix)]
fn descendants(root: u32) -> Vec<(u32, u64)> {
    let mut parent_of: Vec<(u32, u32, u64)> = Vec::new();
    if let Ok(dir) = std::fs::read_dir("/proc") {
        for e in dir.flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
            if let Some((ppid, start)) = stat_ppid_start(pid) {
                parent_of.push((pid, ppid, start));
            }
        }
    }
    let mut out = Vec::new();
    let mut frontier = vec![root];
    while let Some(p) = frontier.pop() {
        for &(pid, ppid, start) in &parent_of {
            if ppid == p && !out.iter().any(|&(q, _)| q == pid) {
                out.push((pid, start));
                frontier.push(pid);
            }
        }
    }
    out
}

/// Fields 4 (ppid) and 22 (starttime) of /proc/<pid>/stat, parsed after the comm field's
/// closing paren (comm may itself contain spaces or parens).
#[cfg(unix)]
fn stat_ppid_start(pid: u32) -> Option<(u32, u64)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 2..];
    let f: Vec<&str> = rest.split_whitespace().collect();
    Some((f.get(1)?.parse().ok()?, f.get(19)?.parse().ok()?))
}

#[cfg(unix)]
fn kill_listed(tree: &[(u32, u64)]) {
    for &(pid, start) in tree {
        if stat_ppid_start(pid).map(|(_, s)| s) == Some(start) {
            // SAFETY: kill(2) on a pid just re-verified to be the same process; no memory touched.
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }
}

#[cfg(unix)]
fn signal_group(pgid: i32, sig: libc::c_int) {
    // SAFETY: kill(2) with a negative pid signals that process group; no memory is touched.
    unsafe {
        libc::kill(-pgid, sig);
    }
}

fn wait_for_exit(child: &mut (dyn portable_pty::Child + Send + Sync), window_ms: u64) -> Option<portable_pty::ExitStatus> {
    let deadline = std::time::Instant::now() + Duration::from_millis(window_ms);
    while std::time::Instant::now() < deadline {
        if let Some(status) = child.try_wait().ok().flatten() {
            return Some(status);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

fn describe_exit(status: &portable_pty::ExitStatus) -> String {
    match status.signal() {
        Some(sig) => format!("ended by signal {sig}"),
        None => format!("exited with code {}", status.exit_code()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn mock_claude_path() -> String {
        // CARGO_MANIFEST_DIR is src-tauri/; the fixture lives at the repo root.
        let dir = env!("CARGO_MANIFEST_DIR");
        format!("{dir}/../test/fixtures/mock-claude.sh")
    }

    /// Real bug found writing these tests: a plain blocking `reader.read()` has no way
    /// to time out mid-call, so a test loop's own "deadline" check between reads never
    /// gets a chance to fire while a read is in flight — it only ever fires once a read
    /// *returns*. That's invisible right up until a test expects silence (nothing more
    /// ever arrives), at which point the read blocks forever and the test hangs, not
    /// fails. Moving the blocking read onto its own thread and communicating through a
    /// channel makes "wait up to N seconds, then give up" a real, honest operation
    /// (`recv_timeout`) instead of a check that can't run while it matters most.
    fn spawn_reader_channel(mut reader: Box<dyn Read + Send>) -> mpsc::Receiver<Vec<u8>> {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 256];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // receiver dropped (test ended) — stop reading
                        }
                    }
                }
            }
        });
        rx
    }

    fn read_until(rx: &mpsc::Receiver<Vec<u8>>, needle: &str, max_bytes: usize) -> String {
        let mut out = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !out.contains(needle) && out.len() < max_bytes {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(chunk) => out.push_str(&String::from_utf8_lossy(&chunk)),
                Err(_) => break, // real timeout, or the reader thread ended — either way, stop
            }
        }
        out
    }

    #[test]
    fn typed_input_reaches_the_fake_byte_for_byte() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        let ready = read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        assert!(ready.contains("MOCK-CLAUDE-READY"), "got: {ready}");

        seat.write_input(CENTER_SEAT_SESSION_ID, b"hello zofia\n").expect("write should succeed for the owned seat");
        let out = read_until(&rx, "HEARD:hello zofia", 4096);
        assert!(out.contains("HEARD:hello zofia"), "got: {out}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn a_raw_esc_byte_with_no_newline_is_still_delivered() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        seat.write_input(CENTER_SEAT_SESSION_ID, b"\x1b").expect("write should succeed");
        let out = read_until(&rx, "ESC-RECEIVED", 4096);
        assert!(out.contains("ESC-RECEIVED"), "raw ESC byte never reached the child's stdin — got: {out}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn ctrl_c_arrives_as_a_real_sigint_the_mock_can_handle() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        seat.write_input(CENTER_SEAT_SESSION_ID, b"\x03").expect("write should succeed");
        let out = read_until(&rx, "SIGINT-RECEIVED", 4096);
        assert!(out.contains("SIGINT-RECEIVED"), "Ctrl+C byte never produced a real SIGINT — got: {out}");

        // Proves the interruption didn't kill the session (§3: "not output streaming
        // alone" — a real interactive parity, the process survives and keeps listening).
        seat.write_input(CENTER_SEAT_SESSION_ID, b"still alive\n").expect("write after SIGINT should still succeed");
        let out2 = read_until(&rx, "HEARD:still alive", 4096);
        assert!(out2.contains("HEARD:still alive"), "got: {out2}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn input_aimed_at_an_observed_corner_session_id_is_rejected_in_the_rust_core() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        // A real registered corner session_id shape (item 3's own convention), not the
        // center seat's — this is exactly HANDOFF.md item 4's literal acceptance wording.
        let result = seat.write_input("d55b834d-d581-4891-9429-5afbe96e9f96", b"should never arrive\n");
        assert!(result.is_err(), "expected the ownership check to reject a non-center session_id");

        // Prove nothing was actually written: no HEARD line ever shows up. This is
        // exactly the case that hangs a plain blocking read forever (see
        // spawn_reader_channel's own comment) — a real timeout here is the whole point.
        let out = read_until(&rx, "HEARD:", 1500);
        assert!(!out.contains("HEARD:"), "rejected input reached the child anyway — got: {out}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn stop_aimed_at_a_non_center_session_id_is_rejected_and_leaves_the_seat_running() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        let result = seat.stop("some-other-session-id");
        assert!(result.is_err());

        // The seat is still alive: input still reaches it.
        seat.write_input(CENTER_SEAT_SESSION_ID, b"proof\n").expect("write should still succeed");
        let out = read_until(&rx, "HEARD:proof", 4096);
        assert!(out.contains("HEARD:proof"), "got: {out}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn resize_is_center_only_and_reaches_the_child() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        assert!(seat.resize("d55b834d-d581-4891-9429-5afbe96e9f96", 40, 120).is_err());
        seat.resize(CENTER_SEAT_SESSION_ID, 40, 120).expect("resize of the owned seat");
        // The mock echoes `stty size` on the line "SIZE".
        seat.write_input(CENTER_SEAT_SESSION_ID, b"SIZE\n").unwrap();
        let out = read_until(&rx, "HEARD:SIZE", 4096);
        assert!(out.contains("40 120"), "child didn't see the new size — got: {out}");

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn stop_kills_the_owned_child_and_a_real_stop_actually_terminates_it() {
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        let pid = seat.pid().expect("mock claude should report a pid");

        seat.stop(CENTER_SEAT_SESSION_ID).expect("stop should succeed for the owned seat");

        let alive = Path::new(&format!("/proc/{pid}")).exists();
        assert!(!alive, "process {pid} should not still be running after stop()");
    }

    #[test]
    fn stop_escalates_when_the_child_ignores_the_polite_signal() {
        let (seat, reader) =
            spawn("bash", &[&mock_claude_path(), "--ignore-hup"], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        let pid = seat.pid().expect("mock claude should report a pid");

        seat.stop(CENTER_SEAT_SESSION_ID).expect("stop must end a child that ignores SIGHUP");
        assert!(!Path::new(&format!("/proc/{pid}")).exists(), "process {pid} survived stop()");
    }

    #[test]
    fn stop_also_ends_the_seats_own_child_processes() {
        let (seat, reader) =
            spawn("bash", &[&mock_claude_path(), "--with-grandchild"], Path::new("/tmp")).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        let out = read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        let gc: u32 = out
            .lines()
            .find_map(|l| l.trim().strip_prefix("GRANDCHILD:"))
            .and_then(|p| p.trim().parse().ok())
            .unwrap_or_else(|| panic!("mock didn't report its grandchild — got: {out}"));
        assert!(Path::new(&format!("/proc/{gc}")).exists());

        seat.stop(CENTER_SEAT_SESSION_ID).expect("stop");
        // The grandchild is reparented to init, which reaps it; give that a moment.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while Path::new(&format!("/proc/{gc}")).exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!Path::new(&format!("/proc/{gc}")).exists(), "grandchild {gc} outlived stop()");
    }

    #[test]
    fn stop_also_ends_a_descendant_that_left_the_group_with_setsid() {
        let (seat, reader) =
            spawn("bash", &[&mock_claude_path(), "--with-setsid-grandchild"], Path::new("/tmp")).expect("spawn mock");
        let rx = spawn_reader_channel(reader);
        let out = read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        let sub: u32 = out
            .lines()
            .find_map(|l| l.trim().strip_prefix("GRANDCHILD:"))
            .and_then(|p| p.trim().parse().ok())
            .unwrap_or_else(|| panic!("no grandchild pid — got: {out}"));
        // Give setsid a moment to move it into its own session.
        std::thread::sleep(Duration::from_millis(200));
        seat.stop(CENTER_SEAT_SESSION_ID).expect("stop");
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let gone = |p: u32| {
            std::fs::read_to_string(format!("/proc/{p}/stat")).map_or(true, |s| s.contains(") Z "))
        };
        while !gone(sub) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(gone(sub), "setsid descendant {sub} outlived stop()");
    }

    #[test]
    fn a_child_that_never_reads_input_cannot_block_the_writer() {
        let (seat, _reader) = spawn("sleep", &["30"], Path::new("/tmp")).expect("spawn");
        let chunk = vec![b'x'; 64 * 1024];
        let started = std::time::Instant::now();
        let mut refused = 0;
        for _ in 0..(INPUT_QUEUE + 64) {
            if seat.write_input(CENTER_SEAT_SESSION_ID, &chunk).is_err() {
                refused += 1;
            }
        }
        assert!(started.elapsed() < Duration::from_millis(500), "writes blocked for {:?}", started.elapsed());
        assert!(refused > 0, "a full queue must refuse, not grow without bound");
        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn the_baseline_is_taken_before_the_child_can_write() {
        let dir = std::env::temp_dir().join(format!("zofia-pty-seat-early-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (seat, reader) =
            spawn("bash", &[&mock_claude_path(), "--write-claude-md"], &dir).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);
        assert_eq!(seat.resweep(), vec!["CLAUDE.md"], "a write at startup was folded into the baseline");
        seat.stop(CENTER_SEAT_SESSION_ID).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hash_sweep_baseline_catches_a_change_made_after_spawn() {
        let dir = std::env::temp_dir().join(format!("zofia-pty-seat-sweep-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (seat, reader) = spawn("bash", &[&mock_claude_path()], &dir).expect("spawn mock claude");
        let rx = spawn_reader_channel(reader);
        read_until(&rx, "MOCK-CLAUDE-READY", 4096);

        assert!(seat.resweep().is_empty(), "nothing should have changed yet");

        std::fs::write(dir.join("CLAUDE.md"), "an instruction that wasn't there at spawn time").unwrap();
        let changed = seat.resweep();
        assert_eq!(changed, vec!["CLAUDE.md"]);

        seat.stop(CENTER_SEAT_SESSION_ID).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_child_always_gets_xterm_256color_whatever_launched_the_gui() {
        // Whatever this test process's own TERM is (unset under a desktop launcher, the
        // outer terminal's otherwise), the seat's child sees the fixed pair.
        let (seat, reader) =
            spawn("sh", &["-c", "echo TERM=$TERM COLORTERM=$COLORTERM; sleep 5"], Path::new("/tmp")).expect("spawn");
        let rx = spawn_reader_channel(reader);
        let out = read_until(&rx, "COLORTERM=", 4096);
        assert!(out.contains("TERM=xterm-256color COLORTERM=truecolor"), "got: {out}");
        seat.stop(CENTER_SEAT_SESSION_ID).ok();
    }

    #[test]
    fn settings_local_json_and_an_invalid_utf8_settings_file_both_need_confirmation() {
        let dir = std::env::temp_dir().join(format!("zofia-foreign-local-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude/settings.local.json"), r#"{"permissions":{"allow":["Bash(*)"]}}"#).unwrap();
        let info = detect_foreign_settings(&dir).expect("settings.local.json alone must count");
        assert!(info.settings_local_json.unwrap().contains("Bash(*)"));

        std::fs::remove_file(dir.join(".claude/settings.local.json")).unwrap();
        std::fs::write(dir.join(".claude/settings.json"), b"{\"permissions\":{\"allow\":[\"Bash(*)\"]},\"x\":\"\xff\"}").unwrap();
        let info = detect_foreign_settings(&dir).expect("an invalid-UTF-8 file is still present");
        assert!(info.settings_json.unwrap().contains("Bash(*)"), "shown lossily, not dropped");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detect_foreign_settings_finds_nothing_in_a_clean_dir() {
        let dir = std::env::temp_dir().join(format!("zofia-foreign-clean-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(detect_foreign_settings(&dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detect_foreign_settings_finds_a_permissive_project_settings_file() {
        let dir = std::env::temp_dir().join(format!("zofia-foreign-permissive-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude").join("settings.json"), r#"{"permissions":{"allow":["Bash(*)"]}}"#).unwrap();
        let info = detect_foreign_settings(&dir).expect("should detect the foreign settings file");
        assert!(info.settings_json.unwrap().contains("Bash(*)"));
        assert!(info.mcp_json.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
