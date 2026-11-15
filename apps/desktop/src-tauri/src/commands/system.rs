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

/// The page of the system's own settings where notifications are allowed for apps, by operating system.
/// The address is fixed here, so the webview can't ask to open anything else.
pub(crate) fn notification_settings_url(os: &str) -> Option<&'static str> {
    match os {
        "macos" => Some("x-apple.systempreferences:com.apple.Notifications-Settings.extension"),
        "windows" => Some("ms-settings:notifications"),
        _ => None,
    }
}

/// Opens the system's notification settings, where the user allows this app's notifications.
#[tauri::command]
pub(crate) fn open_notification_settings(app: AppHandle) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let url = notification_settings_url(std::env::consts::OS).ok_or("This system has no single notification settings page to open. Check your desktop's settings for BSpace SDLC.")?;
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[cfg(test)]
mod notification_settings_tests {
    use super::notification_settings_url;

    #[test]
    fn macos_and_windows_have_a_settings_page_and_others_none() {
        assert!(notification_settings_url("macos").unwrap().starts_with("x-apple.systempreferences:"));
        assert_eq!(notification_settings_url("windows"), Some("ms-settings:notifications"));
        assert_eq!(notification_settings_url("linux"), None);
    }
}
