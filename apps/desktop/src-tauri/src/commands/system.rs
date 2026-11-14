//! This computer: OS, language, installed agents and tools, and the folder picker.

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::domain::agents::{detect, launch};
use crate::domain::{accounts, environment};
use crate::infra::exec::{refresh_shell_path, RealExec};
use crate::infra::token_store::ApiKeys;
use crate::types::{AgentId, AgentInfo, SystemInfo, ToolStatus};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn get_system_info() -> CmdResult<SystemInfo> {
    tauri::async_runtime::spawn_blocking(|| environment::system_info(&RealExec)).await.map_err(err)
}

/// The operating system's preferred language (see `environment::locale`).
#[tauri::command]
pub(crate) fn system_locale() -> Option<String> {
    environment::locale()
}

#[tauri::command]
pub(crate) async fn detect_agents(app: AppHandle) -> CmdResult<Vec<AgentInfo>> {
    let mut agents = tauri::async_runtime::spawn_blocking(|| detect::detect_agents(&RealExec)).await.map_err(err)?;
    let data = app.path().app_data_dir().ok();
    let provider = app.try_state::<AppState>().and_then(|s| s.db.get_settings(&s.home).api_provider);
    let keys = app.try_state::<ApiKeys>();
    agents.push(launch::api_agent_info(data.as_deref(), provider, keys.as_deref()).await);
    Ok(agents)
}

#[tauri::command]
pub(crate) async fn check_tools(app: AppHandle, agent: Option<AgentId>) -> CmdResult<Vec<ToolStatus>> {
    // Figma MCP is checked in the config of the agent that will do the work.
    let claude_dir = super::app_data_dir(&app).and_then(|d| accounts::claude_config_dir(&d)).ok();
    let files = environment::mcp_config_files(agent.unwrap_or(AgentId::Claude), claude_dir.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        // The user may have just installed a tool in their terminal: read their shell's PATH again.
        refresh_shell_path();
        environment::check_tools(&RealExec, &files)
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub(crate) async fn pick_folder(app: AppHandle) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)
}
