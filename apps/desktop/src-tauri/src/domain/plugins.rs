//! Claude Code plugins in the app, like Claude Desktop's: the bundled bspace-sdlc-skills plugin and the
//! ones the user installs from a folder, a .zip or a GitHub link. Each lives in
//! `<app data>/plugins/<name>/` with its `.claude-plugin/plugin.json`, `skills/` and `hooks/`.
//!
//! Installing is two steps so the user sees what a plugin brings (its skills and the hook commands it
//! will run on this computer) before it is used: `stage_*` copies what was found into
//! `plugins/.staging/<id>/`, then `commit` moves it into place (replacing an older version) or
//! `discard` drops it. An installed plugin named like the bundled one replaces it, which is how the
//! bundled plugin is updated as is. Plugins can be turned off; `active_paths` is what a session loads.
use crate::domain::skills::github;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkill {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: Option<String>,
    pub description: String,
    /// `bundled` (ships with the app) or `installed`.
    pub source: String,
    pub enabled: bool,
    /// The bundled plugin is replaced by an installed one with its name.
    pub replaced: bool,
    pub skills: Vec<PluginSkill>,
    /// The commands its hooks run (hooks/hooks.json).
    pub hooks: Vec<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub id: String,
    pub plugins: Vec<PluginInfo>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    disabled: Vec<String>,
}

const STAGING: &str = ".staging";
/// Never searched or copied: VCS and build folders, and `.claude` (agent worktrees hold stale plugin copies).
const SKIP: &[&str] = &[".git", ".claude", "node_modules", ".staging", "target", "dist"];

pub fn root(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join("plugins");
    fs::create_dir_all(&dir).map_err(|e| format!("Can't create the plugins folder: {e}"))?;
    Ok(dir)
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && name != "." && name != ".."
}

fn read_state(root: &Path) -> State {
    fs::read_to_string(root.join("state.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_state(root: &Path, state: &State) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(root.join("state.json"), text).map_err(|e| format!("Can't save the plugin settings: {e}"))
}

/// Every `command` string in a hooks.json, wherever it sits.
fn hook_commands(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            if let Some(c) = m.get("command").and_then(|c| c.as_str()) {
                out.push(c.to_string());
            }
            m.values().for_each(|x| hook_commands(x, out));
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| hook_commands(x, out)),
        _ => {}
    }
}

/// Reads a plugin folder; None when it has no valid `.claude-plugin/plugin.json`.
pub fn read_plugin(dir: &Path, source: &str) -> Option<PluginInfo> {
    let manifest: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join(".claude-plugin/plugin.json")).ok()?).ok()?;
    let name = manifest.get("name")?.as_str()?.to_string();
    if !safe_name(&name) {
        return None;
    }
    let mut skills: Vec<PluginSkill> = fs::read_dir(dir.join("skills"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let text = fs::read_to_string(e.path().join("SKILL.md")).ok()?;
            let text = text.trim_start_matches('\u{feff}');
            let (n, d) = crate::domain::skills::name_and_description(text);
            Some(PluginSkill { id: n.unwrap_or_else(|| e.file_name().to_string_lossy().into_owned()), description: d.unwrap_or_default() })
        })
        .collect();
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    let mut hooks = Vec::new();
    if let Some(v) = fs::read_to_string(dir.join("hooks/hooks.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
        hook_commands(&v, &mut hooks);
    }
    Some(PluginInfo {
        name,
        version: manifest.get("version").and_then(|v| v.as_str()).map(str::to_string),
        description: manifest.get("description").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        source: source.to_string(),
        enabled: true,
        replaced: false,
        skills,
        hooks,
        path: dir.to_string_lossy().into_owned(),
    })
}

