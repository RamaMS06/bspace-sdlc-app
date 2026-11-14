//! Runs programs on this computer and finds them the way the user's terminal would: the login
//! shell's PATH plus the usual node/tool folders.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Runs a program and finds one on the PATH; faked in tests.
pub trait Exec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String>;
    fn which(&self, program: &str) -> Option<PathBuf>;
}

const EXEC_TIMEOUT: Duration = Duration::from_secs(5);

/// `v22.11.0` -> (22, 11, 0). Anything that isn't a version sorts first.
fn semver_key(name: &str) -> (u64, u64, u64) {
    let mut it = name.trim_start_matches('v').split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// Highest-version `<root>/<version>/bin` that exists, e.g. in `~/.nvm/versions/node`.
fn newest_version_bin(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().join("bin").is_dir())
        .max_by_key(|e| semver_key(&e.file_name().to_string_lossy()))
        .map(|e| e.path().join("bin"))
}

/// Where Node, npx, agents and their tools usually live, beyond PATH. Both the PATH
/// we give spawned processes and `RealExec::which` are built from this one list, so a
/// GUI launch (minimal PATH) finds what nvm, volta, fnm or Homebrew installed.
pub fn tool_dirs(home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(unix) {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        if let Some(h) = home {
            dirs.push(h.join(".local").join("bin"));
            dirs.push(h.join(".volta").join("bin"));
            for fnm in [
                h.join(".fnm"),
                h.join(".local").join("share").join("fnm"),
                h.join("Library").join("Application Support").join("fnm"),
            ] {
                let bin = fnm.join("aliases").join("default").join("bin");
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
            let share = h.join(".local").join("share");
            // nvm, then nvm.fish (~/.local/share/nvm/v22.x/bin), the usual pick on fish.
            dirs.extend(newest_version_bin(&h.join(".nvm").join("versions").join("node")));
            dirs.extend(newest_version_bin(&share.join("nvm")));
            // Version managers that run node through shims.
            for shims in [share.join("mise").join("shims"), h.join(".asdf").join("shims"), h.join(".nodenv").join("shims")] {
                if shims.is_dir() {
                    dirs.push(shims);
                }
            }
            dirs.push(h.join(".claude").join("local"));
            dirs.push(h.join(".opencode").join("bin"));
        }
        // System dirs last, so user-space installs (a newer node in nvm, tools in ~/.local/bin) win.
        dirs.push(PathBuf::from("/usr/bin"));
        dirs.push(PathBuf::from("/bin"));
    }
    if cfg!(windows) {
        dirs.extend(appdata.map(|a| a.join("npm")));
        // winget puts portable tools behind links here.
        if let Some(h) = home {
            dirs.push(h.join("AppData").join("Local").join("Microsoft").join("WinGet").join("Links"));
            // Antigravity CLI's installer puts `agy` here.
            dirs.push(h.join("AppData").join("Local").join("agy").join("bin"));
        }
        // A winget install updates the stored PATH, not the one this app started with.
        dirs.extend(registry_path());
    }
    dirs
}

/// Replaces `%NAME%` with `lookup(NAME)`; unknown names and lone `%` stay as they are.
#[cfg(any(windows, test))]
pub fn expand_env_vars(s: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The machine and user PATH as stored in the registry, expanded.
#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .and_then(|k| k.get_value::<String, _>("Path"))
        .ok();
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .and_then(|k| k.get_value::<String, _>("Path"))
        .ok();
    [machine, user]
        .into_iter()
        .flatten()
        .flat_map(|p| {
            let expanded = expand_env_vars(&p, |n| std::env::var(n).ok());
            std::env::split_paths(&expanded).collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(not(windows))]
fn registry_path() -> Vec<PathBuf> {
    Vec::new()
}

fn dedupe(dirs: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
}

const SHELL_MARK: &str = "__BUMA_PATH__";

/// The PATH a login shell printed between two `SHELL_MARK` lines. Interactive shells may print
/// a greeting or warnings around it, so only what sits between the marks counts.
pub fn parse_shell_path(out: &str) -> Vec<PathBuf> {
    let mut parts = out.split(SHELL_MARK);
    let (Some(_), Some(path), Some(_)) = (parts.next(), parts.next(), parts.next()) else {
        return Vec::new();
    };
    std::env::split_paths(path.trim()).filter(|p| p.is_absolute()).collect()
}

/// Asks the user's login shell for its PATH, the one their terminal has. A GUI launch gets a
/// minimal PATH, so without this a node set up in .bashrc, .zshrc or config.fish (nvm, mise,
/// asdf, a custom prefix) is invisible to the app while `node --version` works in the terminal.
#[cfg(unix)]
fn read_shell_path() -> Vec<PathBuf> {
    use std::process::{Command, Stdio};
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
    // `echo` and `printenv` read the same in bash, zsh and fish; `-i` loads .bashrc/.zshrc where nvm lives.
    let script = format!("echo {SHELL_MARK}; printenv PATH; echo {SHELL_MARK}");
    let Ok(mut child) = Command::new(&shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    let Some(mut out) = child.stdout.take() else { return Vec::new() };
    // A shell rc that starts something long-lived keeps the pipe open, so read on a thread and
    // give up after the timeout instead of joining it.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        let _ = tx.send(s);
    });
    let got = rx.recv_timeout(EXEC_TIMEOUT).ok();
    let _ = child.kill();
    let _ = child.wait();
    got.map(|s| parse_shell_path(&s)).unwrap_or_default()
}

#[cfg(not(unix))]
fn read_shell_path() -> Vec<PathBuf> {
    Vec::new()
}

static SHELL_PATH: std::sync::RwLock<Option<Vec<PathBuf>>> = std::sync::RwLock::new(None);

/// The login shell's PATH, read once and kept. `refresh_shell_path` reads it again.
pub fn shell_path() -> Vec<PathBuf> {
    if let Some(p) = SHELL_PATH.read().ok().and_then(|g| g.clone()) {
        return p;
    }
    refresh_shell_path()
}

/// Reads the login shell's PATH again: after the user installs node in their terminal, the
/// next "Check again" sees it without restarting the app.
pub fn refresh_shell_path() -> Vec<PathBuf> {
    let p = read_shell_path();
    if let Ok(mut g) = SHELL_PATH.write() {
        *g = Some(p.clone());
    }
    p
}

/// Pure core of `augmented_path`: node's directory first, then the login shell's PATH, then the
/// usual install spots, then the existing PATH. Duplicates and empty entries are dropped, order is kept.
pub fn build_path(
    home: Option<&Path>,
    existing: Option<&std::ffi::OsStr>,
    node_dir: Option<&Path>,
    appdata: Option<&Path>,
    shell: &[PathBuf],
) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    dirs.extend(node_dir.map(Path::to_path_buf));
    dirs.extend(shell.iter().cloned());
    dirs.extend(tool_dirs(home, appdata));
    if let Some(p) = existing {
        dirs.extend(std::env::split_paths(p));
    }
    dedupe(&mut dirs);
    std::env::join_paths(dirs).unwrap_or_else(|_| existing.map(Into::into).unwrap_or_default())
}

/// Pure core of `RealExec::which`'s search list: the login shell's PATH first, so the app finds the
/// same node the user's terminal runs (not an older /usr/bin/node), then the existing PATH, then `tool_dirs`.
pub fn search_dirs(
    home: Option<&Path>,
    existing: Option<&std::ffi::OsStr>,
    appdata: Option<&Path>,
    shell: &[PathBuf],
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = shell.to_vec();
    dirs.extend(existing.map(|p| std::env::split_paths(p).collect::<Vec<_>>()).unwrap_or_default());
    dirs.extend(tool_dirs(home, appdata));
    dedupe(&mut dirs);
    dirs
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// PATH for processes we spawn. A GUI launch has a minimal PATH, so scripts with
/// `#!/usr/bin/env node` (npx, gemini, opencode) would otherwise fail.
pub fn augmented_path() -> std::ffi::OsString {
    let node_dir = RealExec.which("node").and_then(|p| p.parent().map(Path::to_path_buf));
    let home = home_dir();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    build_path(
        home.as_deref(),
        std::env::var_os("PATH").as_deref(),
        node_dir.as_deref(),
        appdata.as_deref(),
        &shell_path(),
    )
}

/// Runs real processes with a 5 s timeout.
pub struct RealExec;

impl RealExec {
    fn search_dirs() -> Vec<PathBuf> {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
        search_dirs(home_dir().as_deref(), std::env::var_os("PATH").as_deref(), appdata.as_deref(), &shell_path())
    }
}

impl Exec for RealExec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String> {
        let resolved = self.which(program).unwrap_or_else(|| PathBuf::from(program));
        let mut cmd = std::process::Command::new(resolved);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .args(args)
            .env("PATH", augmented_path())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .ok()?;
        let mut out = child.stdout.take()?;
        let mut err = child.stderr.take()?;
        let t_out = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = out.read_to_string(&mut s);
            s
        });
        let t_err = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = err.read_to_string(&mut s);
            s
        });
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() >= EXEC_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => return None,
            }
        }
        let stdout = t_out.join().unwrap_or_default();
        let stderr = t_err.join().unwrap_or_default();
        Some(format!("{stdout}\n{stderr}").trim().to_string())
    }

    fn which(&self, program: &str) -> Option<PathBuf> {
        let pathext = std::env::var("PATHEXT").ok();
        let exts = candidate_exts(program, pathext.as_deref(), cfg!(windows));
        find_in(&Self::search_dirs(), program, &exts)
    }
}

