//! Detects the OS, installed AI agents and the tools video rendering needs.

use crate::types::*;
use std::path::{Path, PathBuf};

pub trait Exec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String>;
    fn which(&self, program: &str) -> Option<PathBuf>;
}

use std::io::Read;
use std::time::{Duration, Instant};

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

/// Where Node, npx, agents and the render tools usually live, beyond PATH. Both the PATH
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
        // System dirs last, so user-space installs (a newer node in nvm, ffmpeg in ~/.local/bin) win.
        dirs.push(PathBuf::from("/usr/bin"));
        dirs.push(PathBuf::from("/bin"));
    }
    if cfg!(windows) {
        dirs.extend(appdata.map(|a| a.join("npm")));
        // winget puts portable tools (ffmpeg, yt-dlp) behind links here.
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
/// `#!/usr/bin/env node` (npx, gemini, hyperframes) would otherwise fail.
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

/// First `\d+(\.\d+)+` match in `raw`.
pub fn parse_version(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i;
        let mut groups = 1;
        loop {
            while end < b.len() && b[end].is_ascii_digit() {
                end += 1;
            }
            if end + 1 < b.len() && b[end] == b'.' && b[end + 1].is_ascii_digit() {
                groups += 1;
                end += 1;
            } else {
                break;
            }
        }
        if groups > 1 {
            return Some(raw[start..end].to_string());
        }
        i = end;
    }
    None
}

fn os_kind() -> OsKind {
    if cfg!(target_os = "macos") {
        OsKind::Macos
    } else if cfg!(target_os = "windows") {
        OsKind::Windows
    } else {
        OsKind::Linux
    }
}

fn os_version(exec: &dyn Exec, os: OsKind) -> String {
    match os {
        OsKind::Macos => exec
            .run("sw_vers", &["-productVersion"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        OsKind::Windows => exec
            .run("cmd", &["/c", "ver"])
            .and_then(|s| parse_version(&s))
            .unwrap_or_default(),
        OsKind::Linux => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                let get = |key: &str| {
                    text.lines().find_map(|l| {
                        l.strip_prefix(key)
                            .and_then(|v| v.strip_prefix('='))
                            .map(|v| v.trim().trim_matches('"').to_string())
                    })
                };
                get("PRETTY_NAME").or_else(|| get("VERSION_ID"))
            })
            .unwrap_or_default(),
    }
}

pub fn system_info(exec: &dyn Exec) -> SystemInfo {
    let os = os_kind();
    let managers: &[(&str, PackageManager)] = match os {
        OsKind::Macos => &[("brew", PackageManager::Brew)],
        OsKind::Windows => &[("winget", PackageManager::Winget)],
        OsKind::Linux => &[
            ("apt", PackageManager::Apt),
            ("dnf", PackageManager::Dnf),
            ("pacman", PackageManager::Pacman),
        ],
    };
    let package_manager = managers
        .iter()
        .find(|(bin, _)| exec.which(bin).is_some())
        .map(|(_, pm)| *pm);
    SystemInfo { os, os_version: os_version(exec, os), package_manager }
}

type AgentDef = (AgentId, &'static str, &'static str, &'static [&'static str]);

