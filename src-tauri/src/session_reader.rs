// Rust port of reader/src/deriveSnapshot.mjs + reader/src/sessionState.mjs.
//
// PLAN.md §2.1 already expects the mechanism to move into a Rust `inotify` watcher once
// the GUI exists (see Zofia/DECISIONS.md, item 1 entry). The GUI shell is a packaged
// Tauri binary — it cannot shell out to the Node-based `reader/` CLI without bundling a
// Node runtime into the AppImage, an undocumented dependency §6 (Linux packaging) never
// accounted for — so the field-deriving rules live here too, ported field-by-field from
// `reader/src/deriveSnapshot.mjs` (tested there independently, `reader/test/deriveSnapshot.test.mjs`).
// This is a deliberate, documented duplication, not an oversight: `src/lib/layout/types.ts`
// already flagged the reader and the shell as "deliberately not the same build" during
// item 2. Keep the two in sync by hand; a divergence here is a real bug, the same
// discipline `docs/field-availability.md` already uses.
//
// `$XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json` is the transport (PLAN.md §2.1);
// `ZOFIA_SESSIONS_DIR` overrides it, matching `reader/src/sessionState.mjs` exactly so
// the same fixture directory works for both the CLI and this module in tests.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const STALE_AFTER_S: i64 = 120; // PLAN.md §2.1's own caught bug used this number to
// wrongly assert "idle" after a silence. Reused here only to label a *non-terminal*
// state "stale" when nothing newer has arrived AND no owning process is recorded to check —
// never to assert idle, and never on a process known to be alive (Q2).

// StopFailure ends a turn on an API error instead of Stop. Mirrors reader/src/deriveSnapshot.mjs.
const TERMINAL_HOOK_EVENTS: [&str; 3] = ["Stop", "StopFailure", "SessionEnd"];

/// States that wait on a person; they never age into "stale".
fn is_waiting_label(label: &str) -> bool {
    label == "ready" || label == "your turn" || label.starts_with("blocked:")
}

pub fn sessions_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ZOFIA_SESSIONS_DIR") {
        return PathBuf::from(dir);
    }
    // Per-user fallback, never a shared /tmp/zofia (audit F10, 2026-09-23). Must match
    // reader/shim/common.sh and reader/src/sessionState.mjs.
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("zofia").join("sessions"),
        _ => PathBuf::from(format!("/tmp/zofia-{}", current_uid())).join("sessions"),
    }
}

