//! Signing in to the Buma account (see `domain::auth`).

use super::CmdResult;
use crate::app::state::AppState;
use crate::domain::auth::Auth;
use crate::types::{AuthError, AuthStart, AuthStatus};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// `auth:<code>`, the code being the kebab-case `AuthError` the UI knows.
fn auth_err(e: AuthError) -> String {
    let code = serde_json::to_value(e).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
    format!("auth:{code}")
}

/// Starts signing in: gets a code from the API, opens the browser and polls in the background.
/// Errors are `auth:<code>`; `auth:cancelled` when a cancel came first.
#[tauri::command]
pub(crate) async fn auth_start(app: AppHandle, state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<AuthStart> {
    let base = state.api_base();
    match auth.start(&base).await {
        Ok(Some(started)) => {
            use tauri_plugin_opener::OpenerExt;
            // The dialog has "Open browser again" for when this doesn't work.
            if let Err(e) = app.opener().open_url(&started.verification_uri_complete, None::<&str>) {
                eprintln!("[auth] couldn't open the browser: {e}");
            }
            Ok(started)
        }
        Ok(None) => Err("auth:cancelled".into()),
        Err(e) => Err(auth_err(e)),
    }
}

#[tauri::command]
pub(crate) fn auth_cancel(auth: State<'_, Arc<Auth>>) {
    auth.cancel();
}

#[tauri::command]
pub(crate) fn auth_status(auth: State<'_, Arc<Auth>>) -> AuthStatus {
    auth.status()
}

#[tauri::command]
pub(crate) async fn auth_logout(state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<()> {
    let base = state.api_base();
    auth.logout(&base).await.map_err(auth_err)
}