const AGENT_DEFS: [AgentDef; 6] = [
    (
        AgentId::Claude,
        "Claude Code",
        "claude",
        &["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    ),
    (AgentId::Opencode, "OpenCode", "opencode", &["opencode", "acp"]),
    (AgentId::Gemini, "Gemini CLI", "gemini", &["gemini", "--experimental-acp"]),
    (AgentId::Codex, "Codex", "codex", &["npx", "-y", "@zed-industries/codex-acp"]),
    // Antigravity CLI speaks ACP itself since 1.5.0; its installer puts `agy` in ~/.local/bin.
    (AgentId::Antigravity, "Antigravity CLI", "agy", &["agy", "acp"]),
    // Cursor CLI speaks ACP (`cursor-agent acp`, sign-in `cursor_login`); its installer puts it in ~/.local/bin.
    (AgentId::Cursor, "Cursor", "cursor-agent", &["cursor-agent", "acp"]),
];

/// The command that starts this agent in ACP mode; `None` for `custom`.
pub fn acp_command(id: AgentId) -> Option<Vec<String>> {
    AGENT_DEFS
        .iter()
        .find(|d| d.0 == id)
        .map(|d| d.3.iter().map(|s| s.to_string()).collect())
}

/// The file name of the CLI that OpenCode Desktop bundles.
fn opencode_cli_name() -> &'static str {
    if cfg!(windows) {
        "opencode-cli.exe"
    } else {
        "opencode-cli"
    }
}

/// The CLI next to an OpenCode Desktop executable: `resources/` in the Electron app, the same
/// folder in the older Tauri one.
fn bundled_opencode_cli(app_dir: &Path) -> Option<PathBuf> {
    [app_dir.join("resources"), app_dir.to_path_buf()]
        .into_iter()
        .map(|d| d.join(opencode_cli_name()))
        .find(|p| p.is_file())
}

/// Where OpenCode Desktop installs: its CLI is used when there's no `opencode` CLI of its own.
pub fn opencode_desktop_dirs(home: Option<&Path>, local_appdata: Option<&Path>, program_files: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        if let Some(l) = local_appdata {
            for name in ["ai.opencode.desktop", "ai.opencode.desktop.beta", "@opencodedesktop", "OpenCode"] {
                dirs.push(l.join("Programs").join(name));
            }
            dirs.push(l.join("OpenCode"));
        }
        dirs.extend(program_files.map(|p| p.join("OpenCode")));
    } else if cfg!(target_os = "macos") {
        let app = Path::new("OpenCode.app").join("Contents");
        dirs.push(Path::new("/Applications").join(&app).join("Resources"));
        dirs.push(Path::new("/Applications").join(&app).join("MacOS"));
        if let Some(h) = home {
            dirs.push(h.join("Applications").join(&app).join("Resources"));
            dirs.push(h.join("Applications").join(&app).join("MacOS"));
        }
    }
    dirs
}

/// The OpenCode to run: what `which` found, unless that's OpenCode Desktop's app (on Windows
/// `opencode` also matches `OpenCode.exe`), which can't speak ACP, then the CLI it bundles. With
/// no `opencode` at all, OpenCode Desktop's CLI.
pub fn opencode_program(found: Option<PathBuf>, desktop_dirs: &[PathBuf]) -> Option<PathBuf> {
    if let Some(found) = found {
        let is_cli = found.file_stem().is_some_and(|s| s.eq_ignore_ascii_case("opencode-cli"));
        let bundled = if is_cli { None } else { found.parent().and_then(bundled_opencode_cli) };
        return Some(bundled.unwrap_or(found));
    }
    desktop_dirs.iter().find_map(|d| bundled_opencode_cli(d))
}

/// The program that starts this agent's ACP command (`acp_command(id)[0]`), found on this computer.
pub fn agent_program(exec: &dyn Exec, id: AgentId) -> Option<PathBuf> {
    let program = acp_command(id)?.into_iter().next()?;
    let found = exec.which(&program);
    if id != AgentId::Opencode {
        return found;
    }
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    opencode_program(found, &opencode_desktop_dirs(home_dir().as_deref(), env("LOCALAPPDATA").as_deref(), env("ProgramFiles").as_deref()))
}

/// Where each agent's CLI keeps its sign-in, under the home folder: Codex's `auth.json` (ChatGPT or
/// API key), Gemini's Google OAuth credentials, opencode's provider keys, Antigravity's Google sign-in.
pub fn credential_files(agent: AgentId, home: &Path) -> Vec<PathBuf> {
    match agent {
        AgentId::Codex => vec![home.join(".codex/auth.json")],
        AgentId::Gemini => vec![home.join(".gemini/oauth_creds.json"), home.join(".gemini/gemini-credentials.json")],
        AgentId::Opencode => vec![home.join(".local/share/opencode/auth.json")],
        AgentId::Antigravity => vec![home.join(".antigravity/credentials.json"), home.join(".gemini/antigravity/oauth_creds.json")],
        AgentId::Cursor => vec![home.join(".cursor/cli-config.json")],
        _ => Vec::new(),
    }
}

/// The claims of a JWT (its middle part), without checking the signature: it is only read to show who
/// signed in, from the user's own credentials file.
fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn email_of_token(token: Option<&serde_json::Value>) -> Option<String> {
    let claims = jwt_claims(token?.as_str()?)?;
    claims.get("email").and_then(|v| v.as_str()).map(str::to_string)
}

