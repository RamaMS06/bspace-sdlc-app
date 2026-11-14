//! Plugins (the Skills screen's Plugins tab, see `domain::plugins`).

use super::{app_data_dir, err, CmdResult};
use crate::domain::agents::session::plugin_dir;
use crate::domain::plugins::{self, PluginInfo, Staged};
use crate::domain::{admin, devops};
use crate::infra::token_store::ApiKeys;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

/// Editing the SDLC plugin (installing, updating, removing or switching plugins) is for an admin only
/// (see `domain::admin`); everyone can read and use it, and add their own skills.
async fn admin_only(keys: &ApiKeys) -> CmdResult<()> {
    admin::require(&devops::status(keys).await?)
}

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
pub(crate) async fn plugin_stage_folder(app: AppHandle, keys: State<'_, ApiKeys>, path: String) -> CmdResult<Staged> {
    admin_only(&keys).await?;
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugins::stage(&root, Path::new(&path))).await.map_err(err)?
}

/// Unpacks a .zip of a plugin (or a repo of them), for the user to check before installing.
#[tauri::command]
pub(crate) async fn plugin_stage_zip(app: AppHandle, keys: State<'_, ApiKeys>, path: String) -> CmdResult<Staged> {
    admin_only(&keys).await?;
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugins::stage_zip(&root, &path)).await.map_err(err)?
}

/// Downloads a GitHub repo (or a folder in it) and reads the plugins in it, for the user to check.
#[tauri::command]
pub(crate) async fn plugin_stage_github(app: AppHandle, keys: State<'_, ApiKeys>, url: String) -> CmdResult<Staged> {
    admin_only(&keys).await?;
    plugins::stage_github(plugins_root(&app)?, &url).await
}

/// Installs what was staged (replacing older versions). New sessions load it.
#[tauri::command]
pub(crate) async fn plugin_install(app: AppHandle, keys: State<'_, ApiKeys>, id: String) -> CmdResult<Vec<PluginInfo>> {
    admin_only(&keys).await?;
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
pub(crate) async fn plugin_remove(app: AppHandle, keys: State<'_, ApiKeys>, name: String) -> CmdResult<Vec<PluginInfo>> {
    admin_only(&keys).await?;
    let root = plugins_root(&app)?;
    plugins::remove(&root, &name)?;
    Ok(listed(&app, &root))
}

#[tauri::command]
pub(crate) async fn plugin_set_enabled(app: AppHandle, keys: State<'_, ApiKeys>, name: String, enabled: bool) -> CmdResult<Vec<PluginInfo>> {
    admin_only(&keys).await?;
    let root = plugins_root(&app)?;
    plugins::set_enabled(&root, &name, enabled)?;
    Ok(listed(&app, &root))
}
