// What Zofia asks of the operating system that differs between Linux, macOS and Windows,
// kept in one module so the rest of the crate stays platform-free. Linux behaviour is
// exactly what it was before this module existed (Fedora 44 is still the only declared
// platform); the macOS and Windows arms compile and are reasoned about, not yet run on
// real hardware.
//
// Mapping (Linux -> macOS -> Windows):
// - session-state dir: $XDG_RUNTIME_DIR/zofia (tmpfs) or /tmp/zofia-<uid> -> the same
//   unix rule -> %LOCALAPPDATA%\zofia (per-user profile ACL, but on disk: it survives a
//   reboot, unlike tmpfs);
// - "is this file ours": owner uid -> owner uid -> not checked yet (needs the owner SID);
// - private modes 0700/0600: set -> set -> no-op (inherits the profile's ACL);
// - process liveness: /proc/<pid> -> kill(pid, 0) -> OpenProcess + GetExitCodeProcess.

use std::path::PathBuf;

/// Where the shim writes per-session state, before the `sessions` leaf. Must match
/// reader/shim/common.sh and reader/src/sessionState.mjs on each platform.
pub fn state_root() -> PathBuf {
    #[cfg(unix)]
    {
        // Per-user fallback, never a shared /tmp/zofia (audit F10, 2026-09-23).
        match std::env::var("XDG_RUNTIME_DIR") {
            Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("zofia"),
            _ => PathBuf::from(format!("/tmp/zofia-{}", current_uid())),
        }
    }
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        base.join("zofia")
    }
}

#[cfg(unix)]
pub fn current_uid() -> u32 {
    // SAFETY: getuid(2) takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

/// `Err` when `meta` belongs to another user, so planted state is never read or written.
pub fn check_owned(meta: &std::fs::Metadata, what: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != current_uid() {
            return Err(format!("{} is owned by uid {}, not you", what.display(), meta.uid()));
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        // TODO(windows): compare the owner SID (GetSecurityInfo) with the process token's
        // user. Until then the protection is %LOCALAPPDATA%'s per-user ACL.
        let _ = (meta, what);
        Ok(())
    }
}

/// 0700 on unix; a no-op on Windows, where the directory inherits the profile's ACL.
pub fn make_dir_private(dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    #[cfg(windows)]
    let _ = dir;
}

/// Opens `options` with mode 0600 on unix (the file is created private, never widened
/// later); on Windows the new file inherits its directory's ACL.
pub fn private_file(options: &mut std::fs::OpenOptions) -> &mut std::fs::OpenOptions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600)
    }
    #[cfg(windows)]
    {
        options
    }
}

/// Everything that moves when a file's content could have changed (hash_sweep's cache
/// key). Unix: dev, ino, size, mtime, ctime; ctime can't be set back without root, so an
/// unchanged key means unchanged content. Windows has no ctime in std and no stable file
/// index, so the key is size + last-write + creation time, which a deliberate
/// SetFileTime can fake: weaker, and said so here.
pub type StatKey = (u64, u64, u64, i64, i64, i64, i64);

pub fn stat_key(m: &std::fs::Metadata) -> StatKey {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (m.dev(), m.ino(), m.size(), m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec())
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        (0, 0, m.file_size(), m.last_write_time() as i64, 0, m.creation_time() as i64, 0)
    }
}

/// Whether a process with this pid exists right now. A zombie counts as alive on every
/// platform; callers that must tell "exited" from "running" use `leader_exited`.
pub fn is_pid_alive(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let Ok(pid) = i32::try_from(pid) else { return false };
        if pid <= 0 {
            return false;
        }
        // SAFETY: kill(2) with signal 0 only checks existence and permission.
        let rc = unsafe { libc::kill(pid, 0) };
        rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        // SAFETY: plain Win32 calls on a handle we open and close here; no memory shared.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code: u32 = 0;
            let ok = GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == STILL_ACTIVE as u32
        }
    }
}

/// Whether our own child `pid` has exited, without reaping it (stop() reaps). Linux reads
/// the zombie state from /proc; other unixes ask waitid with WNOWAIT; on Windows the
/// portable-pty child keeps a handle open, so the pid can't be reused and "no longer
/// active" means exited.
pub fn leader_exited(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .map_or(true, |s| s.rfind(')').and_then(|i| s.get(i + 2..i + 3)) == Some("Z"))
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        // SAFETY: waitid on our own child with WNOWAIT leaves it waitable; the siginfo is
        // a zeroed local the kernel fills in.
        unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            let rc = libc::waitid(libc::P_PID, pid as libc::id_t, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT);
            rc == -1 || info.si_pid != 0
        }
    }
    #[cfg(windows)]
    {
        !is_pid_alive(pid)
    }
}