/// The credentials files of an extra account, inside its own folder (what `CODEX_HOME` /
/// `XDG_DATA_HOME` point at).
pub fn account_files_in(agent: AgentId, dir: &Path) -> Vec<PathBuf> {
    match agent {
        AgentId::Codex => vec![dir.join("auth.json")],
        AgentId::Opencode => vec![dir.join("opencode/auth.json")],
        _ => Vec::new(),
    }
}

/// Who an extra account is signed in as, from the credentials in its own folder.
pub fn account_in(agent: AgentId, dir: &Path) -> Option<String> {
    let read = |p: &Path| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let v = read(account_files_in(agent, dir).first()?)?;
    match agent {
        AgentId::Codex => email_of_token(v.pointer("/tokens/id_token"))
            .or_else(|| v.get("OPENAI_API_KEY").and_then(|k| k.as_str()).filter(|k| !k.is_empty()).map(|_| "API key".to_string())),
        AgentId::Opencode => {
            let names: Vec<&str> = v.as_object()?.keys().map(String::as_str).collect();
            (!names.is_empty()).then(|| names.join(", "))
        }
        _ => None,
    }
}

/// Who an agent is signed in as, read from its credentials file: Codex's ChatGPT email (or "API key"),
/// Gemini's Google email, opencode's providers. None when nothing is saved or nothing says who.
pub fn agent_account(agent: AgentId, home: &Path) -> Option<String> {
    let read = |rel: &str| std::fs::read_to_string(home.join(rel)).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    match agent {
        AgentId::Codex => {
            let v = read(".codex/auth.json")?;
            email_of_token(v.pointer("/tokens/id_token")).or_else(|| {
                v.get("OPENAI_API_KEY").and_then(|k| k.as_str()).filter(|k| !k.is_empty()).map(|_| "API key".to_string())
            })
        }
        AgentId::Gemini => read(".gemini/google_accounts.json")
            .and_then(|v| v.get("active").and_then(|a| a.as_str()).map(str::to_string))
            .or_else(|| email_of_token(read(".gemini/oauth_creds.json")?.get("id_token"))),
        AgentId::Cursor => read(".cursor/cli-config.json")?.pointer("/authInfo/email").and_then(|e| e.as_str()).map(str::to_string),
        AgentId::Opencode => {
            let v = read(".local/share/opencode/auth.json")?;
            let names: Vec<&str> = v.as_object()?.keys().map(String::as_str).collect();
            (!names.is_empty()).then(|| names.join(", "))
        }
        _ => None,
    }
}

pub fn detect_agents(exec: &dyn Exec) -> Vec<AgentInfo> {
    let defs = AGENT_DEFS;
    defs.iter()
        .map(|(id, name, bin, acp)| {
            // OpenCode Desktop counts: its bundled CLI is what runs.
            let program = if *id == AgentId::Opencode { agent_program(exec, *id) } else { exec.which(bin) };
            // Agents that run through `npx` (Claude, Codex) need no CLI of their own: Node is enough.
            let installed = if acp.first() == Some(&"npx") { exec.which("npx").is_some() } else { program.is_some() };
            let version = match &program {
                Some(p) if *id == AgentId::Opencode => exec.run(&p.to_string_lossy(), &["--version"]),
                Some(_) => exec.run(bin, &["--version"]),
                None => None,
            }
            .and_then(|s| parse_version(&s));
            AgentInfo {
                id: *id,
                name: name.to_string(),
                installed,
                version,
                acp_command: acp.iter().map(|s| s.to_string()).collect(),
                recommended: *id == AgentId::Claude,
                signed_in: home_dir().is_some_and(|h| credential_files(*id, &h).iter().any(|f| f.is_file())),
                account: home_dir().and_then(|h| agent_account(*id, &h)),
            }
        })
        .collect()
}

/// Whether an app is installed: macOS looks in /Applications, Windows under Program Files and the
/// user's AppData. Linux has no desktop Figma or Word.
fn app_installed(os: OsKind, mac_app: &str, windows_rel: &[&str]) -> bool {
    match os {
        OsKind::Macos => {
            Path::new("/Applications").join(mac_app).exists()
                || home_dir().is_some_and(|h| h.join("Applications").join(mac_app).exists())
        }
        OsKind::Windows => ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
            .iter()
            .filter_map(std::env::var_os)
            .any(|base| windows_rel.iter().any(|rel| PathBuf::from(&base).join(rel).exists())),
        OsKind::Linux => false,
    }
}

