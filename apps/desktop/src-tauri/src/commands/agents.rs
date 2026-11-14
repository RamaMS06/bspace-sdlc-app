//! A chat's agent: starting it, prompting it, its modes and models, answering what it asks; plus
//! signing in to an agent, listing its models and installing it.

use super::{app_data_dir, err, CmdResult};
use crate::app::events::TauriSink;
use crate::app::state::AppState;
use crate::domain::agents::session::{self, agent_key, ChatSession};
use crate::domain::agents::{install, launch, prompt};
use crate::domain::ai_proxy::AiProxy;
use crate::domain::attachments::check_file_parts;
use crate::domain::{model_catalog, workspace};
use crate::infra::token_store::ApiKeys;
use crate::types::{AgentId, MessagePart, ModelChoice, Settings};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Starts the chat's agent. Resolves `true` when Claude started without the Buma
/// plugin, so the caller must send the skills as text in the first prompt (other
/// agents always get them that way).
#[tauri::command]
pub(crate) async fn agent_start(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    chat_id: String,
    agent_id: AgentId,
    auto: Option<bool>,
) -> CmdResult<bool> {
    let data = app_data_dir(&app)?;
    let (command, launch_env) = launch::agent_launch(&data, &state.db, &state.home, &keys, agent_id).await?;
    let folder = workspace::chat_folder(&state.db, &chat_id)?;
    let cwd = workspace::resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    let mut env = launch::account_env(&data, agent_id)?;
    env.extend(launch_env);
    let resource_dir = app.path().resource_dir().ok();
    let (options, skills_as_text) = ChatSession {
        agent: agent_id,
        chat_id: &chat_id,
        data: Some(&data),
        resource_dir: resource_dir.as_deref(),
        has_folder: folder.is_some(),
        auto: auto.unwrap_or(false),
        model: launch::picked_model(&state.db, &state.home, agent_id),
        env,
        proxy_env: app.try_state::<Arc<AiProxy>>().map(|p| p.session_env(&chat_id)).unwrap_or_default(),
    }
    .options();
    state
        .acp
        .start_with(&chat_id, &command, &cwd, Arc::new(TauriSink(app)), options)
        .await
        .map_err(err)?;
    Ok(skills_as_text)
}

#[tauri::command]
pub(crate) async fn agent_prompt(state: State<'_, AppState>, chat_id: String, parts: Vec<MessagePart>) -> CmdResult<()> {
    if parts.iter().any(|p| matches!(p, MessagePart::File { .. })) {
        let cwd = workspace::chat_cwd(&state.db, &state.working(), &chat_id)?;
        check_file_parts(&cwd, &parts)?;
    }
    let prompt = prompt::build_prompt(&parts, |id| state.db.get_project(id).ok().flatten(), prompt::read_brief);
    state.acp.prompt(&chat_id, prompt).await.map_err(err)
}

/// Turns auto mode on or off for the chat's running agent. The setup chat can't.
#[tauri::command]
pub(crate) async fn agent_set_auto(state: State<'_, AppState>, chat_id: String, on: bool) -> CmdResult<()> {
    let on = session::wants_auto(&chat_id, on);
    state.acp.set_auto(&chat_id, on).await.map(|_| ()).map_err(err)
}

