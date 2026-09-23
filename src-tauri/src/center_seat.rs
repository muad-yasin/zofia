// HANDOFF.md item 4, PLAN.md §3: the Tauri control surface for the owned center seat.
// Every command that can reach the PTY (input, resize, stop) passes the frontend's
// session_id straight into pty_seat's ownership check; nothing here short-circuits it.
//
// Transport: Tauri's own IPC (commands in, events out), the same authenticated channel
// item 3 already uses for snapshots. No WebSocket listener is opened, so Sophi-A's WS
// token + allowed-origins gate has nothing to guard here (see DECISIONS.md, 2026-09-23).
//
// Item 8 gate: the real `claude` CLI on the owner's subscription is refused until the
// owner has read Anthropic's terms himself (PLAN.md §10 decision 1). Until then the seat
// only launches the committed mock, identified by its content (see resolve_command).
//
// Scrollback is memory-only: PTY output goes to the webview as events and is never
// logged or written anywhere by this module.

use crate::pty_seat::{self, ForeignSettingsInfo, PtySeat, CENTER_SEAT_SESSION_ID};
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Flip only after HANDOFF item 8 (owner's own ToS read) closes.
const REAL_CLI_ALLOWED: bool = false;
pub const CENTER_COMMAND_ENV: &str = "ZOFIA_CENTER_COMMAND";

/// The committed mock, compiled in. Until item 8 the seat launches a file only if its
/// bytes are exactly these (audit 2026-09-23 #2: a file-name check let
/// `~/.local/share/claude/versions/<ver>`, the real CLI, straight through). Content, not a
/// path, so it works from any checkout or mount (the podman smoke image mounts the repo
/// at /zofia) and a symlink counts only if it resolves to the real mock.
const MOCK_CLAUDE: &[u8] = include_bytes!("../../test/fixtures/mock-claude.sh");

/// PLAN.md §3's tool policy, as flags on the installed CLI (verified against `claude
/// --help`, Claude Code 2.1.280, 2026-09-23; the week-1 probe still has to show each
/// denied tool is actually refused, docs/cnc-tool-policy.md, item 8):
/// - `--restricted`: drops the code-running tools and WebFetch, ignores user/project/local
///   settings files (so a project's own permissions can't widen the policy), confines file
///   tools to the workdir, and refuses bypassPermissions;
/// - `--tools`: the allow-list itself, Read/Grep/Glob, plus WebSearch/WebFetch only if the
///   owner opts in;
/// - `--strict-mcp-config` with no `--mcp-config`: no MCP servers at all.
pub fn policy_args(web_opt_in: bool) -> Vec<String> {
    let tools = if web_opt_in { "Read,Grep,Glob,WebSearch,WebFetch" } else { "Read,Grep,Glob" };
    vec!["--restricted".into(), "--tools".into(), tools.into(), "--strict-mcp-config".into()]
}

/// The exact argv the center seat launches with: the policy first, then the model.
pub fn seat_argv(model: Option<&str>, web_opt_in: bool) -> Result<Vec<String>, String> {
    let mut argv = policy_args(web_opt_in);
    argv.extend(model_args(model)?);
    Ok(argv)
}

#[derive(Default)]
pub struct CenterSeat(Mutex<Option<PtySeat>>);

/// Which program the center seat may launch. Pure over its input so the gate is testable.
pub fn resolve_command(configured: Option<String>) -> Result<String, String> {
    let Some(cmd) = configured.filter(|c| !c.trim().is_empty()) else {
        return Err(format!(
            "no center-seat command: the real claude CLI is gated on HANDOFF item 8; set {CENTER_COMMAND_ENV} to a mock"
        ));
    };
    if REAL_CLI_ALLOWED {
        return Ok(cmd);
    }
    let refuse = |why: String| {
        Err(format!(
            "{why}. Until HANDOFF item 8 (the owner's ToS read) closes, {CENTER_COMMAND_ENV} may only name the committed mock, test/fixtures/mock-claude.sh"
        ))
    };
    if !Path::new(&cmd).is_absolute() {
        return refuse(format!("{cmd:?} is not an absolute path"));
    }
    let real = match std::fs::canonicalize(&cmd) {
        Ok(p) => p,
        Err(e) => return refuse(format!("{cmd:?} can't be resolved ({e})")),
    };
    match std::fs::read(&real) {
        Ok(bytes) if real.is_file() && bytes == MOCK_CLAUDE => Ok(real.to_string_lossy().into_owned()),
        Ok(_) => refuse(format!("{} is not the committed mock", real.display())),
        Err(e) => refuse(format!("{} can't be read ({e})", real.display())),
    }
}

/// PLAN.md §3: a workdir carrying its own `.claude/settings.json` or `.mcp.json` doesn't
/// launch until the owner has seen those entries and confirmed. Enforced here in Rust, so a
/// frontend that skips the dialog still can't launch.
/// The confirmation is the digest the dialog showed; it must still match the files right
/// now, so an edit after the owner looked (or a confirmation replayed for other contents)
/// doesn't launch.
pub fn launch_gate(workdir: &Path, confirmed_digest: Option<&str>) -> Result<(), String> {
    match pty_seat::detect_foreign_settings(workdir) {
        None => Ok(()),
        Some(info) if confirmed_digest == Some(info.digest.as_str()) => Ok(()),
        Some(_) if confirmed_digest.is_some() => Err(
            "this directory's Claude Code settings changed after you confirmed them; review them again".to_string(),
        ),
        Some(_) => Err("this directory has its own Claude Code settings; confirm them before launch".to_string()),
    }
}

/// What actually gets exec'd. Until item 8 that's never the file on disk: an absolute
/// /bin/bash runs the compiled-in mock bytes, so neither a PATH-planted `bash` (the mock's
/// `#!/usr/bin/env bash`) nor a swap of the file between the gate and the spawn can
/// change what runs (roll-up 2026-09-23, Items7-9 #3). argv[0] of the script is the
/// verified path, so `pgrep -f <mock path>` still finds it.
pub fn launch_plan(resolved: &str, seat_args: &[String]) -> (String, Vec<String>) {
    if REAL_CLI_ALLOWED {
        return (resolved.to_string(), seat_args.to_vec());
    }
    let script = String::from_utf8_lossy(MOCK_CLAUDE).into_owned();
    let mut argv = vec!["-c".to_string(), script, resolved.to_string()];
    argv.extend_from_slice(seat_args);
    ("/bin/bash".to_string(), argv)
}

#[tauri::command]
pub fn center_preflight(workdir: String) -> Option<ForeignSettingsInfo> {
    pty_seat::detect_foreign_settings(Path::new(&workdir))
}

#[tauri::command]
pub fn center_spawn(
    app: AppHandle,
    seat: State<'_, CenterSeat>,
    workdir: String,
    confirmed_digest: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let dir = Path::new(&workdir);
    if !dir.is_dir() {
        return Err(format!("not a directory: {workdir}"));
    }
    launch_gate(dir, confirmed_digest.as_deref())?;
    let command = resolve_command(std::env::var(CENTER_COMMAND_ENV).ok())?;
    // PLAN.md §5: an xAI/Grok id is refused here at runtime, whatever the config said.
    // The web opt-in has no UI yet, so it's off (PLAN.md §3's default).
    let args = seat_argv(model.as_deref(), false)?;
    let shown_model = model_args(model.as_deref())?[1].clone();
    let (program, argv) = launch_plan(&command, &args);

    let mut slot = seat.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("the center seat is already running".to_string());
    }
    let arg_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    let (pty, reader) = pty_seat::spawn(&program, &arg_refs, dir)?;
    let pid = pty.pid();
    *slot = Some(pty);
    forward_output(app.clone(), reader, pid);
    watch_leader(app, pid);
    // Returned so the pane shows the model the seat was actually launched with.
    Ok(shown_model)
}