/// The MCP config files an agent reads, in the order it reads them. Claude is Buma's own config folder
/// (`CLAUDE_CONFIG_DIR`); the others use their CLI's usual files.
pub fn mcp_config_files(agent: AgentId, claude_dir: Option<&Path>) -> Vec<PathBuf> {
    let home = home_dir().unwrap_or_default();
    match agent {
        AgentId::Claude => claude_dir.map(|d| vec![d.join(".claude.json"), d.join("settings.json")]).unwrap_or_default(),
        AgentId::Codex => vec![home.join(".codex").join("config.toml")],
        AgentId::Gemini => vec![home.join(".gemini").join("settings.json")],
        AgentId::Antigravity => vec![home.join(".gemini").join("antigravity").join("mcp_config.json")],
        AgentId::Cursor => vec![home.join(".cursor").join("mcp.json")],
        AgentId::Opencode | AgentId::Custom => vec![
            home.join(".config").join("opencode").join("opencode.json"),
            home.join(".config").join("opencode").join("opencode.jsonc"),
        ],
    }
}

/// Whether any of the agent's MCP config files names a Figma server (`mcp.figma.com`, the desktop
/// server on 127.0.0.1:3845, or a server called figma).
pub fn figma_mcp_configured(files: &[PathBuf]) -> bool {
    files.iter().filter_map(|f| std::fs::read_to_string(f).ok()).any(|text| {
        let t = text.to_lowercase();
        t.contains("mcp.figma.com") || t.contains("127.0.0.1:3845") || t.contains("\"figma\"") || t.contains("mcp_servers.figma")
    })
}

