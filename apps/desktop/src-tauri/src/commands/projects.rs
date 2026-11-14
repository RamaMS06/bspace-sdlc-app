//! Projects.

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::domain::projects;
use crate::types::{NewProject, Project, ProjectStatus};
use std::path::Path;
use tauri::State;

#[tauri::command]
pub(crate) fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<Project>> {
    state.db.list_projects().map_err(err)
}

#[tauri::command]
pub(crate) fn create_project(state: State<'_, AppState>, input: NewProject, brief: String) -> CmdResult<Project> {
    projects::new_project(&state.db, Path::new(&state.working()), input, &brief)
}

#[tauri::command]
pub(crate) fn update_project(state: State<'_, AppState>, id: String, patch: serde_json::Value) -> CmdResult<Project> {
    state.db.update_project(&id, patch).map_err(err)
}

/// Moves a project to `status` (draft → building); never back unless `reset`. See `Db::set_project_status`.
#[tauri::command]
pub(crate) fn set_project_status(
    state: State<'_, AppState>,
    project_id: String,
    status: ProjectStatus,
    reset: Option<bool>,
) -> CmdResult<Project> {
    state.db.set_project_status(&project_id, status, reset.unwrap_or(false)).map_err(err)
}