/// Suffixes `which` tries, in order. On Windows the PATHEXT extensions come first: npm
/// ships an extension-less `npx` shell script next to `npx.cmd`, and CreateProcess can't
/// run the script (error 193). The bare name is tried last, or first when `program`
/// already ends with one of the extensions.
pub fn candidate_exts(program: &str, pathext: Option<&str>, windows: bool) -> Vec<String> {
    if !windows {
        return vec![String::new()];
    }
    let exts: Vec<String> = pathext
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| e.starts_with('.') && e.len() > 1)
        .collect();
    let lower = program.to_ascii_lowercase();
    if exts.iter().any(|e| lower.ends_with(e.as_str())) {
        std::iter::once(String::new()).chain(exts).collect()
    } else {
        exts.into_iter().chain(std::iter::once(String::new())).collect()
    }
}

/// First `<dir>/<program><ext>` that is a file, dirs in order, then exts in order.
pub fn find_in(dirs: &[PathBuf], program: &str, exts: &[String]) -> Option<PathBuf> {
    dirs.iter().find_map(|dir| {
        exts.iter().map(|ext| dir.join(format!("{program}{ext}"))).find(|c| c.is_file())
    })
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn build_path_orders_and_dedupes() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        std::fs::create_dir_all(h.join(".nvm/versions/node/v20.1.0/bin")).unwrap();
        let existing = std::env::join_paths(["/usr/bin", "/usr/local/bin", "/bin", "/usr/bin", "/x"]).unwrap();
        let out = build_path(Some(h), Some(&existing), Some(Path::new("/n/bin")), None, &[]);
        let got: Vec<PathBuf> = std::env::split_paths(&out).collect();
        let want: Vec<PathBuf> = [
            "/n/bin".into(),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            h.join(".local/bin"),
            h.join(".volta/bin"),
            h.join(".nvm/versions/node/v20.1.0/bin"),
            h.join(".claude/local"),
            h.join(".opencode/bin"),
            "/usr/bin".into(),
            "/bin".into(),
            "/x".into(),
        ]
        .into_iter()
        .collect();
        assert_eq!(got, want);
    }

    /// A fake home with nvm, fnm and volta installs: `which` must see them all, and pick
    /// nvm's highest version even when an older one was touched last.
    #[cfg(unix)]
    #[test]
    fn search_dirs_cover_node_managers() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        for v in ["v9.0.0", "v22.11.0", "v18.20.4"] {
            std::fs::create_dir_all(h.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(h.join(".nvm/versions/node/v9.0.0/bin/touch"), "").unwrap();
        std::fs::create_dir_all(h.join(".fnm/aliases/default/bin")).unwrap();
        std::fs::create_dir_all(h.join(".volta/bin")).unwrap();
        // A name no real machine has: the system folders in the list (a CI runner's /usr/local/bin has npx)
        // must not answer for it.
        std::fs::write(h.join(".volta/bin/buma-test-tool"), "").unwrap();

        let existing = std::env::join_paths(["/usr/bin"]).unwrap();
        let dirs = search_dirs(Some(h), Some(&existing), None, &[]);
        assert_eq!(dirs[0], PathBuf::from("/usr/bin"));
        assert!(dirs.contains(&h.join(".nvm/versions/node/v22.11.0/bin")));
        assert!(!dirs.contains(&h.join(".nvm/versions/node/v9.0.0/bin")));
        assert!(dirs.contains(&h.join(".fnm/aliases/default/bin")));
        assert!(dirs.contains(&h.join(".volta/bin")));
        // Same list as the PATH given to spawned processes.
        let path: Vec<PathBuf> = std::env::split_paths(&build_path(Some(h), Some(&existing), None, None, &[])).collect();
        for d in &dirs {
            assert!(path.contains(d), "{d:?} missing from PATH");
        }
        assert_eq!(find_in(&dirs, "buma-test-tool", &[String::new()]), Some(h.join(".volta/bin/buma-test-tool")));
    }

    #[test]
    fn windows_tries_pathext_before_the_bare_name() {
        let exts = candidate_exts("npx", Some(".EXE;.CMD;.BAT"), true);
        assert_eq!(exts, [".exe", ".cmd", ".bat", ""]);
        assert_eq!(candidate_exts("npx.cmd", Some(".EXE;.CMD"), true), ["", ".exe", ".cmd"]);
        assert_eq!(candidate_exts("npx", None, true).last().map(String::as_str), Some(""));
        assert_eq!(candidate_exts("npx", Some(".EXE"), false), [""]);

        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("npx"), "#!/bin/sh").unwrap();
        std::fs::write(tmp.path().join("npx.cmd"), "@echo off").unwrap();
        let dirs = [tmp.path().to_path_buf()];
        assert_eq!(find_in(&dirs, "npx", &exts), Some(tmp.path().join("npx.cmd")));
        assert_eq!(find_in(&dirs, "npx", &candidate_exts("npx", None, false)), Some(tmp.path().join("npx")));
    }

    #[cfg(windows)]
    #[test]
    fn real_which_prefers_npx_cmd() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("npx"), "#!/bin/sh").unwrap();
        std::fs::write(tmp.path().join("npx.cmd"), "@echo off").unwrap();
        let pathext = std::env::var("PATHEXT").ok();
        let exts = candidate_exts("npx", pathext.as_deref(), true);
        let found = find_in(&[tmp.path().to_path_buf()], "npx", &exts).unwrap();
        assert!(found.to_string_lossy().to_ascii_lowercase().ends_with("npx.cmd"));
    }

    #[test]
    fn registry_paths_expand_env_vars() {
        let lookup = |n: &str| match n {
            "USERPROFILE" => Some(r"C:\Users\a".to_string()),
            "SystemRoot" => Some(r"C:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(
            expand_env_vars(r"%SystemRoot%\system32;%USERPROFILE%\AppData\Local\Microsoft\WinGet\Links", lookup),
            r"C:\Windows\system32;C:\Users\a\AppData\Local\Microsoft\WinGet\Links"
        );
        assert_eq!(expand_env_vars("%NOPE%\\x", lookup), "%NOPE%\\x");
        assert_eq!(expand_env_vars("100% sure", lookup), "100% sure");
        assert_eq!(expand_env_vars("a%%b", lookup), "a%%b");
    }

    #[test]
    fn semver_orders_numerically() {
        assert!(semver_key("v22.1.0") > semver_key("v9.12.0"));
        assert!(semver_key("v22.11.0") > semver_key("v22.2.9"));
        assert_eq!(semver_key("junk"), (0, 0, 0));
    }

    /// fish users usually have nvm.fish (~/.local/share/nvm), others mise or asdf shims.
    #[cfg(unix)]
    #[test]
    fn search_dirs_cover_fish_nvm_and_shims() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        for v in ["v20.6.1", "v22.12.0"] {
            std::fs::create_dir_all(h.join(".local/share/nvm").join(v).join("bin")).unwrap();
        }
        std::fs::create_dir_all(h.join(".local/share/mise/shims")).unwrap();
        std::fs::create_dir_all(h.join(".asdf/shims")).unwrap();
        let dirs = search_dirs(Some(h), None, None, &[]);
        assert!(dirs.contains(&h.join(".local/share/nvm/v22.12.0/bin")));
        assert!(!dirs.contains(&h.join(".local/share/nvm/v20.6.1/bin")));
        assert!(dirs.contains(&h.join(".local/share/mise/shims")));
        assert!(dirs.contains(&h.join(".asdf/shims")));
        assert!(!dirs.contains(&h.join(".nodenv/shims")));
    }

    /// The terminal's PATH wins over the GUI's: a newer node there beats an old /usr/bin/node.
    #[cfg(unix)]
    #[test]
    fn shell_path_comes_first() {
        let shell = vec![PathBuf::from("/home/a/.local/share/nvm/v22.12.0/bin"), PathBuf::from("/usr/bin")];
        let existing = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let dirs = search_dirs(None, Some(&existing), None, &shell);
        assert_eq!(&dirs[..3], [shell[0].clone(), "/usr/bin".into(), "/bin".into()]);
        let path: Vec<PathBuf> =
            std::env::split_paths(&build_path(None, Some(&existing), Some(Path::new("/n/bin")), None, &shell)).collect();
        assert_eq!(&path[..2], ["/n/bin".into(), shell[0].clone()]);
    }

    #[cfg(unix)]
    #[test]
    fn parse_shell_path_reads_between_marks() {
        let out = "Welcome to fish\n__BUMA_PATH__\n/home/a/.local/share/nvm/v22.12.0/bin:/usr/bin:relative\n__BUMA_PATH__\nbye";
        assert_eq!(parse_shell_path(out), [PathBuf::from("/home/a/.local/share/nvm/v22.12.0/bin"), PathBuf::from("/usr/bin")]);
        assert!(parse_shell_path("no marks here").is_empty());
        assert!(parse_shell_path("__BUMA_PATH__\n/usr/bin").is_empty());
    }

    #[test]
    fn build_path_without_inputs_keeps_existing() {
        let existing = std::env::join_paths(["/a", "/b"]).unwrap();
        let out = build_path(None, Some(&existing), None, None, &[]);
        let got: Vec<PathBuf> = std::env::split_paths(&out).collect();
        assert!(got.ends_with(&[PathBuf::from("/a"), PathBuf::from("/b")]));
    }
}
