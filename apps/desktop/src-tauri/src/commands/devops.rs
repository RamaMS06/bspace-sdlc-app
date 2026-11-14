//! Azure DevOps sign-in (see `domain::devops`): required before the app opens.

use super::CmdResult;
use crate::domain::devops::{self, DevopsStatus};
use crate::infra::token_store::ApiKeys;
use tauri::State;

/// Who is signed in to Azure DevOps, from the keychain (no network: it works offline).
#[tauri::command]
pub(crate) async fn devops_status(keys: State<'_, ApiKeys>) -> CmdResult<DevopsStatus> {
    devops::status(&keys).await
}

/// Checks the token against the organization, then saves both. The token stays in Rust.
#[tauri::command]
pub(crate) async fn devops_sign_in(keys: State<'_, ApiKeys>, org: String, pat: String) -> CmdResult<DevopsStatus> {
    devops::sign_in_with_pat(&keys, &org, &pat).await
}

/// Sign in with Microsoft, through the Azure CLI.
#[tauri::command]
pub(crate) async fn devops_microsoft_sign_in(keys: State<'_, ApiKeys>, org: String) -> CmdResult<DevopsStatus> {
    devops::sign_in_with_microsoft(&keys, &org).await
}

#[tauri::command]
pub(crate) async fn devops_sign_out(keys: State<'_, ApiKeys>) -> CmdResult<DevopsStatus> {
    devops::sign_out(&keys).await
}
