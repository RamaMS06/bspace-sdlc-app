//! Chats, their messages and attachments, the archive, and a chat's trace.

use super::{app_data_dir, err, CmdResult};
use crate::app::state::AppState;
use crate::domain::attachments::{copy_attachment, MAX_ATTACHMENT};
use crate::domain::{trace, workspace};
use crate::types::{AgentId, Chat, ChatMessage, MessagePart, MessageRole, RecentChat};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub(crate) fn list_chats(state: State<'_, AppState>, project_id: Option<String>) -> CmdResult<Vec<Chat>> {
    state.db.list_chats(project_id.as_deref()).map_err(err)
}

/// The sidebar's Recent list: chats with and without a project, newest activity first.
/// Async so the query never runs on the main thread.
#[tauri::command]
pub(crate) async fn list_recent_chats(state: State<'_, AppState>, limit: Option<u32>) -> CmdResult<Vec<RecentChat>> {
    state.db.list_recent_chats(limit).map_err(err)
}

/// Archived threads for Settings › Archive.
#[tauri::command]
pub(crate) async fn list_archived_chats(state: State<'_, AppState>) -> CmdResult<Vec<RecentChat>> {
    state.db.list_archived_chats().map_err(err)
}

/// Archives (or restores) the thread a chat belongs to.
#[tauri::command]
pub(crate) fn set_thread_archived(state: State<'_, AppState>, chat_id: String, archived: bool) -> CmdResult<()> {
    state.db.set_thread_archived(&chat_id, archived).map_err(err)
}

/// What emptying the archive removed.
#[derive(serde::Serialize)]
pub(crate) struct PurgedArchive {
    chats: usize,
    cards: usize,
}

/// Deletes archived chats and cards for good. Projects and their files stay.
#[tauri::command]
pub(crate) fn purge_archive(state: State<'_, AppState>) -> CmdResult<PurgedArchive> {
    let (chats, cards) = state.db.purge_archive().map_err(err)?;
    Ok(PurgedArchive { chats, cards })
}

/// One chat by id, whether or not it belongs to a project.
#[tauri::command]
pub(crate) fn get_chat(state: State<'_, AppState>, chat_id: String) -> CmdResult<Option<Chat>> {
    state.db.get_chat(&chat_id).map_err(err)
}

#[tauri::command]
pub(crate) fn create_chat(state: State<'_, AppState>, project_id: Option<String>, agent_id: AgentId, title: String) -> CmdResult<Chat> {
    state.db.create_chat(project_id.as_deref(), agent_id, &title).map_err(err)
}

/// Switches the chat to another agent. The agent id is validated by its enum on the way in.
#[tauri::command]
pub(crate) fn update_chat_agent(state: State<'_, AppState>, chat_id: String, agent_id: AgentId) -> CmdResult<Chat> {
    state.db.set_chat_agent(&chat_id, agent_id).map_err(err)?.ok_or_else(|| format!("No chat {chat_id}"))
}

#[tauri::command]
pub(crate) fn list_messages(state: State<'_, AppState>, chat_id: String) -> CmdResult<Vec<ChatMessage>> {
    state.db.list_messages(&chat_id).map_err(err)
}

#[tauri::command]
pub(crate) fn add_message(state: State<'_, AppState>, chat_id: String, role: MessageRole, parts: Vec<MessagePart>) -> CmdResult<ChatMessage> {
    state.db.add_message(&chat_id, role, &parts).map_err(err)
}

/// Attaches a folder to a chat (its agent works there from the next session), or detaches it.
#[tauri::command]
pub(crate) fn set_chat_folder(state: State<'_, AppState>, chat_id: String, folder: Option<String>) -> CmdResult<Chat> {
    let folder = match folder {
        Some(f) => {
            let p = PathBuf::from(&f);
            if !p.is_absolute() || !p.is_dir() {
                return Err(format!("{f} is not a folder on this computer"));
            }
            Some(p.to_string_lossy().into_owned())
        }
        None => None,
    };
    state
        .db
        .set_chat_folder(&chat_id, folder.as_deref())
        .map_err(err)?
        .ok_or_else(|| "This chat no longer exists".to_string())
}

/// Moves a chat into a project: a feature started from a chat that began without one.
#[tauri::command]
pub(crate) fn set_chat_project(state: State<'_, AppState>, chat_id: String, project_id: String) -> CmdResult<Chat> {
    state
        .db
        .set_chat_project(&chat_id, &project_id)
        .map_err(err)?
        .ok_or_else(|| "This chat no longer exists".to_string())
}

/// Copies a file into the chat's folder, for the agent to read.
#[tauri::command]
pub(crate) fn attach_file(state: State<'_, AppState>, chat_id: String, source_path: String) -> CmdResult<MessagePart> {
    let cwd = workspace::chat_cwd(&state.db, &state.working(), &chat_id)?;
    copy_attachment(&cwd, Path::new(&source_path), MAX_ATTACHMENT)
}

/// A chat's turns, model calls and tool calls with their timings and tokens (see `trace::for_chat`).
#[tauri::command]
pub(crate) async fn get_chat_trace(app: AppHandle, state: State<'_, AppState>, chat_id: String) -> CmdResult<trace::ChatTrace> {
    let data = app_data_dir(&app)?;
    trace::for_chat(&state.db, &state.working(), &state.home, &data, &chat_id).await
}