/// The tools the BSpace SDLC skills need. `mcp_files` are the default agent's MCP config files.
pub fn check_tools(exec: &dyn Exec, mcp_files: &[PathBuf]) -> Vec<ToolStatus> {
    let version_of = |bin: &str, arg: &str| -> Option<String> {
        exec.which(bin)?;
        exec.run(bin, &[arg]).and_then(|s| parse_version(&s))
    };
    let os = os_kind();

    let node_found = exec.which("node").is_some();
    let node_version = version_of("node", "--version");
    let node_major = node_version
        .as_deref()
        .and_then(|v| v.split('.').next())
        .and_then(|m| m.parse::<u32>().ok());
    let node = ToolStatus {
        id: ToolId::Node,
        name: "Node.js".into(),
        required: true,
        found: node_found,
        version: node_version,
        // buma-cli declares node >= 20; Claude Code and the ACP adapters need 18 or newer.
        ok: node_major.is_some_and(|m| m >= 20),
        detail: "Runs the agent adapters and buma-cli · needs 20 or newer".into(),
    };

    let git_version = version_of("git", "--version");
    let git = ToolStatus {
        id: ToolId::Git,
        name: "Git".into(),
        required: true,
        found: exec.which("git").is_some(),
        ok: exec.which("git").is_some(),
        version: git_version,
        detail: "Clones the project and the BUMA Design System packages".into(),
    };

    // python3 everywhere; Windows installs often only have `python` or the `py` launcher.
    let python_bin = ["python3", "python", "py"].into_iter().find(|b| {
        exec.which(b).is_some() && exec.run(b, &["--version"]).is_some_and(|v| v.contains("Python 3"))
    });
    let python = ToolStatus {
        id: ToolId::Python,
        name: "Python 3".into(),
        required: true,
        found: python_bin.is_some(),
        ok: python_bin.is_some(),
        version: python_bin.and_then(|b| version_of(b, "--version")),
        detail: "Runs the skills' gate checks (Blueprint, FTSD, wireframe, fidelity)".into(),
    };

    let figma_mcp_ok = figma_mcp_configured(mcp_files);
    let figma_mcp = ToolStatus {
        id: ToolId::FigmaMcp,
        name: "Figma MCP".into(),
        required: true,
        found: figma_mcp_ok,
        ok: figma_mcp_ok,
        version: None,
        detail: "Lets the agent read and draw Figma designs with the BUMA Design System".into(),
    };

    let figma_ok = app_installed(os, "Figma.app", &[r"Figma\Figma.exe", r"Figma\app\Figma.exe"]);
    let figma = ToolStatus {
        id: ToolId::Figma,
        name: "Figma".into(),
        required: false,
        found: figma_ok,
        ok: figma_ok,
        version: None,
        detail: "Review the designs and prototypes the agent makes".into(),
    };

    let flutter_bin = ["flutter", "fvm"].into_iter().find(|b| exec.which(b).is_some());
    let flutter = ToolStatus {
        id: ToolId::Flutter,
        name: "Flutter SDK".into(),
        required: false,
        found: flutter_bin.is_some(),
        ok: flutter_bin.is_some(),
        version: version_of("flutter", "--version"),
        detail: "Slices and runs Flutter screens · BUMA pins 3.27.4 with fvm".into(),
    };

    let word_ok = app_installed(
        os,
        "Microsoft Word.app",
        &[r"Microsoft Office\root\Office16\WINWORD.EXE", r"Microsoft Office\Office16\WINWORD.EXE"],
    );
    let word = ToolStatus {
        id: ToolId::Word,
        name: "Microsoft Word".into(),
        required: false,
        found: word_ok,
        ok: word_ok,
        version: None,
        detail: "Edit and sign off the Blueprint and FTSD documents".into(),
    };

    let az_found = exec.which("az").is_some();
    let azure_cli = ToolStatus {
        id: ToolId::AzureCli,
        name: "Azure CLI".into(),
        required: false,
        found: az_found,
        ok: az_found,
        version: if az_found { exec.run("az", &["version", "--query", "\"azure-cli\"", "-o", "tsv"]).and_then(|s| parse_version(&s)) } else { None },
        detail: "Sign in to Azure DevOps with your Microsoft account".into(),
    };

    vec![node, git, python, figma_mcp, azure_cli, figma, flutter, word]
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeExec {
        out: HashMap<String, String>,
    }
    impl FakeExec {
        fn with(mut self, prog: &str, out: &str) -> Self {
            self.out.insert(prog.to_string(), out.to_string());
            self
        }
    }
    impl Exec for FakeExec {
        fn run(&self, program: &str, _args: &[&str]) -> Option<String> {
            let name = Path::new(program).file_name().map(|n| n.to_string_lossy().into_owned());
            self.out.get(program).or_else(|| self.out.get(name.as_deref()?)).cloned()
        }
        fn which(&self, program: &str) -> Option<PathBuf> {
            self.out.get(program).map(|_| PathBuf::from(format!("/bin/{program}")))
        }
    }

    #[test]
    fn parse_version_cases() {
        assert_eq!(parse_version("v22.12.0").as_deref(), Some("22.12.0"));
        assert_eq!(parse_version("ffmpeg version n7.1-tessus").as_deref(), Some("7.1"));
        assert_eq!(
            parse_version("ffmpeg version 7.1.1-full_build-www.gyan.dev").as_deref(),
            Some("7.1.1")
        );
        assert_eq!(parse_version("2026.10.22").as_deref(), Some("2026.10.22"));
        assert_eq!(parse_version("nope"), None);
        assert_eq!(parse_version("build 7 then 1.2"), Some("1.2".to_string()));
    }

    fn tool(list: &[ToolStatus], id: ToolId) -> &ToolStatus {
        list.iter().find(|t| t.id == id).unwrap()
    }

    #[test]
    fn old_node_is_not_ok() {
        let ex = FakeExec::default().with("node", "v18.19.0");
        let t = check_tools(&ex, &[]);
        let n = tool(&t, ToolId::Node);
        assert!(n.found && !n.ok && n.required);
        assert_eq!(n.version.as_deref(), Some("18.19.0"));
    }

    #[test]
    fn new_node_is_ok() {
        let ex = FakeExec::default().with("node", "v20.20.2");
        let t = check_tools(&ex, &[]);
        assert!(tool(&t, ToolId::Node).ok);
    }

    #[test]
    fn sdlc_tools_required_and_recommended() {
        let ex = FakeExec::default().with("git", "git version 2.47.1").with("python3", "Python 3.12.4");
        let t = check_tools(&ex, &[]);
        assert_eq!(t.len(), 8);
        assert!(!tool(&t, ToolId::AzureCli).required);
        let git = tool(&t, ToolId::Git);
        assert!(git.ok && git.required);
        assert_eq!(git.version.as_deref(), Some("2.47.1"));
        let py = tool(&t, ToolId::Python);
        assert!(py.ok && py.required);
        assert_eq!(py.version.as_deref(), Some("3.12.4"));
        let mcp = tool(&t, ToolId::FigmaMcp);
        assert!(!mcp.ok && mcp.required);
        assert!(!tool(&t, ToolId::Flutter).required && !tool(&t, ToolId::Flutter).found);
        assert!(!tool(&t, ToolId::Word).required);
    }

    #[test]
    fn python_2_does_not_count() {
        let ex = FakeExec::default().with("python", "Python 2.7.18");
        assert!(!tool(&check_tools(&ex, &[]), ToolId::Python).found);
    }

    #[test]
    fn figma_mcp_is_found_in_the_agent_config() {
        let tmp = tempfile::tempdir().unwrap();
        let claude = tmp.path().join(".claude.json");
        std::fs::write(&claude, r#"{"mcpServers":{"other":{"type":"http","url":"https://example.com"}}}"#).unwrap();
        assert!(!figma_mcp_configured(&[claude.clone()]));
        std::fs::write(&claude, r#"{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"}}}"#).unwrap();
        assert!(figma_mcp_configured(&[claude.clone()]));
        let codex = tmp.path().join("config.toml");
        std::fs::write(&codex, "[mcp_servers.figma]\nurl = \"https://mcp.figma.com/mcp\"\n").unwrap();
        assert!(figma_mcp_configured(&[tmp.path().join("missing.json"), codex]));
        let ex = FakeExec::default();
        assert!(tool(&check_tools(&ex, &[claude]), ToolId::FigmaMcp).ok);
    }

    #[test]
    fn opencode_desktop_runs_the_cli_it_bundles() {
        let tmp = tempfile::tempdir().unwrap();
        let cli = opencode_cli_name();
        // The Electron app: OpenCode.exe, resources/opencode-cli.exe.
        let electron = tmp.path().join("ai.opencode.desktop");
        std::fs::create_dir_all(electron.join("resources")).unwrap();
        std::fs::write(electron.join("OpenCode.exe"), "").unwrap();
        std::fs::write(electron.join("resources").join(cli), "").unwrap();
        // The older Tauri app: opencode-cli.exe next to OpenCode.exe.
        let tauri = tmp.path().join("OpenCode");
        std::fs::create_dir_all(&tauri).unwrap();
        std::fs::write(tauri.join("OpenCode.exe"), "").unwrap();
        std::fs::write(tauri.join(cli), "").unwrap();
        let npm = tmp.path().join("npm").join("opencode.cmd");

        // `which` found the desktop app, not a CLI: run the CLI it bundles.
        assert_eq!(opencode_program(Some(electron.join("OpenCode.exe")), &[]), Some(electron.join("resources").join(cli)));
        assert_eq!(opencode_program(Some(tauri.join("OpenCode.exe")), &[]), Some(tauri.join(cli)));
        // A real CLI stays.
        assert_eq!(opencode_program(Some(npm.clone()), std::slice::from_ref(&electron)), Some(npm));
        // No CLI on PATH: the desktop app's.
        let missing = tmp.path().join("nothing");
        assert_eq!(opencode_program(None, &[missing.clone(), tauri.clone()]), Some(tauri.join(cli)));
        assert_eq!(opencode_program(None, &[missing]), None);
    }

    #[test]
    fn detect_agents_only_claude() {
        // Node (npx) but no Claude Code CLI: Claude and Codex still run (through npx); the rest need their CLI.
        let ex = FakeExec::default().with("npx", "10.9.0");
        let a = detect_agents(&ex);
        let ids: Vec<_> = a.iter().map(|x| x.id).collect();
        assert_eq!(ids, [AgentId::Claude, AgentId::Opencode, AgentId::Gemini, AgentId::Codex, AgentId::Antigravity, AgentId::Cursor]);
        assert!(a[0].installed && a[0].recommended && a[0].version.is_none());
        assert_eq!(a[0].acp_command, ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]);
        assert!(a[3].installed, "Codex runs through npx");
        assert!(!a[1].installed && !a[2].installed && !a[4].installed);
        assert_eq!(a[2].acp_command, ["gemini", "--experimental-acp"]);
    }

    #[test]
    fn npx_agents_show_their_cli_version_when_it_is_there() {
        let ex = FakeExec::default().with("npx", "10.9.0").with("claude", "2.1.3 (Claude Code)");
        let a = detect_agents(&ex);
        assert_eq!(a[0].version.as_deref(), Some("2.1.3"));
        // Without Node, nothing that runs through npx can start.
        let none = detect_agents(&FakeExec::default().with("claude", "2.1.3 (Claude Code)"));
        assert!(!none[0].installed && !none[3].installed);
    }

    #[test]
    fn reads_who_is_signed_in_from_credential_files() {
        use base64::Engine;
        let jwt = |claims: &str| format!("h.{}.s", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims));
        let dir = tempfile::tempdir().unwrap();
        let h = dir.path();
        std::fs::create_dir_all(h.join(".codex")).unwrap();
        std::fs::create_dir_all(h.join(".gemini")).unwrap();
        std::fs::create_dir_all(h.join(".local/share/opencode")).unwrap();
        std::fs::write(h.join(".codex/auth.json"), format!(r#"{{"tokens":{{"id_token":"{}"}}}}"#, jwt(r#"{"email":"rama@buma.co.id"}"#))).unwrap();
        assert_eq!(agent_account(AgentId::Codex, h).as_deref(), Some("rama@buma.co.id"));
        // An API key only: it says so, never the key.
        std::fs::write(h.join(".codex/auth.json"), r#"{"OPENAI_API_KEY":"sk-secret"}"#).unwrap();
        assert_eq!(agent_account(AgentId::Codex, h).as_deref(), Some("API key"));
        std::fs::write(h.join(".gemini/oauth_creds.json"), format!(r#"{{"id_token":"{}"}}"#, jwt(r#"{"email":"g@buma.co.id"}"#))).unwrap();
        assert_eq!(agent_account(AgentId::Gemini, h).as_deref(), Some("g@buma.co.id"));
        std::fs::write(h.join(".gemini/google_accounts.json"), r#"{"active":"active@buma.co.id","old":[]}"#).unwrap();
        assert_eq!(agent_account(AgentId::Gemini, h).as_deref(), Some("active@buma.co.id"));
        std::fs::write(h.join(".local/share/opencode/auth.json"), r#"{"anthropic":{"key":"k"},"openai":{"key":"k"}}"#).unwrap();
        assert_eq!(agent_account(AgentId::Opencode, h).as_deref(), Some("anthropic, openai"));
        assert_eq!(agent_account(AgentId::Antigravity, h), None);
    }

    #[test]
    fn detect_cursor_cli() {
        let ex = FakeExec::default().with("cursor-agent", "2026.01.1");
        let a = detect_agents(&ex);
        let c = a.iter().find(|x| x.id == AgentId::Cursor).unwrap();
        assert!(c.installed);
        assert_eq!(c.name, "Cursor");
        assert_eq!(acp_command(AgentId::Cursor).unwrap(), ["cursor-agent", "acp"]);
    }

    #[test]
    fn detect_antigravity_cli() {
        let ex = FakeExec::default().with("agy", "1.5.3");
        let a = detect_agents(&ex);
        let agy = a.iter().find(|x| x.id == AgentId::Antigravity).unwrap();
        assert!(agy.installed && !agy.recommended);
        assert_eq!(agy.name, "Antigravity CLI");
        assert_eq!(agy.version.as_deref(), Some("1.5.3"));
        assert_eq!(agy.acp_command, ["agy", "acp"]);
        assert_eq!(acp_command(AgentId::Antigravity).unwrap(), ["agy", "acp"]);
    }

    #[test]
    fn package_manager_first_found() {
        let ex = FakeExec::default().with("brew", "x").with("dnf", "x").with("apt", "x");
        let s = system_info(&ex);
        if cfg!(target_os = "linux") {
            assert_eq!(s.package_manager, Some(PackageManager::Apt));
        } else if cfg!(target_os = "macos") {
            assert_eq!(s.package_manager, Some(PackageManager::Brew));
        }
    }
}