/// Plugin folders under `dir` (itself included), a few levels deep: a plugin, a marketplace repo
/// (`plugins/<name>/`), or an archive's top folder around either.
pub fn find_plugins(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if dir.join(".claude-plugin/plugin.json").is_file() {
            out.push(dir.to_path_buf());
            return;
        }
        if depth == 0 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else { return };
        let mut subs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        subs.sort();
        for p in subs {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if !SKIP.contains(&name.as_str()) {
                walk(&p, depth - 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, 4, &mut out);
    out
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let name = e.file_name();
        if SKIP.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let ty = e.file_type()?;
        if ty.is_dir() {
            copy_dir(&e.path(), &to.join(&name))?;
        } else if ty.is_file() {
            fs::copy(e.path(), to.join(&name))?;
        }
    }
    Ok(())
}

/// Copies the plugins found under `source` into a new staging folder and describes them.
pub fn stage(root: &Path, source: &Path) -> Result<Staged, String> {
    let found = find_plugins(source);
    if found.is_empty() {
        return Err("No plugin there: a plugin folder has .claude-plugin/plugin.json".into());
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let dest = root.join(STAGING).join(&id);
    let mut plugins = Vec::new();
    for dir in found {
        let Some(info) = read_plugin(&dir, "installed") else { continue };
        if plugins.iter().any(|p: &PluginInfo| p.name == info.name) {
            continue;
        }
        let to = dest.join(&info.name);
        copy_dir(&dir, &to).map_err(|e| format!("Can't copy {}: {e}", info.name))?;
        plugins.push(PluginInfo { path: to.to_string_lossy().into_owned(), ..info });
    }
    if plugins.is_empty() {
        let _ = fs::remove_dir_all(&dest);
        return Err("The plugin's plugin.json needs a name made of letters, digits, - or _".into());
    }
    Ok(Staged { id, plugins })
}

fn staged_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !safe_name(id) {
        return Err("Unknown install".into());
    }
    Ok(root.join(STAGING).join(id))
}

/// Moves a staged install into place, replacing older versions, and turns those plugins on.
pub fn commit(root: &Path, id: &str) -> Result<Vec<String>, String> {
    let dir = staged_dir(root, id)?;
    let mut names = Vec::new();
    for e in fs::read_dir(&dir).map_err(|_| "That install is gone; add the plugin again".to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !safe_name(&name) {
            continue;
        }
        let to = root.join(&name);
        if to.exists() {
            fs::remove_dir_all(&to).map_err(|e| format!("Can't replace {name}: {e}"))?;
        }
        fs::rename(e.path(), &to).map_err(|e| format!("Can't install {name}: {e}"))?;
        names.push(name);
    }
    let _ = fs::remove_dir_all(&dir);
    let mut state = read_state(root);
    state.disabled.retain(|d| !names.contains(d));
    write_state(root, &state)?;
    Ok(names)
}

pub fn discard(root: &Path, id: &str) -> Result<(), String> {
    let _ = fs::remove_dir_all(staged_dir(root, id)?);
    Ok(())
}

/// Removes an installed plugin (the bundled one can only be turned off).
pub fn remove(root: &Path, name: &str) -> Result<(), String> {
    if !safe_name(name) {
        return Err("Unknown plugin".into());
    }
    let dir = root.join(name);
    if !dir.join(".claude-plugin/plugin.json").is_file() {
        return Err("That plugin isn't installed".into());
    }
    fs::remove_dir_all(dir).map_err(|e| format!("Can't remove {name}: {e}"))
}

pub fn set_enabled(root: &Path, name: &str, enabled: bool) -> Result<(), String> {
    let mut state = read_state(root);
    state.disabled.retain(|d| d != name);
    if !enabled {
        state.disabled.push(name.to_string());
    }
    write_state(root, &state)
}

/// The bundled plugin (when there is one) and every installed one, with what is on.
pub fn list(root: &Path, bundled: Option<&Path>) -> Vec<PluginInfo> {
    let state = read_state(root);
    let mut installed: Vec<PluginInfo> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir() && e.file_name() != STAGING)
        .filter_map(|e| read_plugin(&e.path(), "installed"))
        .collect();
    installed.sort_by(|a, b| a.name.cmp(&b.name));
    for p in &mut installed {
        p.enabled = !state.disabled.contains(&p.name);
    }
    let mut out = Vec::new();
    if let Some(mut b) = bundled.and_then(|d| read_plugin(d, "bundled")) {
        b.replaced = installed.iter().any(|p| p.name == b.name);
        b.enabled = !b.replaced && !state.disabled.contains(&b.name);
        out.push(b);
    }
    out.extend(installed);
    out
}

/// The plugin folders a Claude session loads: every plugin that is on.
pub fn active_paths(root: &Path, bundled: Option<&Path>) -> Vec<PathBuf> {
    list(root, bundled).into_iter().filter(|p| p.enabled).map(|p| PathBuf::from(p.path)).collect()
}

/// Unpacks a .zip of a plugin (or a repo of them) and stages what is in it.
pub(crate) fn stage_zip(root: &Path, path: &str) -> Result<Staged, String> {
    let bytes = fs::read(path).map_err(|e| format!("Can't read {path}: {e}"))?;
    let tmp = root.join(".staging").join(format!("zip-{}", uuid::Uuid::new_v4().simple()));
    let result = github::unpack(&bytes, &tmp).and_then(|_| stage(root, &tmp));
    let _ = fs::remove_dir_all(&tmp);
    result
}

