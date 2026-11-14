//! Where a chat's agent works: its project's folder, a folder the user attached, or its own folder
//! under the working folder. Also the folders the webview may load files from.

use crate::domain::projects;
use crate::infra::db::Db;
use std::path::{Path, PathBuf};

/// A chat id (or file name) that is safe to use as a single folder name.
pub(crate) fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

/// Where this chat's agent runs. `project_folder` is the recorded folder of the chat's
/// (known) project, when it has one: that folder is used as is, even if the working
/// folder has changed since, as long as it still exists. Every other chat runs inside
/// `working`.
pub(crate) fn resolve_cwd(working: &Path, chat_id: &str, project_folder: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(folder) = project_folder {
        if !folder.is_dir() {
            return Err(format!("This project's folder is missing: {}", folder.display()));
        }
        return Ok(folder.to_path_buf());
    }
    let cwd = if chat_id == "setup" {
        working.join(".buma").join("setup")
    } else {
        if !safe_segment(chat_id) {
            return Err("That chat isn't valid".into());
        }
        working.join(".buma").join("chats").join(chat_id)
    };
    std::fs::create_dir_all(working).map_err(|e| format!("Can't create the working folder: {e}"))?;
    if !projects::ensure_inside(working, &cwd) {
        return Err("The agent can only work inside your working folder".into());
    }
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Can't create {}: {e}", cwd.display()))?;
    Ok(cwd)
}

/// The folder a chat's agent works in when it isn't the default: its project's, else a folder the user
/// attached to the chat.
pub(crate) fn chat_folder(db: &Db, chat_id: &str) -> Result<Option<PathBuf>, String> {
    let chat = db.get_chat(chat_id).map_err(|e| e.to_string())?;
    let attached = chat.as_ref().and_then(|c| c.folder.clone());
    let Some(project_id) = chat.and_then(|c| c.project_id) else {
        return Ok(attached.map(PathBuf::from));
    };
    let project = db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("This chat's project no longer exists")?;
    Ok(Some(PathBuf::from(project.folder)))
}

/// The folder a chat's agent works in: `chat_folder`, else its own folder under `working`.
pub(crate) fn chat_cwd(db: &Db, working: &Path, chat_id: &str) -> Result<PathBuf, String> {
    let folder = chat_folder(db, chat_id)?;
    resolve_cwd(working, chat_id, folder.as_deref())
}

/// A project's folder, by its id.
pub(crate) fn project_folder(db: &Db, project_id: &str) -> Result<PathBuf, String> {
    db.get_project(project_id)
        .map_err(|e| e.to_string())?
        .map(|p| PathBuf::from(p.folder))
        .ok_or_else(|| "That project no longer exists".to_string())
}

/// Folders the webview may load files (attachments, images, workspace files) from: the working
/// folder plus every known project's own folder, which stays put when the working
/// folder changes. Nothing else is in the asset scope.
pub(crate) fn asset_folders(db: &Db, working: &str) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(working)];
    for p in db.list_projects().unwrap_or_default() {
        let folder = PathBuf::from(&p.folder);
        if folder.is_dir() && !out.contains(&folder) {
            out.push(folder);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Project, ProjectStatus};

    #[test]
    fn cwd_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path();
        let setup = resolve_cwd(w, "setup", None).unwrap();
        assert!(setup.ends_with(".buma/setup") || setup.ends_with(r".buma\setup"));
        assert!(setup.is_dir());
        let chat = resolve_cwd(w, "c1", None).unwrap();
        assert_eq!(chat, w.join(".buma").join("chats").join("c1"));
        let proj = w.join("my-feature");
        std::fs::create_dir(&proj).unwrap();
        assert_eq!(resolve_cwd(w, "c2", Some(&proj)).unwrap(), proj);
    }

    #[test]
    fn project_chats_keep_their_folder_after_the_working_folder_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let old_project = tmp.path().join("old-work").join("promo");
        std::fs::create_dir_all(&old_project).unwrap();
        let new_working = tmp.path().join("new-work");
        assert_eq!(resolve_cwd(&new_working, "c", Some(&old_project)).unwrap(), old_project);
        // A project folder that is gone is an error, not silently recreated.
        let gone = tmp.path().join("gone");
        assert!(resolve_cwd(&new_working, "c", Some(&gone)).is_err());
        assert!(!gone.exists());
    }

    #[test]
    fn cwd_rejects_escapes() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("work");
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir(&outside).unwrap();
        assert!(resolve_cwd(&w, "../x", None).is_err());
        assert!(resolve_cwd(&w, "a/../../x", None).is_err());
        let _ = outside;
    }

    #[test]
    fn asset_folders_are_working_plus_existing_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open_in_memory().unwrap();
        let kept = tmp.path().join("old").join("kept");
        std::fs::create_dir_all(&kept).unwrap();
        let mk = |id: &str, folder: &Path| Project {
            id: id.into(),
            title: id.into(),
            slug: id.into(),
            folder: folder.to_string_lossy().into_owned(),
            status: ProjectStatus::Draft,
            created_at: String::new(),
            updated_at: String::new(),
        };
        db.insert_project(&mk("a", &kept)).unwrap();
        db.insert_project(&mk("b", &tmp.path().join("missing"))).unwrap();
        let working = tmp.path().join("work");
        assert_eq!(asset_folders(&db, &working.to_string_lossy()), vec![working.clone(), kept]);
    }
}
