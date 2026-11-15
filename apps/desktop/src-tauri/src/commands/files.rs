//! A project's files (the workspace).

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::domain::files::{self, FileContent, FileEntry};
use crate::domain::workspace::project_folder;
use tauri::{AppHandle, State};

/// One folder of a project, `dir` relative to the project folder ("" is the top).
#[tauri::command]
pub(crate) async fn project_files(state: State<'_, AppState>, project_id: String, dir: String) -> CmdResult<Vec<FileEntry>> {
    let root = project_folder(&state.db, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || files::list_dir(&root, &dir)).await.map_err(err)?
}

/// A project's files whose name contains `query`.
#[tauri::command]
pub(crate) async fn find_project_files(state: State<'_, AppState>, project_id: String, query: String) -> CmdResult<Vec<FileEntry>> {
    let root = project_folder(&state.db, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || files::find(&root, &query)).await.map_err(err)?
}

/// Opens a project's folder in the file manager. The path is found here, so the webview can't ask to
/// open any other folder.
#[tauri::command]
pub(crate) async fn open_project_folder(app: AppHandle, state: State<'_, AppState>, project_id: String) -> CmdResult<()> {
    let folder = project_folder(&state.db, &project_id)?;
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(folder.to_string_lossy(), None::<&str>).map_err(err)
}

/// One project file to show: its text, or what kind of file it is.
#[tauri::command]
pub(crate) async fn read_project_file(state: State<'_, AppState>, project_id: String, path: String) -> CmdResult<FileContent> {
    let root = project_folder(&state.db, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || files::read(&root, &path)).await.map_err(err)?
}

/// A Word document in the project (a Blueprint, an FTSD) as Markdown, to read it in the app.
#[tauri::command]
pub(crate) async fn read_project_docx(state: State<'_, AppState>, project_id: String, path: String) -> CmdResult<String> {
    let root = project_folder(&state.db, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = files::resolve(&root, &path)?;
        let size = std::fs::metadata(&full).map_err(err)?.len();
        if size > crate::domain::docx::MAX_BYTES {
            return Err("This document is too big to show here. Open it in Word.".to_string());
        }
        crate::domain::docx::to_markdown(&std::fs::read(&full).map_err(err)?)
    })
    .await
    .map_err(err)?
}