/// Downloads a GitHub repo (or a folder in it) and stages the plugins in it.
pub(crate) async fn stage_github(root: PathBuf, url: &str) -> Result<Staged, String> {
    let link = github::parse_link(url)?;
    let too_big = format!("That repo is over {} MB, too big to add", github::DOWNLOAD_LIMIT / 1024 / 1024);
    let bytes = github::download(&link, &too_big).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = root.join(".staging").join(format!("gh-{}", uuid::Uuid::new_v4().simple()));
        let result = github::unpack(&bytes, &tmp).and_then(|_| {
            // The archive's top folder, then the folder the link points at.
            let top = fs::read_dir(&tmp).ok().and_then(|mut d| d.next()).and_then(|e| e.ok()).map(|e| e.path()).unwrap_or_else(|| tmp.clone());
            stage(&root, &top.join(&link.path))
        });
        let _ = fs::remove_dir_all(&tmp);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path, name: &str, version: &str) {
        fs::create_dir_all(dir.join(".claude-plugin")).unwrap();
        fs::write(dir.join(".claude-plugin/plugin.json"), format!(r#"{{"name":"{name}","version":"{version}","description":"d"}}"#)).unwrap();
        fs::create_dir_all(dir.join("skills/intake")).unwrap();
        fs::write(dir.join("skills/intake/SKILL.md"), "\u{feff}---\nname: intake\ndescription: Take stakeholder input\n---\nGo.\n").unwrap();
        fs::create_dir_all(dir.join("hooks")).unwrap();
        fs::write(dir.join("hooks/hooks.json"), r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"python3 hook.py"}]}]}}"#).unwrap();
    }

    #[test]
    fn stages_a_marketplace_repo_shows_skills_and_hooks_then_installs_it() {
        let data = tempfile::tempdir().unwrap();
        let root = root(data.path()).unwrap();
        let repo = data.path().join("repo");
        plugin(&repo.join("plugins/bspace-sdlc-skills"), "bspace-sdlc-skills", "1.0.9");
        let staged = stage(&root, &repo).unwrap();
        assert_eq!(staged.plugins.len(), 1);
        let p = &staged.plugins[0];
        assert_eq!((p.name.as_str(), p.version.as_deref()), ("bspace-sdlc-skills", Some("1.0.9")));
        assert_eq!(p.skills, vec![PluginSkill { id: "intake".into(), description: "Take stakeholder input".into() }]);
        assert_eq!(p.hooks, vec!["python3 hook.py".to_string()]);
        // Nothing is used until it is committed.
        assert!(list(&root, None).is_empty());
        assert_eq!(commit(&root, &staged.id).unwrap(), vec!["bspace-sdlc-skills".to_string()]);
        assert_eq!(list(&root, None).len(), 1);
        assert!(!root.join(STAGING).join(&staged.id).exists());
    }

    #[test]
    fn an_installed_plugin_replaces_the_bundled_one_of_the_same_name() {
        let data = tempfile::tempdir().unwrap();
        let root = root(data.path()).unwrap();
        let bundled = data.path().join("res/agent-plugin");
        plugin(&bundled, "bspace-sdlc-skills", "1.0.8");
        assert_eq!(active_paths(&root, Some(&bundled)), vec![bundled.clone()]);
        let src = data.path().join("new");
        plugin(&src, "bspace-sdlc-skills", "1.0.9");
        let staged = stage(&root, &src).unwrap();
        commit(&root, &staged.id).unwrap();
        let all = list(&root, Some(&bundled));
        assert!(all[0].replaced && !all[0].enabled);
        assert_eq!(active_paths(&root, Some(&bundled)), vec![root.join("bspace-sdlc-skills")]);
        // Removing the update brings the bundled version back.
        remove(&root, "bspace-sdlc-skills").unwrap();
        assert_eq!(active_paths(&root, Some(&bundled)), vec![bundled]);
    }

    #[test]
    fn plugins_can_be_turned_off_and_on() {
        let data = tempfile::tempdir().unwrap();
        let root = root(data.path()).unwrap();
        let bundled = data.path().join("res/agent-plugin");
        plugin(&bundled, "bspace-sdlc-skills", "1.0.8");
        set_enabled(&root, "bspace-sdlc-skills", false).unwrap();
        assert!(active_paths(&root, Some(&bundled)).is_empty());
        set_enabled(&root, "bspace-sdlc-skills", true).unwrap();
        assert_eq!(active_paths(&root, Some(&bundled)).len(), 1);
    }

    #[test]
    fn stages_the_real_bspace_fe_skills_repo_when_it_is_next_to_this_one() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../bspace-fe-skills");
        if !repo.join(".claude-plugin/marketplace.json").is_file() {
            return; // only on a machine with the sibling checkout
        }
        let data = tempfile::tempdir().unwrap();
        let root = root(data.path()).unwrap();
        let staged = stage(&root, &repo).unwrap();
        let p = staged.plugins.iter().find(|p| p.name == "bspace-sdlc-skills").unwrap();
        assert!(p.path.ends_with("bspace-sdlc-skills"));
        assert!(p.skills.iter().any(|s| s.id == "using-bspace-sdlc"));
        assert!(p.hooks.iter().any(|h| h.contains("office_state.py")));
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(repo.join("plugins/bspace-sdlc-skills/.claude-plugin/plugin.json")).unwrap()).unwrap();
        assert_eq!(p.version.as_deref(), manifest["version"].as_str(), "the plugin under plugins/, not a stale worktree copy");
    }

    #[test]
    fn refuses_a_folder_without_a_plugin_and_unsafe_names() {
        let data = tempfile::tempdir().unwrap();
        let root = root(data.path()).unwrap();
        fs::create_dir_all(data.path().join("empty")).unwrap();
        assert!(stage(&root, &data.path().join("empty")).is_err());
        let bad = data.path().join("bad");
        plugin(&bad, "../evil", "1");
        assert!(stage(&root, &bad).is_err());
        assert!(commit(&root, "../x").is_err());
        assert!(remove(&root, "..").is_err());
    }
}