/// `--model <resolved id>`, always. No selection means config/providers.json's default
/// (owner decision 4: `sonnet`), never the CLI's own default, which is whatever the
/// owner's settings.json says (`opus[1m]` on his machine; roll-up 2026-09-23). Either way
/// the id goes through the xAI/Grok guard.
fn model_args(model: Option<&str>) -> Result<Vec<String>, String> {
    let chosen = model.map(str::trim).filter(|m| !m.is_empty()).unwrap_or(crate::provider_guard::default_model());
    let id = crate::provider_guard::check_model(chosen).map_err(|e| e.to_string())?;
    Ok(vec!["--model".to_string(), id])
}

/// The reader's EOF only comes once *every* holder of the pty is gone; a child that keeps
/// it open would leave an exited seat as a zombie with its slot taken (roll-up LOW). This
/// watches the leader itself.
fn watch_leader(app: AppHandle, pid: Option<u32>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let seat = app.state::<CenterSeat>();
        let exited = match seat.0.lock() {
            Ok(slot) => match slot.as_ref() {
                Some(p) if p.pid() == pid => p.leader_exited(),
                _ => return, // stopped, reaped, or replaced: nothing left to watch
            },
            Err(_) => return,
        };
        if exited {
            if reap_if_current(&seat, pid) {
                let _ = app.emit("zofia://center-exit", ());
            }
            return;
        }
    });
}

