//! Sharing a feature (see `domain::share`): who it is shared with, and inviting or removing people.

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::domain::share::{self, AzProject, Azure, Hosts, InviteResult, Role, ShareInfo};
use crate::domain::devops;
use crate::infra::token_store::ApiKeys;
use std::path::PathBuf;
use tauri::State;

fn folder_of(state: &AppState, project_id: &str) -> CmdResult<(PathBuf, String)> {
    let p = state.db.get_project(project_id).map_err(err)?.ok_or("That feature no longer exists")?;
    Ok((PathBuf::from(p.folder), p.title))
}

async fn azure(keys: &ApiKeys) -> CmdResult<(Azure, devops::DevopsProfile)> {
    let (profile, header) = devops::authorization(keys).await?;
    Ok((Azure::new(Hosts::real(), &profile.org, header)?, profile))
}

fn author(profile: &devops::DevopsProfile) -> share::Author {
    share::Author { name: profile.display_name.clone(), email: profile.email.clone().unwrap_or_else(|| "bspace@localhost".into()) }
}

/// What the feature is shared as and with whom; None when it isn't shared.
#[tauri::command]
pub(crate) fn share_status(state: State<'_, AppState>, project_id: String) -> CmdResult<Option<ShareInfo>> {
    let (folder, _) = folder_of(&state, &project_id)?;
    Ok(share::load(&folder))
}

/// The organization's projects, for choosing where the feature's repo goes.
#[tauri::command]
pub(crate) async fn share_projects(keys: State<'_, ApiKeys>) -> CmdResult<Vec<AzProject>> {
    azure(&keys).await?.0.projects().await
}

#[tauri::command]
pub(crate) async fn share_invite(
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    project_id: String,
    azure_project: Option<AzProject>,
    email: String,
    role: Role,
) -> CmdResult<InviteResult> {
    let (folder, title) = folder_of(&state, &project_id)?;
    let (az, profile) = azure(&keys).await?;
    share::invite(&az, &profile.org, &folder, &title, azure_project.as_ref(), &author(&profile), &email, role).await
}

#[tauri::command]
pub(crate) async fn share_revoke(state: State<'_, AppState>, keys: State<'_, ApiKeys>, project_id: String, email: String) -> CmdResult<ShareInfo> {
    let (folder, _) = folder_of(&state, &project_id)?;
    let (az, profile) = azure(&keys).await?;
    share::revoke(&az, &folder, &author(&profile), &email).await
}
