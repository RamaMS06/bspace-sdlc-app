//! Which coding agents are installed, how to start each in ACP mode, and who is signed in to them.

use crate::domain::environment::parse_version;
use crate::infra::exec::{home_dir, Exec};
use crate::types::*;
use std::path::{Path, PathBuf};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::FakeExec;

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
}