/// The chat's permission mode: `ask`, `acceptEdits`, `plan`, `auto` or `bypass`.
#[tauri::command]
pub(crate) async fn agent_set_mode(state: State<'_, AppState>, chat_id: String, mode: String) -> CmdResult<()> {
    state.acp.set_permission_mode(&chat_id, &mode).await.map_err(err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentModes {
    available: Vec<String>,
    current: Option<String>,
}

/// The modes the chat's running agent offers (empty for an agent without modes).
#[tauri::command]
pub(crate) fn agent_modes(state: State<'_, AppState>, chat_id: String) -> CmdResult<AgentModes> {
    let (available, current) = state.acp.modes(&chat_id).map_err(err)?;
    Ok(AgentModes { available, current })
}

#[tauri::command]
pub(crate) async fn agent_cancel(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    state.acp.cancel(&chat_id).await.map_err(err)
}

/// Stops the agent process of this chat. Stopping a chat with no agent is fine.
#[tauri::command]
pub(crate) async fn agent_stop(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    let _ = state.acp.stop(&chat_id).await;
    Ok(())
}

/// The user's answer to an agent's question: `{action: "accept", content}`, `{action: "decline"}`
/// or `{action: "cancel"}`.
#[tauri::command]
pub(crate) fn agent_respond_question(state: State<'_, AppState>, request_id: String, response: serde_json::Value) -> CmdResult<()> {
    state.acp.respond_question(&request_id, response).map_err(err)
}

#[tauri::command]
pub(crate) fn agent_respond_permission(state: State<'_, AppState>, request_id: String, option_id: Option<String>) -> CmdResult<()> {
    state.acp.respond_permission(&request_id, option_id).map_err(err)
}

/// Picks the model for an agent (None: its own default) and, when `chat_id` has a session
/// running, switches that session now. Later sessions of the agent start on it.
#[tauri::command]
pub(crate) async fn set_agent_model(
    state: State<'_, AppState>,
    agent_id: AgentId,
    model: Option<String>,
    chat_id: Option<String>,
) -> CmdResult<Settings> {
    let settings = state
        .db
        .update_settings(serde_json::json!({ "agentModels": { agent_key(agent_id): model } }))
        .map_err(err)?;
    if let (Some(chat), Some(value)) = (chat_id.as_deref(), model.as_deref()) {
        // No session yet is fine: it starts on the picked model.
        if state.acp.models(chat).is_ok() {
            state.acp.set_model(chat, value).await.map_err(err)?;
        }
    }
    Ok(settings)
}

/// The models an agent offers, and the one in use.
#[derive(serde::Serialize)]
pub(crate) struct AgentModels {
    current: Option<String>,
    options: Vec<ModelChoice>,
}

/// The models an agent offers, read by opening a short session in a scratch folder (for the picker
/// before any chat with that agent has run). None when the agent doesn't report models.
#[tauri::command]
pub(crate) async fn agent_models(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    agent_id: AgentId,
) -> CmdResult<Option<AgentModels>> {
    let data = app_data_dir(&app)?;
    let (command, launch_env) = launch::agent_launch(&data, &state.db, &state.home, &keys, agent_id).await?;
    let cache = app.path().app_cache_dir().map_err(err)?;
    let mut options = session::session_options(agent_id, None, false);
    options.env.extend(launch::account_env(&data, agent_id)?);
    options.env.extend(launch_env);
    let probe = format!("models-{}", agent_key(agent_id));
    let models = session::probe(&state.acp, &cache, &probe, &command, options, |acp, id| acp.models(id).ok().flatten()).await?;
    Ok(models.map(|m| AgentModels { current: m.current, options: m.options }))
}

/// Every model and version an agent can run, for Settings › Agents › Provider (see
/// `model_catalog::for_agent`); agents that only report theirs through ACP use `agent_models`.
#[tauri::command]
pub(crate) async fn agent_model_catalog(app: AppHandle, state: State<'_, AppState>, agent_id: AgentId) -> CmdResult<Vec<ModelChoice>> {
    model_catalog::for_agent(&app_data_dir(&app)?, &state.home, agent_id).await
}

/// Signs in to an agent the way it signs in (Add connection in Settings › Agents › Provider): its ACP
/// `authenticate` with the browser sign-in method, which opens the OAuth page (ChatGPT, Google…) and
/// returns once the user is done. Claude signs in through `claude_account` instead.
#[tauri::command]
pub(crate) async fn agent_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    agent_id: AgentId,
    method: Option<String>,
) -> CmdResult<()> {
    let data = app_data_dir(&app)?;
    let (command, launch_env) = launch::agent_launch(&data, &state.db, &state.home, &keys, agent_id).await?;
    let cache = app.path().app_cache_dir().map_err(err)?;
    let mut options = session::session_options(agent_id, None, false);
    options.env.extend(launch::account_env(&data, agent_id)?);
    options.env.extend(launch_env);
    options.authenticate = Some(method.unwrap_or_default());
    let probe = format!("sign-in-{}", agent_key(agent_id));
    session::probe(&state.acp, &cache, &probe, &command, options, |_, _| ()).await
}

/// Installs an agent's CLI with npm (`npm install -g`), for Add connection. The error is npm's last lines.
#[tauri::command]
pub(crate) async fn agent_install(agent_id: AgentId) -> CmdResult<()> {
    install::install(agent_id).await
}