fn current_uid() -> u32 {
    // SAFETY: getuid(2) takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

/// A session_id becomes a file name: plain tokens only, so "../x" can't leave the
/// sessions dir (audit F10). Claude Code's ids are UUIDs.
pub fn is_valid_session_id(id: &str) -> bool {
    (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn session_state_path(session_id: &str) -> PathBuf {
    sessions_dir().join(format!("{session_id}.json"))
}

/// Reads and parses one session's raw state file. `Ok(None)` means never observed yet
/// (file absent) — not an error, mirroring `sessionState.mjs`'s own ENOENT handling.
/// `Err` only for a file that isn't a JSON object at all; a mistyped field is nulled
/// and recorded instead (see `type_check`), so it blanks that field alone.
pub fn read_session_state(session_id: &str) -> Result<Option<RawSessionState>, String> {
    if !is_valid_session_id(session_id) {
        return Err(format!("\"{session_id}\" is not a valid session_id (letters, digits, '-' and '_' only)"));
    }
    // A sessions dir someone else owns could hold planted state.
    let dir = sessions_dir();
    if let Ok(meta) = std::fs::metadata(&dir) {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != current_uid() {
            return Err(format!("sessions directory {} is owned by uid {}, not you; refusing to read it", dir.display(), meta.uid()));
        }
    }
    let path = session_state_path(session_id);
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_session_state(&text)
            .map(Some)
            .map_err(|e| format!("session state file for \"{session_id}\" is {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("session state file for \"{session_id}\" is unreadable: {e}")),
    }
}

/// Parses a state file's text. Per-field, like the Node reader (audit follow-up to F9,
/// 2026-09-23): strict serde used to reject the whole file over one mistyped value, e.g.
/// `resets_at` as a string, and every field went UNKNOWN.
pub fn parse_session_state(text: &str) -> Result<RawSessionState, String> {
    let mut v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("unreadable or not valid JSON: {e}"))?;
    if !v.is_object() {
        return Err("not a JSON object".to_string());
    }
    let mismatches = type_check(&mut v);
    let mut raw: RawSessionState =
        serde_json::from_value(v).map_err(|e| format!("in an unexpected shape after the type check: {e}"))?;
    raw.type_mismatches = mismatches;
    Ok(raw)
}

#[derive(Clone, Copy)]
enum Kind {
    Obj,
    Str,
    Num,
    Int,
    Pid,
}

/// Every leaf the derive functions read, parents before children, with the JSON type it
/// must have. Mirrors the `Raw*` structs below.
const SCHEMA: &[(&str, Kind)] = &[
    ("/pid", Kind::Pid),
    ("/cwd", Kind::Str),
    ("/turn_started_at", Kind::Int),
    ("/turn_ended_at", Kind::Int),
    ("/latest_statusline", Kind::Obj),
    ("/latest_statusline/observed_at", Kind::Int),
    ("/latest_statusline/model", Kind::Obj),
    ("/latest_statusline/model/id", Kind::Str),
    ("/latest_statusline/model/display_name", Kind::Str),
    ("/latest_statusline/effort", Kind::Obj),
    ("/latest_statusline/effort/level", Kind::Str),
    ("/latest_statusline/rate_limits", Kind::Obj),
    ("/latest_statusline/rate_limits/five_hour", Kind::Obj),
    ("/latest_statusline/rate_limits/five_hour/used_percentage", Kind::Num),
    ("/latest_statusline/rate_limits/five_hour/resets_at", Kind::Int),
    ("/latest_statusline/context_window", Kind::Obj),
    ("/latest_statusline/context_window/used_percentage", Kind::Num),
    ("/latest_statusline/context_window/total_input_tokens", Kind::Int),
    ("/latest_statusline/context_window/total_output_tokens", Kind::Int),
    ("/latest_statusline/cost", Kind::Obj),
    ("/latest_statusline/cost/total_cost_usd", Kind::Num),
    ("/latest_hook_event", Kind::Obj),
    ("/latest_hook_event/observed_at", Kind::Int),
    ("/latest_hook_event/hook_event_name", Kind::Str),
    ("/latest_hook_event/tool_name", Kind::Str),
    ("/latest_hook_event/notification_type", Kind::Str),
    ("/latest_hook_event/end_reason", Kind::Str),
    ("/latest_hook_event/error_type", Kind::Str),
];

/// Without these a whole sub-object is unusable: nothing in it can be timestamped, and a
/// hook event with no name says nothing. The sub-object is dropped, and recorded.
const REQUIRED: &[(&str, &[&str])] = &[
    ("/latest_statusline", &["observed_at"]),
    ("/latest_hook_event", &["observed_at", "hook_event_name"]),
];

/// Nulls every value whose JSON type doesn't match `SCHEMA` and returns one
/// "path: problem" line per null. A whole-number-valued float for an integer field is a
/// representation difference, not a wrong value, so it's accepted and normalized, as is
/// any finite number (floored) for an epoch/token count; everything else is refused.
fn type_check(v: &mut serde_json::Value) -> Vec<Mismatch> {
    use serde_json::Value;
    let mut out = Vec::new();
    for (path, kind) in SCHEMA {
        let Some(slot) = v.pointer_mut(path) else { continue };
        if slot.is_null() {
            continue;
        }
        let fixed: Option<Value> = match (kind, &*slot) {
            (Kind::Obj, Value::Object(_)) | (Kind::Str, Value::String(_)) | (Kind::Num, Value::Number(_)) => None,
            (Kind::Int, Value::Number(n)) if n.is_i64() => None,
            (Kind::Int, Value::Number(n)) => match n.as_f64() {
                Some(f) if f.is_finite() && f.abs() < 9.0e15 => Some(Value::from(f.floor() as i64)),
                _ => Some(Value::Null),
            },
            (Kind::Pid, Value::Number(n)) if n.as_u64().is_some_and(|p| p <= u32::MAX as u64) => None,
            _ => Some(Value::Null),
        };
        if let Some(new) = fixed {
            if new.is_null() {
                let mut shown = slot.to_string();
                if shown.len() > 40 {
                    shown.truncate(40);
                    shown.push('…');
                }
                let want = match kind {
                    Kind::Obj => "an object",
                    Kind::Str => "a string",
                    Kind::Num => "a number",
                    Kind::Int => "an integer",
                    Kind::Pid => "a process id",
                };
                out.push(Mismatch { path: (*path).to_string(), kind: MismatchKind::Mistyped { expected: want, got: shown } });
            }
            *slot = new;
        }
    }
    for (parent, keys) in REQUIRED {
        let Some(obj) = v.pointer(parent).and_then(|p| p.as_object()) else { continue };
        if let Some(k) = keys.iter().find(|k| obj.get(**k).map_or(true, |x| x.is_null())) {
            out.push(Mismatch { path: format!("{parent}/{k}"), kind: MismatchKind::SetAside { parent: (*parent).to_string() } });
            *v.pointer_mut(parent).unwrap() = serde_json::Value::Null;
        }
    }
    out
}

pub fn default_is_pid_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

// ---- raw shim schema (shim/statusline-wrapper.sh, shim/hook-writer.sh) ----

#[derive(Debug, Clone, Deserialize)]
pub struct RawSessionState {
    pub pid: Option<u32>,
    pub latest_statusline: Option<RawStatusline>,
    pub latest_hook_event: Option<RawHookEvent>,
    /// The session's working directory, as the shim last saw it (Q3: names a session in
    /// the corner picker). Absent in state files written before 2026-09-24.
    pub cwd: Option<String>,
    /// When the latest prompt was submitted (hook-writer.sh, 2026-09-24): the start of the
    /// turn the duration line times.
    pub turn_started_at: Option<i64>,
    /// When the latest turn ended at Stop or StopFailure (hook-writer.sh, 2026-09-25), so a
    /// later idle_prompt notification doesn't turn a finished turn back into "working for".
    #[serde(default)]
    pub turn_ended_at: Option<i64>,
    /// Filled by `parse_session_state`, never read from the file.
    #[serde(skip)]
    pub type_mismatches: Vec<Mismatch>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawStatusline {
    pub observed_at: i64,
    pub model: Option<RawModel>,
    pub effort: Option<RawEffort>,
    pub rate_limits: Option<RawRateLimits>,
    pub context_window: Option<RawContextWindow>,
    pub cost: Option<RawCost>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawModel {
    pub id: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawEffort {
    pub level: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawRateLimits {
    pub five_hour: Option<RawRateWindow>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawRateWindow {
    pub used_percentage: Option<f64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawContextWindow {
    pub used_percentage: Option<f64>,
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawCost {
    pub total_cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawHookEvent {
    pub observed_at: i64,
    pub hook_event_name: String,
    pub tool_name: Option<String>,
    pub notification_type: Option<String>,
    pub end_reason: Option<String>,
    #[serde(default)]
    pub error_type: Option<String>,
}

// ---- SessionSnapshot output schema, mirrors src/lib/layout/types.ts exactly ----

#[derive(Debug, Clone, Serialize)]
pub struct FieldOut<T> {
    pub value: Option<T>,
    pub availability: &'static str,
    pub source: String,
    pub observed_at: Option<i64>,
}

fn field<T>(value: T, availability: &'static str, source: impl Into<String>, observed_at: Option<i64>) -> FieldOut<T> {
    FieldOut { value: Some(value), availability, source: source.into(), observed_at }
}

fn unknown_field<T>(source: impl Into<String>) -> FieldOut<T> {
    FieldOut { value: None, availability: "unknown", source: source.into(), observed_at: None }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelValue {
    pub id: Option<String>,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenCounts {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenSpend {
    pub usd: FieldOut<f64>,
    pub tokens: FieldOut<TokenCounts>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: String,
    pub model: FieldOut<ModelValue>,
    pub effort: FieldOut<String>,
    pub usage_percent: FieldOut<f64>,
    pub reset_timer: FieldOut<i64>,
    pub context_percent: FieldOut<f64>,
    pub activity_state: FieldOut<String>,
    pub duration_line: FieldOut<String>,
    pub token_spend: TokenSpend,
    pub last_active_time: FieldOut<i64>,
}

pub fn derive_snapshot(
    session_id: &str,
    raw: Option<&RawSessionState>,
    now: i64,
    is_pid_alive: &dyn Fn(u32) -> bool,
) -> SessionSnapshot {
    let Some(raw) = raw else {
        return unknown_snapshot(session_id, "no state file for this session_id — nothing observed yet, or the shim isn't installed");
    };

    let sl = raw.latest_statusline.as_ref();
    let hook = raw.latest_hook_event.as_ref();

    let mut snap = SessionSnapshot {
        session_id: session_id.to_string(),
        model: derive_model(sl),
        effort: derive_effort(sl),
        usage_percent: derive_rate_limit_pct(sl),
        reset_timer: derive_rate_limit_reset(sl),
        context_percent: derive_context_percent(sl),
        activity_state: derive_activity_state(hook, raw.pid, now, is_pid_alive),
        duration_line: derive_duration_line(raw, hook, now, is_pid_alive),
        token_spend: TokenSpend { usd: derive_token_spend_usd(sl), tokens: derive_token_spend_tokens(sl) },
        last_active_time: derive_last_active_time(sl, hook),
    };
    mark_mistyped(&mut snap, &raw.type_mismatches);
    snap
}

/// One value `type_check` refused. Typed (quality check Q9, 2026-09-23): attribution used to
/// parse its own message back (`split(": ")`, `contains("set aside")`), so rewording a message
/// would have silently broken which field got the real reason.
#[derive(Debug, Clone, PartialEq)]
pub struct Mismatch {
    /// JSON pointer of the refused value (for `SetAside`, the missing required key).
    pub path: String,
    pub kind: MismatchKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MismatchKind {
    /// The value had the wrong JSON type and was nulled.
    Mistyped { expected: &'static str, got: String },
    /// A required key was missing or mistyped, so the whole sub-object `parent` was dropped.
    SetAside { parent: String },
}

impl std::fmt::Display for Mismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.kind {
            MismatchKind::Mistyped { expected, got } => write!(f, "{}: expected {expected}, got {got}", self.path),
            MismatchKind::SetAside { parent } => write!(f, "{}: missing or mistyped, so all of {parent} was set aside", self.path),
        }
    }
}

/// Whether mismatch `m` explains why leaf `read` is missing: the leaf itself, a parent it
/// sits under, or a sub-object set aside for a missing required key.
fn affects(read: &str, m: &Mismatch) -> bool {
    let under = |p: &str| read == p || read.starts_with(&format!("{p}/"));
    match &m.kind {
        MismatchKind::Mistyped { .. } => under(&m.path),
        MismatchKind::SetAside { parent } => under(&m.path) || under(parent),
    }
}

/// For a field that came out `unknown` because a value it reads was mistyped, replaces the
/// generic "not observed" reason with the real one. Never touches a derived value.
fn mark_mistyped(snap: &mut SessionSnapshot, mismatches: &[Mismatch]) {
    if mismatches.is_empty() {
        return;
    }
    const SL: &str = "/latest_statusline";
    const HOOK: &str = "/latest_hook_event";
    fn fix<T>(f: &mut FieldOut<T>, reads: &[&str], mismatches: &[Mismatch]) {
        if f.availability != "unknown" {
            return;
        }
        let hits: Vec<String> = mismatches
            .iter()
            .filter(|m| reads.iter().any(|r| affects(r, m)))
            .map(Mismatch::to_string)
            .collect();
        if !hits.is_empty() {
            f.source = format!("present but mistyped, shown UNKNOWN rather than guessed: {}", hits.join("; "));
        }
    }
    let m = mismatches;
    fix(&mut snap.model, &[&format!("{SL}/model/display_name")], m);
    fix(&mut snap.effort, &[&format!("{SL}/effort/level")], m);
    fix(&mut snap.usage_percent, &[&format!("{SL}/rate_limits/five_hour/used_percentage")], m);
    fix(&mut snap.reset_timer, &[&format!("{SL}/rate_limits/five_hour/resets_at")], m);
    fix(&mut snap.context_percent, &[&format!("{SL}/context_window/used_percentage")], m);
    fix(&mut snap.activity_state, &[&format!("{HOOK}/hook_event_name")], m);
    fix(&mut snap.token_spend.usd, &[&format!("{SL}/cost/total_cost_usd")], m);
    fix(
        &mut snap.token_spend.tokens,
        &[&format!("{SL}/context_window/total_input_tokens"), &format!("{SL}/context_window/total_output_tokens")],
        m,
    );
    fix(&mut snap.last_active_time, &[&format!("{SL}/observed_at"), &format!("{HOOK}/observed_at")], m);
}

/// Every field `unknown`, all carrying the same `reason`. Used when there's no state to
/// derive from: no file yet, or (audit F9) a file that exists but doesn't parse, in which
/// case the reason is the parse error itself, never "the shim isn't installed".
pub fn unknown_snapshot(session_id: &str, reason: &str) -> SessionSnapshot {
    SessionSnapshot {
        session_id: session_id.to_string(),
        model: unknown_field(reason),
        effort: unknown_field(reason),
        usage_percent: unknown_field(reason),
        reset_timer: unknown_field(reason),
        context_percent: unknown_field(reason),
        activity_state: unknown_field(reason),
        duration_line: unknown_field(reason),
        token_spend: TokenSpend { usd: unknown_field(reason), tokens: unknown_field(reason) },
        last_active_time: unknown_field(reason),
    }
}

fn derive_model(sl: Option<&RawStatusline>) -> FieldOut<ModelValue> {
    if let Some(sl) = sl {
        if let Some(display_name) = sl.model.as_ref().and_then(|m| m.display_name.clone()) {
            let id = sl.model.as_ref().and_then(|m| m.id.clone());
            return field(ModelValue { id, display_name }, "exposed", "statusline JSON model.display_name / model.id", Some(sl.observed_at));
        }
    }
    unknown_field("statusline JSON model field not yet observed for this session")
}

fn derive_effort(sl: Option<&RawStatusline>) -> FieldOut<String> {
    if let Some(sl) = sl {
        if let Some(level) = sl.effort.as_ref().and_then(|e| e.level.clone()) {
            return field(level, "exposed", "statusline JSON effort.level", Some(sl.observed_at));
        }
    }
    unknown_field(
        "statusline JSON effort field absent — either not yet observed, or the current model doesn't support the reasoning-effort parameter (Claude Code docs)",
    )
}

// Two genuinely different absence cases, confirmed distinct by the 2026-09-22 live
// capture (docs/field-availability.md rows 3-4, DECISIONS.md): `rate_limits` itself can
// be missing entirely, or present with only `seven_day` while `five_hour` is missing —
// 3 of 5 real sessions captured that day had the latter (all idle at capture time). What
// exactly brings `five_hour` back isn't isolated yet, so the reason says only what's known.
fn describe_rate_limit_absence(sl: Option<&RawStatusline>, which_field: &str) -> String {
    if sl.and_then(|s| s.rate_limits.as_ref()).is_some() {
        return format!(
            "statusline JSON rate_limits is present but its five_hour block is absent right now (seven_day alone was present in a 2026-09-22 live capture, on idle sessions specifically) — exact trigger for five_hour appearing isn't isolated yet; never inferred locally, see {which_field}"
        );
    }
    "statusline JSON rate_limits absent entirely — appears only for Pro/Max subscribers (or a spend-limited gateway) and only after the session's first API response (Claude Code docs); never inferred locally".to_string()
}

fn derive_rate_limit_pct(sl: Option<&RawStatusline>) -> FieldOut<f64> {
    if let Some(sl) = sl {
        if let Some(pct) = sl.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref()).and_then(|f| f.used_percentage) {
            return field(pct, "exposed", "statusline JSON rate_limits.five_hour.used_percentage", Some(sl.observed_at));
        }
    }
    unknown_field(describe_rate_limit_absence(sl, "rate_limits.five_hour.used_percentage"))
}

fn derive_rate_limit_reset(sl: Option<&RawStatusline>) -> FieldOut<i64> {
    if let Some(sl) = sl {
        if let Some(resets_at) = sl.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref()).and_then(|f| f.resets_at) {
            return field(resets_at, "exposed", "statusline JSON rate_limits.five_hour.resets_at (unix epoch seconds)", Some(sl.observed_at));
        }
    }
    unknown_field(describe_rate_limit_absence(sl, "rate_limits.five_hour.resets_at — per PLAN.md §8 trigger 1"))
}

fn derive_context_percent(sl: Option<&RawStatusline>) -> FieldOut<f64> {
    if let Some(sl) = sl {
        if let Some(pct) = sl.context_window.as_ref().and_then(|c| c.used_percentage) {
            return field(
                pct,
                "exposed",
                "statusline JSON context_window.used_percentage (Claude Code pre-computes this; no token-arithmetic proxy needed)",
                Some(sl.observed_at),
            );
        }
    }
    unknown_field("statusline JSON context_window.used_percentage is null/absent early in a session or right after /compact, until the next API call (Claude Code docs)")
}

/// Claude Code's own spinner line ("Worked for 49s · done 14:20") is not exposed to a corner
/// session (docs/field-availability.md row 7). Quality check Q5 (2026-09-23): the same fact
/// is approximable from hook times the shim already sees. It records when the latest prompt
/// was submitted (`turn_started_at`); the turn ends at the next Stop. Mirrors the Node reader.
fn derive_duration_line(raw: &RawSessionState, hook: Option<&RawHookEvent>, now: i64, is_pid_alive: &dyn Fn(u32) -> bool) -> FieldOut<String> {
    let (Some(start), Some(hook)) = (raw.turn_started_at, hook) else {
        return unknown_field("no prompt submitted since the shim began recording turn starts (2026-09-24)");
    };
    if let Some(pid) = raw.pid.filter(|p| !is_pid_alive(*p)) {
        return unknown_field(format!("owning process pid {pid} ended; the turn's end was never observed"));
    }
    let source = "approximated from the shim's hook times (UserPromptSubmit to Stop), not Claude Code's own spinner line";
    let done = hook.hook_event_name == "Stop" || (hook.hook_event_name == "Notification" && hook.notification_type.as_deref() == Some("agent_completed"));
    if hook.hook_event_name == "StopFailure" && hook.observed_at >= start {
        return field(format!("failed after {}", fmt_elapsed(hook.observed_at - start)), "approximable", source, Some(hook.observed_at));
    }
    if done && hook.observed_at >= start {
        return field(format!("worked for {}", fmt_elapsed(hook.observed_at - start)), "approximable", source, Some(hook.observed_at));
    }
    if let Some(ended) = raw.turn_ended_at.filter(|e| *e >= start) {
        return field(format!("worked for {}", fmt_elapsed(ended - start)), "approximable", source, Some(ended));
    }
    if hook.hook_event_name == "SessionEnd" {
        return unknown_field("the session ended before the turn's Stop");
    }
    field(format!("working for {}", fmt_elapsed((now - start).max(0))), "approximable", source, Some(start))
}

fn derive_token_spend_usd(sl: Option<&RawStatusline>) -> FieldOut<f64> {
    if let Some(sl) = sl {
        if let Some(usd) = sl.cost.as_ref().and_then(|c| c.total_cost_usd) {
            return field(usd, "exposed", "statusline JSON cost.total_cost_usd", Some(sl.observed_at));
        }
    }
    unknown_field("statusline JSON cost field not yet observed for this session")
}

fn derive_token_spend_tokens(sl: Option<&RawStatusline>) -> FieldOut<TokenCounts> {
    if let Some(sl) = sl {
        if let Some(cw) = &sl.context_window {
            if cw.total_input_tokens.is_some() || cw.total_output_tokens.is_some() {
                return field(
                    TokenCounts { input_tokens: cw.total_input_tokens, output_tokens: cw.total_output_tokens },
                    "approximable",
                    "statusline JSON context_window.total_input_tokens/total_output_tokens — the CURRENT context window's token count, not a cumulative lifetime spend counter; kept strictly distinct from tokenSpend.usd (PLAN.md §2.2)",
                    Some(sl.observed_at),
                );
            }
        }
    }
    unknown_field("statusline JSON context_window token counts not yet observed for this session")
}

fn derive_last_active_time(sl: Option<&RawStatusline>, hook: Option<&RawHookEvent>) -> FieldOut<i64> {
    let candidates: Vec<i64> = [sl.map(|s| s.observed_at), hook.map(|h| h.observed_at)].into_iter().flatten().collect();
    match candidates.into_iter().max() {
        None => unknown_field("no statusline or hook event observed yet for this session"),
        Some(observed_at) => field(
            observed_at,
            "exposed",
            "derived from the last observed statusline/hook event timestamp — never from file mtime (PLAN.md §2.2's own caught bug: mtime measures a write, not session activity)",
            Some(observed_at),
        ),
    }
}

fn activity_label_for_event(hook: &RawHookEvent) -> String {
    match hook.hook_event_name.as_str() {
        "SessionStart" => "ready".to_string(), // a new session waits for its first prompt
        "UserPromptSubmit" => "processing".to_string(),
        "PreToolUse" => match &hook.tool_name {
            Some(name) => format!("running tool: {name}"),
            None => "running tool".to_string(),
        },
        "PostToolUse" | "PostToolUseFailure" | "PostToolBatch" => "processing".to_string(),
        "Stop" => "idle".to_string(),
        // error_type is a category (rate_limit, overloaded, ...), never message text.
        "StopFailure" => format!("failed: {}", hook.error_type.as_deref().unwrap_or("unknown")),
        "PermissionRequest" => "blocked: permission".to_string(),
        "SessionEnd" => format!("ended ({})", hook.end_reason.as_deref().unwrap_or("unknown reason")),
        "Notification" => match hook.notification_type.as_deref() {
            Some("permission_prompt") => "blocked: permission".to_string(),
            Some("elicitation_dialog") | Some("agent_needs_input") => "blocked: question".to_string(),
            Some("idle_prompt") => "your turn".to_string(),
            Some("agent_completed") => "idle".to_string(),
            Some(other) => format!("notification ({other})"),
            None => "notification".to_string(),
        },
        other => format!("last event: {other}"),
    }
}

fn derive_activity_state(hook: Option<&RawHookEvent>, pid: Option<u32>, now: i64, is_pid_alive: &dyn Fn(u32) -> bool) -> FieldOut<String> {
    let Some(hook) = hook else {
        return unknown_field("no lifecycle hook event observed yet for this session");
    };
    if let Some(pid) = pid {
        if !is_pid_alive(pid) {
            return field(
                "ended (process not running)".to_string(),
                "exposed",
                format!("owning process pid {pid} is no longer alive — a verified fact, not a timeout inference (PLAN.md §2.1: terminal death is its own disconnection case)"),
                Some(hook.observed_at),
            );
        }
    }

    let label = activity_label_for_event(hook);
    let age_s = (now - hook.observed_at).max(0);
    let is_terminal = TERMINAL_HOOK_EVENTS.contains(&hook.hook_event_name.as_str()) || is_waiting_label(&label);
    if is_terminal {
        return field(label, "approximable", format!("derived from last hook event: {}", hook.hook_event_name), Some(hook.observed_at));
    }

    // Quality check Q2 (2026-09-23): a long tool call (a build, a test suite, a subagent) sends
    // no event until it finishes, so silence on a live process is the busiest state, not a stale
    // one. With the owning process verified alive, show the state and how long it has lasted
    // ("running tool: Bash · 4m 10s", the spec's "XYZ for 49s"). Only with no process to check
    // does a long silence become "stale" (PLAN.md §12: silence is not a status).
    if pid.is_none() && age_s > STALE_AFTER_S {
        return field(
            format!("stale · last event {} ago", fmt_elapsed(age_s)),
            "approximable",
            format!("no hook event in the last {STALE_AFTER_S}s since {} and no owning process recorded to check; not asserted idle or still-running", hook.hook_event_name),
            Some(hook.observed_at),
        );
    }
    let alive_note = pid.map(|p| format!(", owning process pid {p} alive")).unwrap_or_default();
    field(
        format!("{label} · {}", fmt_elapsed(age_s)),
        "approximable",
        format!("derived from last hook event: {}; elapsed since it{alive_note}", hook.hook_event_name),
        Some(hook.observed_at),
    )
}

/// 42 -> "42s", 250 -> "4m 10s", 7260 -> "2h 1m". Mirrors reader/src/deriveSnapshot.mjs.
fn fmt_elapsed(s: i64) -> String {
    if s < 60 {
        format!("{s}s")
    } else if s < 3600 {
        format!("{}m {}s", s / 60, s % 60)
    } else {
        format!("{}h {}m", s / 3600, (s % 3600) / 60)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn base_sl(observed_at: i64) -> RawStatusline {
        RawStatusline {
            observed_at,
            model: Some(RawModel { id: Some("claude-sonnet-5".into()), display_name: Some("Sonnet 5".into()) }),
            effort: Some(RawEffort { level: Some("high".into()) }),
            rate_limits: Some(RawRateLimits { five_hour: Some(RawRateWindow { used_percentage: Some(10.0), resets_at: Some(5000) }) }),
            context_window: Some(RawContextWindow { used_percentage: Some(5.0), total_input_tokens: Some(100), total_output_tokens: Some(20) }),
            cost: Some(RawCost { total_cost_usd: Some(0.1) }),
        }
    }

    fn alive(_pid: u32) -> bool {
        true
    }

    // `ZOFIA_SESSIONS_DIR` is process-wide env state; `cargo test` runs tests in
    // parallel threads by default, so any two tests that set/read/remove it race unless
    // serialized. Every test below that touches the env var takes this lock first.
    pub(crate) static ENV_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn null_raw_state_every_field_unknown_with_source() {
        let snap = derive_snapshot("s1", None, 1000, &alive);
        assert_eq!(snap.model.availability, "unknown");
        assert!(!snap.model.source.is_empty());
        assert_eq!(snap.token_spend.usd.availability, "unknown");
        assert_eq!(snap.token_spend.tokens.availability, "unknown");
    }

    #[test]
    fn full_statusline_payload_exposed() {
        let raw = RawSessionState { pid: None, latest_statusline: Some(base_sl(1000)), latest_hook_event: None, type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000, &alive);
        assert_eq!(snap.model.availability, "exposed");
        assert_eq!(snap.model.value.unwrap().display_name, "Sonnet 5");
        assert_eq!(snap.effort.value, Some("high".to_string()));
        assert_eq!(snap.usage_percent.value, Some(10.0));
        assert_eq!(snap.reset_timer.value, Some(5000));
        assert_eq!(snap.context_percent.value, Some(5.0));
        assert_eq!(snap.token_spend.usd.value, Some(0.1));
        assert_eq!(snap.token_spend.usd.availability, "exposed");
        assert_eq!(snap.token_spend.tokens.availability, "approximable");
    }

    #[test]
    fn rate_limits_absent_entirely_never_guessed() {
        let mut sl = base_sl(1000);
        sl.rate_limits = None;
        let raw = RawSessionState { pid: None, latest_statusline: Some(sl), latest_hook_event: None, type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000, &alive);
        assert_eq!(snap.usage_percent.availability, "unknown");
        assert_eq!(snap.reset_timer.availability, "unknown");
        assert!(snap.reset_timer.source.contains("absent entirely"));
    }

    #[test]
    fn rate_limits_present_but_five_hour_missing_real_idle_shape() {
        let mut sl = base_sl(1000);
        sl.rate_limits = Some(RawRateLimits { five_hour: None });
        let raw = RawSessionState { pid: None, latest_statusline: Some(sl), latest_hook_event: None, type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000, &alive);
        assert_eq!(snap.usage_percent.availability, "unknown");
        assert_eq!(snap.reset_timer.availability, "unknown");
        assert!(!snap.usage_percent.source.contains("absent entirely"));
        assert!(snap.usage_percent.source.contains("five_hour block is absent"));
    }

    #[test]
    fn effort_absent_not_defaulted() {
        let mut sl = base_sl(1000);
        sl.effort = None;
        let raw = RawSessionState { pid: None, latest_statusline: Some(sl), latest_hook_event: None, type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000, &alive);
        assert_eq!(snap.effort.availability, "unknown");
    }

    fn turn(start: Option<i64>, hook_at: i64, name: &str, pid: Option<u32>) -> RawSessionState {
        RawSessionState {
            pid,
            latest_statusline: Some(base_sl(1000)),
            latest_hook_event: Some(RawHookEvent { observed_at: hook_at, hook_event_name: name.into(), tool_name: Some("Bash".into()), notification_type: None, end_reason: None, error_type: None }),
            type_mismatches: Vec::new(),
            cwd: None,
            turn_started_at: start,
            turn_ended_at: None,
        }
    }

    // Q5: the spec's "XYZ for 49s · done XX:YY", approximated from UserPromptSubmit -> Stop.
    #[test]
    fn duration_line_times_the_turn() {
        let busy = derive_snapshot("s1", Some(&turn(Some(1000), 1100, "PreToolUse", Some(7))), 1250, &alive);
        assert_eq!(busy.duration_line.value.as_deref(), Some("working for 4m 10s"));
        assert_eq!(busy.duration_line.availability, "approximable");
        let done = derive_snapshot("s1", Some(&turn(Some(1000), 1123, "Stop", Some(7))), 5000, &alive);
        assert_eq!(done.duration_line.value.as_deref(), Some("worked for 2m 3s"));
        assert_eq!(done.duration_line.observed_at, Some(1123), "the UI prints 'done HH:MM' from the Stop time");
    }

    #[test]
    fn duration_line_unknown_without_a_turn_start_or_after_the_process_died() {
        let none = derive_snapshot("s1", Some(&turn(None, 1000, "PreToolUse", None)), 1000, &alive);
        assert_eq!(none.duration_line.availability, "unknown");
        let dead = derive_snapshot("s1", Some(&turn(Some(1000), 1100, "PreToolUse", Some(7))), 1250, &|_| false);
        assert_eq!(dead.duration_line.availability, "unknown");
        assert!(dead.duration_line.source.contains("pid 7 ended"));
    }

    #[test]
    fn activity_pretooluse_running_tool() {
        let raw = RawSessionState {
            pid: None,
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "PreToolUse".into(), tool_name: Some("Bash".into()), notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1005, &alive);
        assert_eq!(snap.activity_state.value, Some("running tool: Bash · 5s".to_string()));
        assert_eq!(snap.activity_state.availability, "approximable");
    }

    #[test]
    fn activity_stop_idle_even_long_after() {
        let raw = RawSessionState { pid: None, latest_statusline: None, latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "Stop".into(), tool_name: None, notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 10_000, &alive);
        assert_eq!(snap.activity_state.value, Some("idle".to_string()));
    }

    #[test]
    fn activity_non_terminal_gone_stale() {
        let raw = RawSessionState {
            pid: None,
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "PreToolUse".into(), tool_name: Some("Bash".into()), notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 121, &alive);
        assert_eq!(snap.activity_state.value, Some("stale · last event 2m 1s ago".to_string()));
        assert_ne!(snap.activity_state.value, Some("idle".to_string()));
    }

    // Q2: a four-minute build on a live process is the busiest state, never "stale".
    #[test]
    fn activity_long_tool_call_on_live_process_is_never_stale() {
        let raw = RawSessionState {
            pid: Some(4242),
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "PreToolUse".into(), tool_name: Some("Bash".into()), notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 250, &alive);
        assert_eq!(snap.activity_state.value, Some("running tool: Bash · 4m 10s".to_string()));
        assert!(snap.activity_state.source.contains("pid 4242 alive"));
    }

    // Q2: a new session is waiting for its first prompt, not processing, and never goes stale.
    #[test]
    fn activity_session_start_is_ready_and_never_stale() {
        let raw = RawSessionState {
            pid: None,
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "SessionStart".into(), tool_name: None, notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 10_000, &alive);
        assert_eq!(snap.activity_state.value, Some("ready".to_string()));
    }

    // Quality check Q10: the shared corpus in test/reader-parity/, which the Node reader's
    // reader/test/parity.test.mjs checks too. value, availability and observed_at of every
    // field must match `expected`; `source` is prose and not compared. Numbers compare as
    // f64, since Rust writes 18.0 where Node writes 18.
    #[test]
    fn parity_corpus() {
        fn norm(v: &serde_json::Value) -> serde_json::Value {
            use serde_json::Value;
            match v {
                Value::Number(n) => Value::from(n.as_f64().unwrap()),
                Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
                Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
                other => other.clone(),
            }
        }
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/reader-parity");
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
        files.sort();
        assert!(files.len() >= 10, "only {} cases in {}", files.len(), dir.display());
        for file in files {
            let case: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
            let now = case["now"].as_i64().unwrap();
            let alive: Vec<u32> = case["alive_pids"].as_array().unwrap().iter().map(|p| p.as_u64().unwrap() as u32).collect();
            let raw = if case["state"].is_null() { None } else { Some(parse_session_state(&case["state"].to_string()).unwrap()) };
            let snap = serde_json::to_value(derive_snapshot("parity", raw.as_ref(), now, &|pid| alive.contains(&pid))).unwrap();
            let pick = |f: &serde_json::Value| serde_json::json!({ "value": f["value"], "availability": f["availability"], "observed_at": f["observed_at"] });
            let mut got = serde_json::Map::new();
            for k in ["model", "effort", "usagePercent", "resetTimer", "contextPercent", "activityState", "durationLine", "lastActiveTime"] {
                got.insert(k.into(), pick(&snap[k]));
            }
            got.insert("tokenSpend.usd".into(), pick(&snap["tokenSpend"]["usd"]));
            got.insert("tokenSpend.tokens".into(), pick(&snap["tokenSpend"]["tokens"]));
            let got = serde_json::Value::Object(got);
            assert_eq!(norm(&got), norm(&case["expected"]), "{}: {}", file.display(), case["description"]);
        }
    }

    // C4: no debug strings in the headline. Mirrors the Node reader's test.
    #[test]
    fn activity_unlisted_notification_or_event_reads_plainly() {
        let at = |name: &str, nt: Option<&str>| {
            let raw = RawSessionState {
                pid: None,
                latest_statusline: None,
                latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: name.into(), tool_name: None, notification_type: nt.map(Into::into), end_reason: None, error_type: None }),
                type_mismatches: Vec::new(),
                cwd: None,
                turn_started_at: None,
                turn_ended_at: None,
            };
            derive_snapshot("s1", Some(&raw), 1000, &alive).activity_state.value.unwrap()
        };
        assert_eq!(at("Notification", Some("auth_success")), "notification (auth_success) · 0s");
        assert_eq!(at("Notification", None), "notification · 0s");
        assert_eq!(at("SubagentStop", None), "last event: SubagentStop · 0s");
    }

    #[test]
    fn fmt_elapsed_shapes() {
        assert_eq!(fmt_elapsed(42), "42s");
        assert_eq!(fmt_elapsed(250), "4m 10s");
        assert_eq!(fmt_elapsed(7260), "2h 1m");
    }

    #[test]
    fn activity_fresh_non_terminal_not_stale() {
        let raw = RawSessionState {
            pid: None,
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "PreToolUse".into(), tool_name: Some("Bash".into()), notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 60, &alive);
        assert_eq!(snap.activity_state.value, Some("running tool: Bash · 1m 0s".to_string()));
    }

    #[test]
    fn activity_dead_process_overrides_fresh_stop() {
        let raw = RawSessionState { pid: Some(99999), latest_statusline: None, latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "Stop".into(), tool_name: None, notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1001, &|_pid| false);
        assert_eq!(snap.activity_state.value, Some("ended (process not running)".to_string()));
        assert_eq!(snap.activity_state.availability, "exposed");
    }

    #[test]
    fn activity_notification_waiting_for_input_never_stale() {
        let raw = RawSessionState {
            pid: None,
            latest_statusline: None,
            latest_hook_event: Some(RawHookEvent { observed_at: 1000, hook_event_name: "Notification".into(), tool_name: None, notification_type: Some("agent_needs_input".into()), end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000 + 10_000, &alive);
        assert_eq!(snap.activity_state.value, Some("blocked: question".to_string()));
    }

    #[test]
    fn last_active_time_picks_freshest_never_mtime() {
        let raw = RawSessionState { pid: None, latest_statusline: Some(base_sl(500)), latest_hook_event: Some(RawHookEvent { observed_at: 900, hook_event_name: "Stop".into(), tool_name: None, notification_type: None, end_reason: None, error_type: None }), type_mismatches: Vec::new(), cwd: None, turn_started_at: None, turn_ended_at: None };
        let snap = derive_snapshot("s1", Some(&raw), 1000, &alive);
        assert_eq!(snap.last_active_time.value, Some(900));
        assert!(snap.last_active_time.source.contains("never from file mtime"));
    }

    #[test]
    fn sessions_dir_honors_env_override() {
        let _guard = ENV_TEST_LOCK.lock().unwrap();
        std::env::set_var("ZOFIA_SESSIONS_DIR", "/tmp/zofia-test-override");
        assert_eq!(sessions_dir(), PathBuf::from("/tmp/zofia-test-override"));
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
    }

    /// The fixture-replay test HANDOFF.md item 3 names: real (or realistically-shaped)
    /// on-disk fixture files, read exactly the way the live shim writes them, produce a
    /// correct SessionSnapshot — including an explicit `unknown` for the one real gap
    /// the 2026-09-22 live capture found (rate_limits present, five_hour missing).
    #[test]
    fn fixture_replay_real_idle_session_shape() {
        let _guard = ENV_TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("zofia-fixture-replay-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("ZOFIA_SESSIONS_DIR", &dir);

        // Mirrors the real capture recorded in DECISIONS.md: seven_day present, five_hour
        // absent, on an idle session with no fresh hook traffic.
        let fixture = r#"{
            "pid": 12345,
            "latest_statusline": {
                "observed_at": 1790110230,
                "model": {"id": "claude-sonnet-5", "display_name": "Sonnet 5"},
                "effort": {"level": "medium"},
                "rate_limits": {"seven_day": {"used_percentage": 28, "resets_at": 1790474400}},
                "context_window": {"used_percentage": 3, "total_input_tokens": 5000, "total_output_tokens": 12},
                "cost": {"total_cost_usd": 0.42}
            },
            "latest_hook_event": null
        }"#;
        std::fs::write(dir.join("fixture-idle.json"), fixture).unwrap();

        let raw = read_session_state("fixture-idle").unwrap().expect("fixture must be found");
        let snap = derive_snapshot("fixture-idle", Some(&raw), 1790110230, &default_is_pid_alive);

        assert_eq!(snap.model.availability, "exposed");
        assert_eq!(snap.model.value.unwrap().display_name, "Sonnet 5");
        assert_eq!(snap.token_spend.usd.value, Some(0.42));
        assert_eq!(snap.usage_percent.availability, "unknown");
        assert!(snap.usage_percent.source.contains("five_hour block is absent"), "got: {}", snap.usage_percent.source);
        assert_eq!(snap.activity_state.availability, "unknown"); // no hook event observed yet

        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Follow-up to audit F9: one mistyped field blanks that field only, with the real
    // reason; everything else still derives.
    #[test]
    fn one_mistyped_field_leaves_the_rest_of_the_snapshot_intact() {
        let text = r#"{"pid":4242,"latest_statusline":{"observed_at":1000,
            "model":{"id":"claude-sonnet-5","display_name":"Sonnet 5"},"effort":{"level":"medium"},
            "rate_limits":{"five_hour":{"used_percentage":40,"resets_at":"soon"}},
            "context_window":{"used_percentage":12.5,"total_input_tokens":100.0,"total_output_tokens":7},
            "cost":{"total_cost_usd":0.5}},
            "latest_hook_event":{"observed_at":1001,"hook_event_name":"Stop"}}"#;
        let raw = parse_session_state(text).unwrap();
        assert_eq!(raw.type_mismatches.len(), 1, "{:?}", raw.type_mismatches);
        let snap = derive_snapshot("s", Some(&raw), 1010, &alive);
        assert_eq!(snap.reset_timer.availability, "unknown");
        assert!(snap.reset_timer.source.contains("mistyped"), "{}", snap.reset_timer.source);
        assert!(snap.reset_timer.source.contains("resets_at: expected an integer, got \"soon\""));
        assert_eq!(snap.usage_percent.value, Some(40.0));
        assert_eq!(snap.model.value.as_ref().map(|m| m.display_name.as_str()), Some("Sonnet 5"));
        assert_eq!(snap.effort.value.as_deref(), Some("medium"));
        assert_eq!(snap.token_spend.usd.value, Some(0.5));
        assert_eq!(snap.last_active_time.value, Some(1001));
        // 100.0 is the same integer written as a float: accepted, not a mismatch.
        assert!(snap.token_spend.tokens.value.is_some());
    }

    // Q9: attribution reads the typed kind and path, never the message text.
    #[test]
    fn affects_follows_the_typed_mismatch_not_its_wording() {
        let mistyped = Mismatch { path: "/latest_statusline/rate_limits".into(), kind: MismatchKind::Mistyped { expected: "an object", got: "7".into() } };
        assert!(affects("/latest_statusline/rate_limits/five_hour/resets_at", &mistyped));
        assert!(!affects("/latest_statusline/rate_limits_extra", &mistyped), "a sibling with a shared prefix is not under it");
        let set_aside = Mismatch { path: "/latest_hook_event/observed_at".into(), kind: MismatchKind::SetAside { parent: "/latest_hook_event".into() } };
        assert!(affects("/latest_hook_event/hook_event_name", &set_aside));
        assert!(!affects("/latest_statusline/model/display_name", &set_aside));
        assert_eq!(set_aside.to_string(), "/latest_hook_event/observed_at: missing or mistyped, so all of /latest_hook_event was set aside");
    }

    #[test]
    fn a_mistyped_parent_or_required_key_sets_aside_only_its_own_subtree() {
        let text = r#"{"pid":"abc","latest_statusline":{"observed_at":"later","model":{"display_name":"X"}},
            "latest_hook_event":{"observed_at":1001,"hook_event_name":"PreToolUse","tool_name":"Bash"}}"#;
        let raw = parse_session_state(text).unwrap();
        assert!(raw.latest_statusline.is_none());
        assert!(raw.pid.is_none());
        let snap = derive_snapshot("s", Some(&raw), 1010, &alive);
        assert_eq!(snap.model.availability, "unknown");
        assert!(snap.model.source.contains("set aside"), "{}", snap.model.source);
        assert!(snap.activity_state.value.is_some(), "the hook event still derives");
        assert_eq!(snap.last_active_time.value, Some(1001));

        let rl = parse_session_state(r#"{"latest_statusline":{"observed_at":1,"rate_limits":[1]}}"#).unwrap();
        let snap = derive_snapshot("s", Some(&rl), 5, &alive);
        assert!(snap.usage_percent.source.contains("rate_limits: expected an object"), "{}", snap.usage_percent.source);
    }

    #[test]
    fn a_file_that_is_not_a_json_object_is_still_an_error() {
        assert!(parse_session_state("[1,2]").unwrap_err().contains("not a JSON object"));
        assert!(parse_session_state("{").unwrap_err().contains("not valid JSON"));
    }

    #[test]
    fn session_ids_that_could_leave_the_sessions_dir_are_refused() {
        for bad in ["../etc/passwd", "a/b", "..", "", "x y", "sess\u{0}", &"a".repeat(129)] {
            assert!(!is_valid_session_id(bad), "{bad:?}");
            assert!(read_session_state(bad).is_err(), "{bad:?}");
        }
        assert!(is_valid_session_id("d55b834d-d581-4891-9429-5afbe96e9f96"));
        assert!(is_valid_session_id("sess_1"));
    }

    #[test]
    fn without_xdg_runtime_dir_the_fallback_is_per_user() {
        let _guard = ENV_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let saved = std::env::var("XDG_RUNTIME_DIR").ok();
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::env::remove_var("XDG_RUNTIME_DIR");
        let dir = sessions_dir();
        if let Some(v) = saved {
            std::env::set_var("XDG_RUNTIME_DIR", v);
        }
        assert_eq!(dir, PathBuf::from(format!("/tmp/zofia-{}/sessions", current_uid())));
    }

    #[test]
    fn missing_session_file_is_none_not_error() {
        let _guard = ENV_TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("zofia-missing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("ZOFIA_SESSIONS_DIR", &dir);
        let result = read_session_state("does-not-exist").unwrap();
        assert!(result.is_none());
        std::env::remove_var("ZOFIA_SESSIONS_DIR");
        std::fs::remove_dir_all(&dir).ok();
    }
}
