//! Several accounts per AI platform (Settings › Agents › Provider). Each extra account is its own
//! folder under `<app data>/accounts/<id>`, handed to the agent through the environment variable it
//! keeps its sign-in under: Claude's `CLAUDE_CONFIG_DIR`, Codex's `CODEX_HOME`, opencode's
//! `XDG_DATA_HOME`. The default account (`default`) is where each agent signs in on its own (Claude:
//! Buma's `<app data>/claude`). One account per agent is active: new sessions start on it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::types::AgentId;

pub const DEFAULT: &str = "default";

/// Agents whose sign-in can live in a folder of Buma's choosing.
pub fn supports_accounts(agent: AgentId) -> bool {
    matches!(agent, AgentId::Claude | AgentId::Codex | AgentId::Opencode)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Extra {
    pub id: String,
    pub agent: AgentId,
}

/// `accounts.json`: the extra accounts, and the active one per agent (key: the agent's key).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountsFile {
    #[serde(default)]
    pub extra: Vec<Extra>,
    #[serde(default)]
    pub active: HashMap<String, String>,
}

pub fn file(app_data: &Path) -> PathBuf {
    app_data.join("accounts.json")
}

pub fn load(app_data: &Path) -> AccountsFile {
    std::fs::read_to_string(file(app_data)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(app_data: &Path, f: &AccountsFile) -> std::io::Result<()> {
    std::fs::write(file(app_data), serde_json::to_string_pretty(f).unwrap_or_default())
}

/// An extra account's own folder.
pub fn extra_dir(app_data: &Path, id: &str) -> PathBuf {
    app_data.join("accounts").join(id)
}

/// The folder an account keeps its sign-in in: None for the default account of an agent that signs
/// in where it always does (Codex's `~/.codex`, opencode's data folder).
pub fn dir(app_data: &Path, agent: AgentId, id: &str) -> Option<PathBuf> {
    if id == DEFAULT {
        return (agent == AgentId::Claude).then(|| crate::claude_account::config_dir(app_data));
    }
    Some(extra_dir(app_data, id))
}

/// The environment variable that points an agent at an account's folder.
pub fn env_for(agent: AgentId, dir: &Path) -> Vec<(String, String)> {
    let var = match agent {
        AgentId::Claude => crate::claude_account::CONFIG_ENV,
        AgentId::Codex => "CODEX_HOME",
        AgentId::Opencode => "XDG_DATA_HOME",
        _ => return Vec::new(),
    };
    vec![(var.to_string(), dir.to_string_lossy().into_owned())]
}

/// The active account of an agent (`default` when none was picked or it was removed).
pub fn active(f: &AccountsFile, agent: AgentId, key: &str) -> String {
    match f.active.get(key) {
        Some(id) if id == DEFAULT || f.extra.iter().any(|e| &e.id == id && e.agent == agent) => id.clone(),
        _ => DEFAULT.to_string(),
    }
}

/// Adds an extra account for an agent; its folder is made. Returns its id.
pub fn add(app_data: &Path, agent: AgentId, id: &str) -> std::io::Result<String> {
    let mut f = load(app_data);
    std::fs::create_dir_all(extra_dir(app_data, id))?;
    f.extra.push(Extra { id: id.to_string(), agent });
    save(app_data, &f)?;
    Ok(id.to_string())
}

/// Removes an extra account and its folder (its sign-in goes with it). The default account stays.
pub fn remove(app_data: &Path, id: &str) -> std::io::Result<()> {
    if id == DEFAULT {
        return Ok(());
    }
    let mut f = load(app_data);
    f.extra.retain(|e| e.id != id);
    f.active.retain(|_, v| v != id);
    save(app_data, &f)?;
    let d = extra_dir(app_data, id);
    if d.starts_with(app_data.join("accounts")) && d.is_dir() {
        std::fs::remove_dir_all(d)?;
    }
    Ok(())
}

/// The sign-in files to delete to sign an account out: inside an extra account's folder, or the
/// agent CLI's own files for the default account (which signs that CLI out on this computer too).
/// Claude signs out with `claude auth logout` instead; Antigravity's files are not known.
pub fn sign_out_files(agent: AgentId, dir: Option<&Path>, home: &Path) -> Vec<PathBuf> {
    match (agent, dir) {
        (AgentId::Codex | AgentId::Opencode, Some(d)) => crate::system::account_files_in(agent, d),
        (AgentId::Codex, None) => vec![home.join(".codex/auth.json")],
        (AgentId::Opencode, None) => vec![home.join(".local/share/opencode/auth.json")],
        (AgentId::Gemini, _) => vec![home.join(".gemini/oauth_creds.json"), home.join(".gemini/google_accounts.json")],
        _ => Vec::new(),
    }
}

/// Makes an account the agent's active one.
pub fn set_active(app_data: &Path, key: &str, id: &str) -> std::io::Result<()> {
    let mut f = load(app_data);
    f.active.insert(key.to_string(), id.to_string());
    save(app_data, &f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_uses_and_removes_accounts() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        assert_eq!(active(&load(data), AgentId::Codex, "codex"), DEFAULT);
        add(data, AgentId::Codex, "acc-1").unwrap();
        assert!(extra_dir(data, "acc-1").is_dir());
        set_active(data, "codex", "acc-1").unwrap();
        assert_eq!(active(&load(data), AgentId::Codex, "codex"), "acc-1");
        // An id of another agent is not this agent's active account.
        assert_eq!(active(&load(data), AgentId::Claude, "codex"), DEFAULT);
        remove(data, "acc-1").unwrap();
        assert!(!extra_dir(data, "acc-1").exists());
        assert_eq!(active(&load(data), AgentId::Codex, "codex"), DEFAULT);
    }

    #[test]
    fn signs_out_by_deleting_the_right_files() {
        let home = Path::new("/home/u");
        assert_eq!(sign_out_files(AgentId::Codex, None, home), [PathBuf::from("/home/u/.codex/auth.json")]);
        assert_eq!(sign_out_files(AgentId::Codex, Some(Path::new("/d/a")), home), [PathBuf::from("/d/a/auth.json")]);
        assert_eq!(sign_out_files(AgentId::Opencode, Some(Path::new("/d/a")), home), [PathBuf::from("/d/a/opencode/auth.json")]);
        assert_eq!(sign_out_files(AgentId::Gemini, None, home).len(), 2);
        assert!(sign_out_files(AgentId::Antigravity, None, home).is_empty());
        assert!(sign_out_files(AgentId::Claude, None, home).is_empty());
    }

    #[test]
    fn points_each_agent_at_its_folder() {
        let d = Path::new("/data/accounts/a");
        assert_eq!(env_for(AgentId::Codex, d), [("CODEX_HOME".to_string(), "/data/accounts/a".to_string())]);
        assert_eq!(env_for(AgentId::Opencode, d)[0].0, "XDG_DATA_HOME");
        assert_eq!(env_for(AgentId::Claude, d)[0].0, crate::claude_account::CONFIG_ENV);
        assert!(env_for(AgentId::Gemini, d).is_empty());
        let data = Path::new("/data");
        assert_eq!(dir(data, AgentId::Codex, DEFAULT), None);
        assert_eq!(dir(data, AgentId::Claude, DEFAULT), Some(PathBuf::from("/data/claude")));
        assert_eq!(dir(data, AgentId::Codex, "a"), Some(PathBuf::from("/data/accounts/a")));
    }
}
