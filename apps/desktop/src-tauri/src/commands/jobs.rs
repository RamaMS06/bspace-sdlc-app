//! Board cards (jobs).

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::types::Job;
use tauri::State;

#[tauri::command]
pub(crate) fn list_jobs(state: State<'_, AppState>) -> CmdResult<Vec<Job>> {
    state.db.list_jobs().map_err(err)
}

#[tauri::command]
pub(crate) fn delete_job(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_job(&id).map_err(err)
}

/// Archives (or restores) board cards.
#[tauri::command]
pub(crate) fn set_jobs_archived(state: State<'_, AppState>, ids: Vec<String>, archived: bool) -> CmdResult<()> {
    state.db.set_jobs_archived(&ids, archived).map_err(err)
}

#[tauri::command]
pub(crate) fn upsert_job(state: State<'_, AppState>, job: Job) -> CmdResult<()> {
    state.db.upsert_job(&job).map_err(err)
}
