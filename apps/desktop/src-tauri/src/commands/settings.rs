//! Settings, and the API address they point at.

use super::{err, CmdResult};
use crate::app::setup::allow_asset_folders;
use crate::app::state::AppState;
use crate::app::tray;
use crate::domain::auth::Auth;
use crate::infra::api_url::effective_api_url;
use crate::types::Settings;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) fn get_settings(state: State<'_, AppState>) -> Settings {
    state.db.get_settings(&state.home)
}

#[tauri::command]
pub(crate) fn update_settings(app: AppHandle, state: State<'_, AppState>, patch: serde_json::Value) -> CmdResult<Settings> {
    let old_api = effective_api_url(&state.db.get_settings(&state.home));
    let settings = state.db.update_settings(patch).map_err(err)?;
    let new_api = effective_api_url(&settings);
    if new_api != old_api {
        // A token belongs to the API it came from: show the new API's own state.
        if let Some(auth) = app.try_state::<Arc<Auth>>() {
            let auth = auth.inner().clone();
            tauri::async_runtime::spawn(async move { auth.refresh(&new_api).await });
        }
    }
    allow_asset_folders(&app, &state.db, &settings.working_folder);
    if tray::sync_tray(&app, &settings).is_err() {
        // No tray here: background mode is turned back off and the user is told why.
        tray::background_off(&state.db)?;
        return Err(tray::TRAY_UNAVAILABLE.into());
    }
    Ok(settings)
}

/// `BUMA_API_URL` when it is set: it wins over the API address in Settings (a dev setup).
#[tauri::command]
pub(crate) fn api_url_override() -> Option<String> {
    crate::infra::api_url::env_override()
}
