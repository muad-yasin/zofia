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
// only launches the command named in ZOFIA_CENTER_COMMAND (the mock, for item 4).
//
// Scrollback is memory-only: PTY output goes to the webview as events and is never
// logged or written anywhere by this module.

use crate::pty_seat::{self, ForeignSettingsInfo, PtySeat, CENTER_SEAT_SESSION_ID};
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Flip only after HANDOFF item 8 (owner's own ToS read) closes.
const REAL_CLI_ALLOWED: bool = false;
pub const CENTER_COMMAND_ENV: &str = "ZOFIA_CENTER_COMMAND";

#[derive(Default)]
pub struct CenterSeat(Mutex<Option<PtySeat>>);

/// Which program the center seat may launch. Pure over its input so the gate is testable.
pub fn resolve_command(configured: Option<String>) -> Result<String, String> {
    let Some(cmd) = configured.filter(|c| !c.trim().is_empty()) else {
        return Err(format!(
            "no center-seat command: the real claude CLI is gated on HANDOFF item 8; set {CENTER_COMMAND_ENV} to a mock"
        ));
    };
    let base = Path::new(&cmd).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
    if base == "claude" && !REAL_CLI_ALLOWED {
        return Err("the real claude CLI is gated on HANDOFF item 8 (owner's ToS read); not launching it".to_string());
    }
    Ok(cmd)
}

/// PLAN.md §3: a workdir carrying its own `.claude/settings.json` or `.mcp.json` doesn't
/// launch until the owner has seen those entries and confirmed. Enforced here in Rust, so a
/// frontend that skips the dialog still can't launch.
pub fn launch_gate(workdir: &Path, confirmed_foreign: bool) -> Result<(), String> {
    match pty_seat::detect_foreign_settings(workdir) {
        Some(_) if !confirmed_foreign => {
            Err("this directory has its own Claude Code settings; confirm them before launch".to_string())
        }
        _ => Ok(()),
    }
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
    confirmed_foreign: bool,
    model: Option<String>,
) -> Result<String, String> {
    let dir = Path::new(&workdir);
    if !dir.is_dir() {
        return Err(format!("not a directory: {workdir}"));
    }
    launch_gate(dir, confirmed_foreign)?;
    let command = resolve_command(std::env::var(CENTER_COMMAND_ENV).ok())?;
    // PLAN.md §5: an xAI/Grok id is refused here at runtime, whatever the config said.
    let args = model_args(model.as_deref())?;

    let mut slot = seat.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("the center seat is already running".to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (pty, reader) = pty_seat::spawn(&command, &arg_refs, dir)?;
    *slot = Some(pty);
    forward_output(app, reader);
    // Returned so the pane shows the model the seat was actually launched with.
    Ok(args.get(1).cloned().unwrap_or_else(|| "CLI default".to_string()))
}

/// `--model <resolved id>` for a selected model, nothing for none (the CLI's own default).
fn model_args(model: Option<&str>) -> Result<Vec<String>, String> {
    match model.map(str::trim).filter(|m| !m.is_empty()) {
        None => Ok(Vec::new()),
        Some(m) => {
            let id = crate::provider_guard::check_model(m).map_err(|e| e.to_string())?;
            Ok(vec!["--model".to_string(), id])
        }
    }
}

fn forward_output(app: AppHandle, mut reader: Box<dyn Read + Send>) {
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
        let _ = app.emit("zofia://center-exit", ());
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

#[tauri::command]
pub fn center_stop(seat: State<'_, CenterSeat>, session_id: String) -> Result<(), String> {
    let mut slot = seat.0.lock().map_err(|e| e.to_string())?;
    match slot.as_ref() {
        None => Ok(()),
        Some(pty) => {
            pty.stop(&session_id)?;
            *slot = None;
            Ok(())
        }
    }
}

/// Sensitive paths (CLAUDE.md, .claude, .mcp.json) that changed in the seat's workdir since
/// launch. The frontend polls this and warns the owner; empty when nothing changed or no seat.
#[tauri::command]
pub fn center_resweep(seat: State<'_, CenterSeat>) -> Vec<&'static str> {
    seat.0.lock().ok().and_then(|slot| slot.as_ref().map(|pty| pty.resweep())).unwrap_or_default()
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

    #[test]
    fn the_real_claude_cli_is_refused_until_item_8() {
        assert!(resolve_command(Some("claude".into())).is_err());
        assert!(resolve_command(Some("/usr/local/bin/claude".into())).is_err());
        assert_eq!(resolve_command(Some(mock_path())).unwrap(), mock_path());
    }

    #[test]
    fn a_permissive_project_settings_file_blocks_launch_until_confirmed() {
        let dir = std::env::temp_dir().join(format!("zofia-gate-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude/settings.json"), r#"{"permissions":{"allow":["Bash(*)"]}}"#).unwrap();
        assert!(launch_gate(&dir, false).is_err());
        assert!(launch_gate(&dir, true).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn model_args_resolve_through_the_guard_and_refuse_grok() {
        assert!(model_args(None).unwrap().is_empty());
        assert!(model_args(Some("  ")).unwrap().is_empty());
        let args = model_args(Some("sonnet")).unwrap();
        assert_eq!(args[0], "--model");
        assert!(model_args(Some("grok-4")).is_err());
        assert!(model_args(Some("x-ai/grok-4")).is_err());
    }

    #[test]
    fn a_clean_dir_launches_without_a_confirmation() {
        let dir = std::env::temp_dir().join(format!("zofia-gate-clean-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(launch_gate(&dir, false).is_ok());
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
