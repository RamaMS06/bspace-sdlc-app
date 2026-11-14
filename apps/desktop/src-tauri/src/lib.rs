//! BSpace SDLC's Rust side. Layers, outside in:
//! - `commands`: the Tauri commands the webview calls (the IPC contract), thin;
//! - `app`: the running app (managed state, start-up, events, tray);
//! - `domain`: what the app does, one module per area;
//! - `infra`: the database, keychain, HTTP, the Buma API, running programs;
//! - `types`: the serde types shared with the TypeScript side.

mod app;
mod commands;
pub mod domain;
mod infra;
#[cfg(test)]
mod test_support;
pub mod types;

use app::{setup, tray};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // First, so a second launch is caught before anything else starts: it shows the running window and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Launch at login is switched on and off from Settings (the JS plugin API), only while background mode is on.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![tray::HIDDEN_ARG])))
        // Updates come from the signed latest.json on GitHub Releases (endpoints and public key in tauri.conf.json);
        // the webview checks, downloads and installs, then relaunches through the process plugin.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            tray::on_window_event(window, event, || {
                app.try_state::<app::state::AppState>().is_some_and(|s| s.db.get_settings(&s.home).background_mode)
            });
        })
        .setup(setup::setup)
        .invoke_handler(tauri::generate_handler![
            commands::system::get_system_info,
            commands::system::system_locale,
            commands::system::detect_agents,
            commands::skills::skills_list,
            commands::plugins::plugins_list,
            commands::plugins::plugin_stage_folder,
            commands::plugins::plugin_stage_zip,
            commands::plugins::plugin_stage_github,
            commands::plugins::plugin_install,
            commands::plugins::plugin_discard,
            commands::plugins::plugin_remove,
            commands::plugins::plugin_set_enabled,
            commands::skills::skill_read,
            commands::skills::skill_save,
            commands::skills::skill_set_enabled,
            commands::skills::skill_delete,
            commands::skills::skill_import,
            commands::skills::skill_github_fetch,
            commands::skills::skill_github_install,
            commands::skills::skill_github_discard,
            commands::api_engine::api_status,
            commands::api_engine::api_check,
            commands::api_engine::api_try,
            commands::api_engine::api_reachable,
            commands::api_engine::api_save,
            commands::api_engine::api_clear,
            commands::api_engine::engine_install,
            commands::system::check_tools,
            commands::claude_account::claude_account,
            commands::claude_account::claude_sign_in,
            commands::claude_account::claude_sign_in_cancel,
            commands::claude_account::claude_sign_out,
            commands::devops::devops_status,
            commands::devops::devops_sign_in,
            commands::devops::devops_microsoft_sign_in,
            commands::devops::devops_sign_out,
            commands::share::share_status,
            commands::share::share_projects,
            commands::share::share_invite,
            commands::share::share_revoke,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::system::pick_folder,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::set_project_status,
            commands::chats::list_chats,
            commands::files::project_files,
            commands::files::find_project_files,
            commands::files::read_project_file,
            commands::files::open_project_folder,
            commands::agents::set_agent_model,
            commands::agents::agent_models,
            commands::settings::api_url_override,
            commands::usage::cloud_usage,
            commands::chats::list_recent_chats,
            commands::chats::list_archived_chats,
            commands::chats::set_thread_archived,
            commands::chats::purge_archive,
            commands::chats::get_chat,
            commands::chats::create_chat,
            commands::chats::update_chat_agent,
            commands::chats::list_messages,
            commands::chats::add_message,
            commands::jobs::list_jobs,
            commands::jobs::upsert_job,
            commands::jobs::delete_job,
            commands::jobs::set_jobs_archived,
            commands::chats::attach_file,
            commands::agents::agent_start,
            commands::agents::agent_prompt,
            commands::agents::agent_set_auto,
            commands::agents::agent_cancel,
            commands::chats::set_chat_folder,
            commands::chats::set_chat_project,
            commands::agents::agent_set_mode,
            commands::agents::agent_modes,
            commands::agents::agent_stop,
            commands::agents::agent_respond_permission,
            commands::agents::agent_respond_question,
            commands::usage::get_agent_usage,
            commands::usage::agent_activity,
            commands::agents::agent_model_catalog,
            commands::agents::agent_sign_in,
            commands::agents::agent_install,
            commands::accounts::accounts_list,
            commands::accounts::account_add,
            commands::accounts::account_remove,
            commands::accounts::account_use,
            commands::accounts::account_sign_out,
            commands::accounts::account_sign_in,
            commands::usage::agent_failover_record,
            commands::chats::get_chat_trace,
            commands::auth::auth_start,
            commands::auth::auth_cancel,
            commands::auth::auth_status,
            commands::auth::auth_logout,
        ])
        .build(tauri::generate_context!())
        .expect("error while building BSpace SDLC");
    app.run(setup::on_run_event);
}
