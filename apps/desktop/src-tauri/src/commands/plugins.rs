//! Plugins (the Skills screen's Plugins tab, see `domain::plugins`).

use super::{app_data_dir, err, CmdResult};
use crate::domain::agents::session::plugin_dir;
use crate::domain::plugins::{self, PluginInfo, Staged};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn plugins_root(app: &AppHandle) -> CmdResult<PathBuf> {
    plugins::root(&app_data_dir(app)?)
}

fn bundled_plugin(app: &AppHandle) -> Option<PathBuf> {
    plugin_dir(app.path().resource_dir().ok().as_deref())
}

fn listed(app: &AppHandle, root: &Path) -> Vec<PluginInfo> {
    plugins::list(root, bundled_plugin(app).as_deref())
}

/// The bundled plugin and every installed one, with what is on.
#[tauri::command]
pub(crate) fn plugins_list(app: AppHandle) -> CmdResult<Vec<PluginInfo>> {
    Ok(listed(&app, &plugins_root(&app)?))
}

/// Reads a plugin (or a repo of them) from a folder, for the user to check before installing.
#[tauri::command]
pub(crate) async fn plugin_stage_folder(app: AppHandle, path: String) -> CmdResult<Staged> {
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugins::stage(&root, Path::new(&path))).await.map_err(err)?
}

/// Unpacks a .zip of a plugin (or a repo of them), for the user to check before installing.
#[tauri::command]
pub(crate) async fn plugin_stage_zip(app: AppHandle, path: String) -> CmdResult<Staged> {
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugins::stage_zip(&root, &path)).await.map_err(err)?
}

/// Downloads a GitHub repo (or a folder in it) and reads the plugins in it, for the user to check.
#[tauri::command]
pub(crate) async fn plugin_stage_github(app: AppHandle, url: String) -> CmdResult<Staged> {
    plugins::stage_github(plugins_root(&app)?, &url).await
}

/// Installs what was staged (replacing older versions). New sessions load it.
#[tauri::command]
pub(crate) fn plugin_install(app: AppHandle, id: String) -> CmdResult<Vec<PluginInfo>> {
    let root = plugins_root(&app)?;
    plugins::commit(&root, &id)?;
    Ok(listed(&app, &root))
}

#[tauri::command]
pub(crate) fn plugin_discard(app: AppHandle, id: String) -> CmdResult<()> {
    plugins::discard(&plugins_root(&app)?, &id)
}

/// Removes an installed plugin; an update of the bundled one goes back to the bundled version.
#[tauri::command]
pub(crate) fn plugin_remove(app: AppHandle, name: String) -> CmdResult<Vec<PluginInfo>> {
    let root = plugins_root(&app)?;
    plugins::remove(&root, &name)?;
    Ok(listed(&app, &root))
}

#[tauri::command]
pub(crate) fn plugin_set_enabled(app: AppHandle, name: String, enabled: bool) -> CmdResult<Vec<PluginInfo>> {
    let root = plugins_root(&app)?;
    plugins::set_enabled(&root, &name, enabled)?;
    Ok(listed(&app, &root))
}
