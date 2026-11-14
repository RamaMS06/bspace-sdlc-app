//! The user's own skills (the Skills screen), and adding skills from a GitHub link.

use super::{app_data_dir, CmdResult};
use crate::domain::skills::github::{self, SkillDownload, SkillInstall, SkillPick};
use crate::domain::skills::{self, Skill, SkillDetail};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

fn skills_root(app: &AppHandle) -> CmdResult<PathBuf> {
    skills::root(&app_data_dir(app)?)
}

/// The user's own skills, on and off.
#[tauri::command]
pub(crate) fn skills_list(app: AppHandle) -> CmdResult<Vec<Skill>> {
    Ok(skills::list(&skills_root(&app)?))
}

#[tauri::command]
pub(crate) fn skill_read(app: AppHandle, id: String) -> CmdResult<SkillDetail> {
    skills::read(&skills_root(&app)?, &id)
}

/// Creates a skill (no `id`) or saves an existing one's description and instructions.
#[tauri::command]
pub(crate) fn skill_save(app: AppHandle, id: Option<String>, name: String, description: String, body: String) -> CmdResult<Skill> {
    let root = skills_root(&app)?;
    match id {
        Some(id) => skills::update(&root, &id, &description, &body),
        None => skills::create(&root, &name, &description, &body),
    }
}

#[tauri::command]
pub(crate) fn skill_set_enabled(app: AppHandle, id: String, enabled: bool) -> CmdResult<Skill> {
    skills::set_enabled(&skills_root(&app)?, &id, enabled)
}

#[tauri::command]
pub(crate) fn skill_delete(app: AppHandle, id: String) -> CmdResult<()> {
    skills::delete(&skills_root(&app)?, &id)
}

/// Adds a skill from a SKILL.md file or a folder with one.
#[tauri::command]
pub(crate) fn skill_import(app: AppHandle, path: String) -> CmdResult<Skill> {
    skills::import(&skills_root(&app)?, Path::new(&path))
}

/// Downloads the repo at a GitHub link and lists the skills in it. Only one download is kept.
#[tauri::command]
pub(crate) async fn skill_github_fetch(app: AppHandle, url: String) -> CmdResult<SkillDownload> {
    github::fetch(&app_data_dir(&app)?, &url).await
}

/// Adds the chosen skills from a download (each with its files), then removes the download.
#[tauri::command]
pub(crate) fn skill_github_install(app: AppHandle, id: String, picks: Vec<SkillPick>) -> CmdResult<SkillInstall> {
    github::install(&app_data_dir(&app)?, &id, picks)
}

/// Throws away a download the user closed without adding anything.
#[tauri::command]
pub(crate) fn skill_github_discard(app: AppHandle, id: String) -> CmdResult<()> {
    let dir = github::download_dir(&app_data_dir(&app)?, &id)?;
    let _ = std::fs::remove_dir_all(dir);
    Ok(())
}
