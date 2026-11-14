//! Your API (the `custom` agent: opencode with the user's provider, see `domain::api_engine`).

use super::{app_data_dir, err, CmdResult};
use crate::app::events::ENGINE_PROGRESS;
use crate::app::state::{AppState, EngineInstall, UsageCache};
use crate::domain::api_engine::{self, ApiCheck, ApiProvider, ApiStatus};
use crate::infra::http;
use crate::infra::token_store::ApiKeys;
use crate::types::{AgentId, Settings};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// What Your API has: the provider, whether a key is saved and whether the engine is downloaded.
#[tauri::command]
pub(crate) async fn api_status(app: AppHandle, state: State<'_, AppState>, keys: State<'_, ApiKeys>) -> CmdResult<ApiStatus> {
    let data = app_data_dir(&app)?;
    Ok(api_engine::status(&data, state.db.get_settings(&state.home).api_provider, &keys).await)
}

/// Lists the models at `base_url`, which checks the key too. No `key`: the saved one.
#[tauri::command]
pub(crate) async fn api_check(keys: State<'_, ApiKeys>, base_url: String, key: Option<String>) -> CmdResult<ApiCheck> {
    let base = api_engine::base_url(&base_url)?;
    let key = api_engine::key_or_saved(&keys, key).await?;
    let client = http::client(Duration::from_secs(20)).map_err(err)?;
    Ok(api_engine::check(&client, &base, &key).await)
}

/// One real one-token call with `model`, before saving: proves the key, the balance and the model.
/// No `key`: the saved one.
#[tauri::command]
pub(crate) async fn api_try(keys: State<'_, ApiKeys>, base_url: String, key: Option<String>, model: String) -> CmdResult<ApiCheck> {
    let base = api_engine::base_url(&base_url)?;
    let key = api_engine::key_or_saved(&keys, key).await?;
    let client = http::client(Duration::from_secs(60)).map_err(err)?;
    Ok(api_engine::try_model(&client, &base, &key, model.trim()).await)
}

/// Whether something answers at `base_url` (a local 9router).
#[tauri::command]
pub(crate) async fn api_reachable(base_url: String) -> CmdResult<bool> {
    let Some(base) = api_engine::clean_base_url(&base_url) else { return Ok(false) };
    let client = http::client(Duration::from_millis(1500)).map_err(err)?;
    Ok(api_engine::reachable(&client, &base).await)
}

/// Saves the provider (and the key, when given) and makes Your API the default agent.
#[tauri::command]
pub(crate) async fn api_save(
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    usage: State<'_, UsageCache>,
    provider: ApiProvider,
    key: Option<String>,
) -> CmdResult<Settings> {
    let provider = api_engine::clean_provider(provider)?;
    if let Some(key) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        keys.set(key).await?;
    }
    usage.clear()?;
    // The model picked here is the one to use: forget a pick from the chat's model menu.
    let mut agent_models = state.db.get_settings(&state.home).agent_models;
    agent_models.remove("custom");
    state
        .db
        .update_settings(serde_json::json!({ "apiProvider": provider, "defaultAgent": "custom", "agentModels": agent_models }))
        .map_err(err)
}

/// Forgets the provider and its key. The default agent goes back to Claude Code when it was Your API.
#[tauri::command]
pub(crate) async fn api_clear(state: State<'_, AppState>, keys: State<'_, ApiKeys>) -> CmdResult<Settings> {
    keys.delete().await?;
    let mut patch = serde_json::json!({ "apiProvider": null });
    if state.db.get_settings(&state.home).default_agent == AgentId::Custom {
        patch["defaultAgent"] = serde_json::json!("claude");
    }
    state.db.update_settings(patch).map_err(err)
}

/// Downloads the engine unless it is there, sending `engine://progress` while it does.
#[tauri::command]
pub(crate) async fn engine_install(app: AppHandle, lock: State<'_, EngineInstall>) -> CmdResult<()> {
    let _one = lock.0.lock().await;
    let data = app_data_dir(&app)?;
    let emitter = app.clone();
    api_engine::install_engine_reporting(&data, move |done, total| {
        let _ = emitter.emit(ENGINE_PROGRESS, serde_json::json!({ "done": done, "total": total }));
    })
    .await
}
