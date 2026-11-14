//! Several accounts per agent (Settings › Agents › Provider).

use super::{app_data_dir, err, CmdResult};
use crate::app::events::CLAUDE_SIGN_IN_URL;
use crate::app::state::{AppState, ClaudeSignIn, UsageCache};
use crate::domain::accounts::{self, AccountView};
use crate::domain::agents::session::{self, agent_key};
use crate::domain::agents::launch;
use crate::domain::claude_account;
use crate::infra::token_store::ApiKeys;
use crate::types::AgentId;
use tauri::{AppHandle, Emitter, Manager, State};

/// Every account of the agents that can have several (Claude, Codex, opencode): the default one first.
#[tauri::command]
pub(crate) async fn accounts_list(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Vec<AccountView>> {
    Ok(accounts::list_views(&app_data_dir(&app)?, &state.home).await)
}

/// Adds an account to an agent (signed out until `account_sign_in`); returns its id.
#[tauri::command]
pub(crate) fn account_add(app: AppHandle, agent_id: AgentId) -> CmdResult<String> {
    if !accounts::supports_accounts(agent_id) {
        return Err("This agent has one account".into());
    }
    accounts::add(&app_data_dir(&app)?, agent_id, &uuid::Uuid::new_v4().to_string()).map_err(err)
}

/// Removes an extra account: signs it out (Claude's sign-in is in the Keychain) and deletes its folder.
#[tauri::command]
pub(crate) async fn account_remove(app: AppHandle, agent_id: AgentId, id: String) -> CmdResult<()> {
    let data = app_data_dir(&app)?;
    if agent_id == AgentId::Claude && id != accounts::DEFAULT {
        if let Ok(claude) = claude_account::program() {
            let _ = claude_account::sign_out(&claude, &accounts::extra_dir(&data, &id)).await;
        }
    }
    accounts::remove(&data, &id).map_err(err)
}

/// Signs one account out. Claude: `claude auth logout` in that account's folder. Codex, opencode and
/// Gemini: their sign-in files are deleted (for the default account that is the CLI's own sign-in on
/// this computer, which the UI says before asking).
#[tauri::command]
pub(crate) async fn account_sign_out(
    app: AppHandle,
    state: State<'_, AppState>,
    usage: State<'_, UsageCache>,
    agent_id: AgentId,
    id: String,
) -> CmdResult<()> {
    let dir = accounts::dir(&app_data_dir(&app)?, agent_id, &id);
    usage.clear()?;
    if agent_id == AgentId::Claude {
        let dir = dir.ok_or("No folder for this account")?;
        let claude = claude_account::program()?;
        let _ = claude_account::sign_out(&claude, &dir).await;
        return Ok(());
    }
    accounts::delete_sign_in(agent_id, dir.as_deref(), &state.home)
}

/// Makes an account the agent's active one: new sessions of the agent start on it.
#[tauri::command]
pub(crate) fn account_use(app: AppHandle, usage: State<'_, UsageCache>, agent_id: AgentId, id: String) -> CmdResult<()> {
    let data = app_data_dir(&app)?;
    usage.clear()?;
    accounts::set_active(&data, &agent_key(agent_id), &id).map_err(err)
}

/// Signs in to one account of an agent in the browser: Claude with `claude auth login`, the others with
/// their ACP sign-in, each pointed at that account's folder.
#[tauri::command]
pub(crate) async fn account_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    pending: State<'_, ClaudeSignIn>,
    agent_id: AgentId,
    id: String,
) -> CmdResult<()> {
    let data = app_data_dir(&app)?;
    let dir = accounts::dir(&data, agent_id, &id);
    if agent_id == AgentId::Claude {
        let dir = dir.ok_or("No folder for this account")?;
        std::fs::create_dir_all(&dir).map_err(err)?;
        let claude = claude_account::program()?;
        let emitter = app.clone();
        return claude_account::sign_in_cancellable(&claude, &dir, &pending.0, move |url| {
            let _ = emitter.emit(CLAUDE_SIGN_IN_URL, url);
        })
        .await;
    }
    let (command, launch_env) = launch::agent_launch(&data, &state.db, &state.home, &keys, agent_id).await?;
    let cache = app.path().app_cache_dir().map_err(err)?;
    let mut options = session::session_options(agent_id, None, false);
    options.env.extend(launch_env);
    if let Some(d) = dir.as_deref() {
        options.env.extend(accounts::env_for(agent_id, d));
    }
    options.authenticate = Some(String::new());
    let probe = format!("sign-in-{}", agent_key(agent_id));
    session::probe(&state.acp, &cache, &probe, &command, options, |_, _| ()).await
}