/// When the seat ends on its own (/exit, a crash), reaps it and frees the slot so it can
/// be launched again (audit 2026-09-23 #2: the slot stayed set, the process a zombie).
/// Only if the slot still holds *this* seat: the zombie keeps its pid until reaped, so a
/// pid match can't be a newer seat. Returns whether it cleared the slot.
pub fn reap_if_current(seat: &CenterSeat, pid: Option<u32>) -> bool {
    let taken = {
        let Ok(mut slot) = seat.0.lock() else { return false };
        if pid.is_none() || slot.as_ref().map(|p| p.pid()) != Some(pid) {
            return false;
        }
        slot.take()
    };
    if let Some(pty) = taken {
        // Outside the lock: kills any leftover children, then reaps the leader.
        let _ = pty.stop(CENTER_SEAT_SESSION_ID);
    }
    true
}

fn forward_output(app: AppHandle, mut reader: Box<dyn Read + Send>, pid: Option<u32>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if app.emit("zofia://center-output", buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
        if reap_if_current(&app.state::<CenterSeat>(), pid) {
            let _ = app.emit("zofia://center-exit", ());
        }
    });
}

#[tauri::command]
pub fn center_write(seat: State<'_, CenterSeat>, session_id: String, data: Vec<u8>) -> Result<(), String> {
    let slot = seat.0.lock().map_err(|e| e.to_string())?;
    slot.as_ref().ok_or("the center seat isn't running")?.write_input(&session_id, &data)
}

#[tauri::command]
pub fn center_resize(seat: State<'_, CenterSeat>, session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let slot = seat.0.lock().map_err(|e| e.to_string())?;
    slot.as_ref().ok_or("the center seat isn't running")?.resize(&session_id, rows, cols)
}

/// Async, and the escalation (up to ~6s against a child that ignores SIGHUP) runs with
/// the seat taken out of the slot, so neither the GUI thread nor the lock waits on it
/// (item 4 audit backlog). If the child somehow survives, it goes back in the slot.
#[tauri::command]
pub async fn center_stop(seat: State<'_, CenterSeat>, session_id: String) -> Result<(), String> {
    if session_id != CENTER_SEAT_SESSION_ID {
        return Err(format!("ownership check failed: \"{session_id}\" is not the owned center seat"));
    }
    let Some(pty) = seat.0.lock().map_err(|e| e.to_string())?.take() else { return Ok(()) };
    let (pty, result) = tauri::async_runtime::spawn_blocking(move || {
        let r = pty.stop(CENTER_SEAT_SESSION_ID);
        (pty, r)
    })
    .await
    .map_err(|e| e.to_string())?;
    if result.is_err() {
        let mut slot = seat.0.lock().map_err(|e| e.to_string())?;
        if slot.is_none() {
            *slot = Some(pty);
        }
    }
    result
}

