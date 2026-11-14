//! Tauri commands: the thin layer between the UI and the app's logic. Each handler reads its arguments
//! and the managed state, calls into `domain` (or `infra`), and turns errors into the text the UI shows.
//! The command names, argument names and reply shapes are the contract with `src/lib/ipc.ts`.

pub(crate) mod accounts;
pub(crate) mod agents;
pub(crate) mod api_engine;
pub(crate) mod auth;
pub(crate) mod chats;
pub(crate) mod claude_account;
pub(crate) mod devops;
pub(crate) mod files;
pub(crate) mod jobs;
pub(crate) mod plugins;
pub(crate) mod projects;
pub(crate) mod settings;
pub(crate) mod share;
pub(crate) mod skills;
pub(crate) mod system;
pub(crate) mod usage;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) type CmdResult<T> = Result<T, String>;

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The app's data folder.
pub(crate) fn app_data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_data_dir().map_err(err)
}
