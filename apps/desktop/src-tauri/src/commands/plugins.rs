//! Plugins (the Skills screen's Plugins tab, see `domain::plugins`).

use super::{app_data_dir, err, CmdResult};
use crate::domain::agents::session::plugin_dir;
use crate::domain::plugins::{self, PluginInfo, Staged};
use crate::domain::{admin, devops, plugin_sync};
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

/// Where the bundled SDLC plugin is on disk. Agents that can't load it as a plugin (Codex and others) read
/// its skills from there when the entry skill sends them to one.
#[tauri::command]
pub(crate) fn plugin_root(app: AppHandle) -> Option<String> {
    bundled_plugin(&app).map(|p| p.to_string_lossy().into_owned())
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

/// Whether `main` of the plugin's repo has a version ahead of the one in use. Anyone signed in can ask.
#[tauri::command]
pub(crate) async fn plugin_sync_check(app: AppHandle, keys: State<'_, ApiKeys>) -> CmdResult<plugin_sync::SyncStatus> {
    let (profile, auth) = devops::authorization(&keys).await?;
    let current = plugin_sync::in_use(&plugins_root(&app)?, bundled_plugin(&app).as_deref());
    plugin_sync::check(&plugin_sync::Source::company(&profile.org), &auth, current).await
}

/// Installs `main`'s version of the SDLC plugin when it is ahead of the one in use. The source is fixed
/// (the company repo), so this is open to everyone signed in, unlike installing an arbitrary plugin.
#[tauri::command]
pub(crate) async fn plugin_sync_apply(app: AppHandle, keys: State<'_, ApiKeys>) -> CmdResult<Vec<PluginInfo>> {
    let (profile, auth) = devops::authorization(&keys).await?;
    let root = plugins_root(&app)?;
    plugin_sync::apply(&plugin_sync::Source::company(&profile.org), &auth, &root, bundled_plugin(&app).as_deref()).await?;
    Ok(listed(&app, &root))
}