/// Sensitive paths (CLAUDE.md, .claude, .mcp.json) that changed in the seat's workdir since
/// launch. The frontend polls this and warns the owner; empty when nothing changed or no seat.
///
/// Async and off the lock (audit 2026-09-23 #6): a workdir like $HOME means hashing
/// thousands of files, which used to run on the GUI main thread every 5s while holding
/// the lock that keystrokes need.
#[tauri::command]
pub async fn center_resweep(seat: State<'_, CenterSeat>) -> Result<Vec<&'static str>, String> {
    let inputs = seat.0.lock().map_err(|e| e.to_string())?.as_ref().map(|pty| pty.sweep_inputs());
    let Some((workdir, baseline, cache)) = inputs else { return Ok(Vec::new()) };
    tauri::async_runtime::spawn_blocking(move || pty_seat::resweep_with(&workdir, &baseline, &cache))
    .await
    .map_err(|e| e.to_string())
}

/// App exit: stop the owned seat only. Observed corner sessions are never signalled; this
/// module holds no handle to them at all.
pub fn shutdown(seat: &CenterSeat) {
    if let Ok(mut slot) = seat.0.lock() {
        if let Some(pty) = slot.take() {
            let _ = pty.stop(CENTER_SEAT_SESSION_ID);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_path() -> String {
        format!("{}/../test/fixtures/mock-claude.sh", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn no_configured_command_refuses_to_launch() {
        assert!(resolve_command(None).is_err());
        assert!(resolve_command(Some("  ".into())).is_err());
    }

    fn canonical_mock() -> String {
        std::fs::canonicalize(mock_path()).unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn the_real_claude_cli_is_refused_until_item_8() {
        assert!(resolve_command(Some("claude".into())).is_err());
        assert!(resolve_command(Some("/usr/local/bin/claude".into())).is_err());
        assert_eq!(resolve_command(Some(mock_path())).unwrap(), canonical_mock());
    }

    /// Audit 2026-09-23 #2: the file-name check passed a versioned real CLI, a wrapper and
    /// `claude.exe`. Only the committed mock's exact bytes pass now, however it's reached.
    #[test]
    fn only_the_committed_mock_passes_the_item_8_gate() {
        let dir = std::env::temp_dir().join(format!("zofia-gate-cmd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("versions")).unwrap();
        let versioned = dir.join("versions/2.1.280");
        std::fs::write(&versioned, "#!/bin/sh\necho real cli\n").unwrap();
        for name in ["claude-wrapper", "claude.exe"] {
            std::fs::write(dir.join(name), "#!/bin/sh\n").unwrap();
            assert!(resolve_command(Some(dir.join(name).to_string_lossy().into())).is_err(), "{name}");
        }
        assert!(resolve_command(Some(versioned.to_string_lossy().into())).is_err());

        // A symlink counts only by what it resolves to.
        let to_mock = dir.join("mock-link");
        std::os::unix::fs::symlink(mock_path(), &to_mock).unwrap();
        assert_eq!(resolve_command(Some(to_mock.to_string_lossy().into())).unwrap(), canonical_mock());
        let named_like_mock = dir.join("mock-claude.sh");
        std::os::unix::fs::symlink(&versioned, &named_like_mock).unwrap();
        assert!(resolve_command(Some(named_like_mock.to_string_lossy().into())).is_err());

        // A copy of the mock elsewhere (the smoke image's /zofia mount) passes; a relative
        // path or an edited copy doesn't.
        let copy = dir.join("copy.sh");
        std::fs::copy(mock_path(), &copy).unwrap();
        assert!(resolve_command(Some(copy.to_string_lossy().into())).is_ok());
        assert!(resolve_command(Some("test/fixtures/mock-claude.sh".into())).is_err());
        std::fs::write(&copy, [MOCK_CLAUDE, b"\nexec claude\n"].concat()).unwrap();
        assert!(resolve_command(Some(copy.to_string_lossy().into())).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Audit 2026-09-23 #1: the seat must launch with PLAN.md §3's allow-list. Asserted on
    /// the argv the mock actually receives, not only on the Vec we build.
    #[test]
    fn the_seat_launches_with_the_tool_policy_and_the_mock_sees_it() {
        let argv = seat_argv(Some("sonnet"), false).unwrap();
        assert_eq!(argv, ["--restricted", "--tools", "Read,Grep,Glob", "--strict-mcp-config", "--model", "sonnet"]);
        assert!(seat_argv(None, true).unwrap().contains(&"Read,Grep,Glob,WebSearch,WebFetch".to_string()));
        assert!(seat_argv(None, false).unwrap().ends_with(&["--model".to_string(), "sonnet".to_string()]));
        assert!(seat_argv(Some("grok-4"), false).is_err());

        let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        let (pty, mut reader) = pty_seat::spawn(&resolve_command(Some(mock_path())).unwrap(), &refs, Path::new("/tmp")).unwrap();
        let mut seen = String::new();
        let mut buf = [0u8; 4096];
        while !seen.contains("MOCK-CLAUDE-READY") {
            let n = reader.read(&mut buf).unwrap();
            assert!(n > 0, "mock closed early: {seen}");
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        let got: Vec<&str> = seen.lines().filter_map(|l| l.trim_end().strip_prefix("ARG:")).collect();
        assert_eq!(got, refs);
        pty.stop(CENTER_SEAT_SESSION_ID).unwrap();
    }

    /// Roll-up 2026-09-23 (Items7-9 #3): what runs is an absolute /bin/bash with the
    /// compiled-in mock bytes, never a PATH lookup and never the file on disk, and it
    /// still behaves as the mock, with the seat's argv intact.
    #[test]
    fn the_launch_plan_runs_the_embedded_mock_under_an_absolute_bash() {
        let resolved = resolve_command(Some(mock_path())).unwrap();
        let args = seat_argv(None, false).unwrap();
        let (program, argv) = launch_plan(&resolved, &args);
        assert_eq!(program, "/bin/bash");
        assert_eq!(argv[0], "-c");
        assert_eq!(argv[1].as_bytes(), MOCK_CLAUDE);
        assert_eq!(argv[2], resolved, "argv[0] of the script is the verified path, for pgrep");

        let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        let (pty, mut reader) = pty_seat::spawn(&program, &refs, Path::new("/tmp")).unwrap();
        let mut seen = String::new();
        let mut buf = [0u8; 4096];
        while !seen.contains("MOCK-CLAUDE-READY") {
            let n = reader.read(&mut buf).unwrap();
            assert!(n > 0, "mock closed early: {seen}");
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        let got: Vec<&str> = seen.lines().filter_map(|l| l.trim_end().strip_prefix("ARG:")).collect();
        assert_eq!(got, args.iter().map(String::as_str).collect::<Vec<_>>());
        pty.stop(CENTER_SEAT_SESSION_ID).unwrap();
    }

    /// Roll-up LOW: the leader exits while a child still holds the pty, so no EOF comes.
    /// leader_exited() must still see it, which is what watch_leader polls.
    #[test]
    fn an_exited_leader_is_seen_even_while_a_child_holds_the_pty() {
        let (pty, _reader) = pty_seat::spawn(
            "/bin/bash",
            &["-c", "( trap '' HUP; exec sleep 300 ) & echo started; exit 0"],
            Path::new("/tmp"),
        )
        .unwrap();
        let pid = pty.pid();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while !pty.leader_exited() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(pty.leader_exited(), "leader exit not seen");
        let seat = CenterSeat(Mutex::new(Some(pty)));
        assert!(reap_if_current(&seat, pid));
        assert!(seat.0.lock().unwrap().is_none());
    }

    /// Audit 2026-09-23 #2 (the zombie): a seat that exits by itself is reaped and its slot
    /// freed, so a relaunch isn't refused as "already running".
    #[test]
    fn a_self_exited_seat_is_reaped_and_its_slot_freed() {
        let (pty, mut reader) = pty_seat::spawn(&mock_path(), &[], Path::new("/tmp")).unwrap();
        let pid = pty.pid();
        let seat = CenterSeat(Mutex::new(Some(pty)));
        seat.0.lock().unwrap().as_ref().unwrap().write_input(CENTER_SEAT_SESSION_ID, b"EXIT\n").unwrap();
        let mut buf = [0u8; 4096];
        while reader.read(&mut buf).map(|n| n > 0).unwrap_or(false) {} // EOF: what forward_output sees

        assert!(!reap_if_current(&seat, Some(u32::MAX)), "a different pid must not clear the slot");
        assert!(reap_if_current(&seat, pid));
        assert!(seat.0.lock().unwrap().is_none(), "slot still set");
        let status = std::fs::read_to_string(format!("/proc/{}/stat", pid.unwrap())).unwrap_or_default();
        assert!(!status.contains(") Z "), "seat left as a zombie: {status}");
    }

    #[test]
    fn a_permissive_project_settings_file_blocks_launch_until_confirmed() {
        let dir = std::env::temp_dir().join(format!("zofia-gate-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude/settings.json"), r#"{"permissions":{"allow":["Bash(*)"]}}"#).unwrap();
        assert!(launch_gate(&dir, None).is_err());
        let digest = pty_seat::detect_foreign_settings(&dir).unwrap().digest;
        assert!(launch_gate(&dir, Some(&digest)).is_ok());
        // Confirmed, then edited before the spawn: the old confirmation no longer counts.
        std::fs::write(dir.join(".claude/settings.json"), r#"{"permissions":{"allow":["Bash(*)","Write"]}}"#).unwrap();
        assert!(launch_gate(&dir, Some(&digest)).unwrap_err().contains("changed after you confirmed"));
        assert!(launch_gate(&dir, Some("not-a-digest")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn model_args_resolve_through_the_guard_and_refuse_grok() {
        // Owner decision 4: no selection launches config's default, never the CLI's own.
        assert_eq!(model_args(None).unwrap(), ["--model", "sonnet"]);
        assert_eq!(model_args(Some("  ")).unwrap(), ["--model", "sonnet"]);
        let args = model_args(Some("sonnet")).unwrap();
        assert_eq!(args[0], "--model");
        assert!(model_args(Some("grok-4")).is_err());
        assert!(model_args(Some("x-ai/grok-4")).is_err());
    }

    #[test]
    fn a_clean_dir_launches_without_a_confirmation() {
        let dir = std::env::temp_dir().join(format!("zofia-gate-clean-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(launch_gate(&dir, None).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// PLAN.md §3: "Closing the GUI leaves the observed corner process alive." The observed
    /// process here is independent (plain std::process, not ours); shutdown() must end the
    /// owned seat and leave it untouched.
    #[test]
    fn shutdown_stops_the_seat_and_leaves_an_observed_process_alive() {
        let mut observed = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let (pty, _reader) = pty_seat::spawn(&mock_path(), &[], Path::new("/tmp")).unwrap();
        let seat_pid = pty.pid().unwrap();
        let seat = CenterSeat(Mutex::new(Some(pty)));

        shutdown(&seat);

        assert!(!Path::new(&format!("/proc/{seat_pid}")).exists(), "owned seat survived shutdown");
        assert!(observed.try_wait().unwrap().is_none(), "observed process was killed by shutdown");
        observed.kill().ok();
        observed.wait().ok();
    }

    /// PLAN.md §3: "`grep -r` across Zofia's config/cache/log directories finds no scrollback
    /// text." Module level: runs a seat that prints a unique marker, then searches the app's
    /// own dirs (identifier de.sower.zofia). The whole-app run of this check is item 5's.
    #[test]
    fn seat_output_never_reaches_zofias_own_dirs() {
        let marker = format!("ZOFIA-SCROLLBACK-MARKER-{}", std::process::id());
        let (pty, mut reader) = pty_seat::spawn(&mock_path(), &[], Path::new("/tmp")).unwrap();
        pty.write_input(CENTER_SEAT_SESSION_ID, format!("{marker}\n").as_bytes()).unwrap();
        let mut seen = String::new();
        let mut buf = [0u8; 4096];
        while !seen.contains(&format!("HEARD:{marker}")) {
            let n = reader.read(&mut buf).unwrap();
            assert!(n > 0, "seat closed before echoing");
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        pty.stop(CENTER_SEAT_SESSION_ID).unwrap();

        let home = std::env::var("HOME").unwrap();
        for dir in [".config/de.sower.zofia", ".cache/de.sower.zofia", ".local/share/de.sower.zofia"] {
            let path = Path::new(&home).join(dir);
            if !path.exists() {
                continue;
            }
            let out = std::process::Command::new("grep").args(["-r", "-l", &marker]).arg(&path).output().unwrap();
            assert!(out.stdout.is_empty(), "scrollback marker found on disk: {}", String::from_utf8_lossy(&out.stdout));
        }
    }
}
