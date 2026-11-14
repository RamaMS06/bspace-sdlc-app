//! The command and environment that start an agent on this computer: the agent's ACP program, or
//! for Your API the engine with the saved provider and key; plus the active account's environment.

use crate::domain::agents::detect;
use crate::domain::agents::session::agent_key;
use crate::domain::{accounts, api_engine, claude_account};
use crate::infra::db::Db;
use crate::infra::exec::RealExec;
use crate::infra::token_store::ApiKeys;
use crate::types::{AgentId, AgentInfo, ApiProvider};
use std::path::Path;

/// A program with its arguments, and the environment it needs of its own.
pub(crate) type Launch = (Vec<String>, Vec<(String, String)>);

/// The command that starts `agent_id` on this computer, plus any environment of its own.
pub(crate) async fn agent_launch(data: &Path, db: &Db, home: &Path, keys: &ApiKeys, agent_id: AgentId) -> Result<Launch, String> {
    if agent_id == AgentId::Custom {
        return api_agent(data, db, home, keys).await;
    }
    if agent_id == AgentId::Codex && std::env::var("BUMA_CODEX_ADAPTER").as_deref() != Ok("zed") {
        return codex_bridge(data);
    }
    let mut command = detect::acp_command(agent_id).ok_or("Pick an agent first")?;
    let program = command[0].clone();
    let found = detect::agent_program(&RealExec, agent_id).ok_or_else(|| format!("Can't find {program} on this computer"))?;
    command[0] = found.to_string_lossy().into_owned();
    Ok((command, Vec::new()))
}

/// Codex's ACP bridge: a script that runs Codex's own `codex app-server` and speaks ACP to the app.
/// Codex's ACP adapter bundles an old Codex, which refuses the models a ChatGPT account has today, so the
/// app talks to the installed-latest Codex itself. `BUMA_CODEX_ADAPTER=zed` goes back to the adapter.
const CODEX_BRIDGE: &str = include_str!("../../../bridges/codex-app-server.mjs");

/// Writes the bridge into the app's data folder (when it changed) and returns the command that runs it.
fn codex_bridge(data: &Path) -> Result<Launch, String> {
    let dir = data.join("bridges");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("codex-app-server.mjs");
    if std::fs::read_to_string(&file).ok().as_deref() != Some(CODEX_BRIDGE) {
        std::fs::write(&file, CODEX_BRIDGE).map_err(|e| e.to_string())?;
    }
    let node = crate::infra::exec::Exec::which(&RealExec, "node").ok_or("Codex needs Node.js, which isn't on this computer")?;
    Ok((vec![node.to_string_lossy().into_owned(), file.to_string_lossy().into_owned()], Vec::new()))
}

/// The command and environment that start Your API: the engine with the saved provider and key.
async fn api_agent(data: &Path, db: &Db, home: &Path, keys: &ApiKeys) -> Result<Launch, String> {
    let engine = api_engine::installed_engine(data).ok_or("Your API isn't set up yet. Open Settings › Agents › Your API")?;
    let provider = db.get_settings(home).api_provider.ok_or("Your API isn't set up yet. Open Settings › Agents › Your API")?;
    let key = keys.get().await?.filter(|k| !k.is_empty()).ok_or("Your API key is missing. Open Settings › Agents › Your API")?;
    // The provider's list today (models come and go); the saved one when it can't be read.
    let mut provider = provider;
    let client = crate::infra::http::client(std::time::Duration::from_secs(8)).map_err(|e| e.to_string())?;
    let fresh = api_engine::check(&client, &provider.base_url, &key).await;
    if fresh.ok {
        provider.models = fresh.models;
    }
    let config_dir = api_engine::engine_config_dir(data);
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let data_dir = api_engine::engine_data_dir(data);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let config_file = api_engine::write_config(&api_engine::engine_root(data), &provider).map_err(|e| e.to_string())?;
    let command = vec![engine.to_string_lossy().into_owned(), "acp".into()];
    Ok((command, api_engine::session_env(&config_file, &key, &config_dir, &data_dir)))
}

/// Your API as a row of the agent list: ready once the engine, the provider and the key are there.
pub(crate) async fn api_agent_info(data: Option<&Path>, provider: Option<ApiProvider>, keys: Option<&ApiKeys>) -> AgentInfo {
    let engine = data.and_then(api_engine::installed_engine).is_some();
    let key = match keys {
        Some(k) => k.get().await.ok().flatten().is_some_and(|k| !k.is_empty()),
        None => false,
    };
    AgentInfo {
        id: AgentId::Custom,
        name: "Your API".into(),
        installed: engine && provider.is_some() && key,
        version: provider.map(|p| p.model),
        acp_command: Vec::new(),
        recommended: false,
        signed_in: key,
        account: None,
    }
}

/// The active account's environment for a session. Claude: `CLAUDE_CONFIG_DIR`, Buma's own sign-in
/// and a clean setup. Codex and opencode on an extra account: that account's folder, where their
/// sign-in lives. Nothing otherwise.
pub(crate) fn account_env(data: &Path, agent: AgentId) -> Result<Vec<(String, String)>, String> {
    if agent != AgentId::Claude {
        let id = accounts::active(&accounts::load(data), agent, &agent_key(agent));
        return Ok(match accounts::dir(data, agent, &id) {
            Some(d) if accounts::supports_accounts(agent) => accounts::env_for(agent, &d),
            _ => Vec::new(),
        });
    }
    let dir = accounts::claude_config_dir(data)?;
    Ok(vec![(claude_account::CONFIG_ENV.to_string(), dir.to_string_lossy().into_owned())])
}

/// The model the user picked for this agent, if any.
pub(crate) fn picked_model(db: &Db, home: &Path, agent: AgentId) -> Option<String> {
    db.get_settings(home).agent_models.get(&agent_key(agent)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_starts_through_the_bridge_script_written_into_the_data_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (command, env) = codex_bridge(dir.path()).unwrap();
        assert!(command[0].contains("node"), "{command:?}");
        let script = dir.path().join("bridges/codex-app-server.mjs");
        assert_eq!(command[1], script.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&script).unwrap(), CODEX_BRIDGE);
        assert!(env.is_empty());
        // A changed copy on disk is replaced by the one the app ships.
        std::fs::write(&script, "old").unwrap();
        codex_bridge(dir.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&script).unwrap(), CODEX_BRIDGE);
    }
}
