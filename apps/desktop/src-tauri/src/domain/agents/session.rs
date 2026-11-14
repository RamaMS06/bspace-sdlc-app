//! How Buma opens an agent session for a chat: the Buma plugin and system prompt for Claude, the
//! environment, auto mode and the usage log; and short probe sessions that only sign in or read models.

use crate::domain::acp::{AcpManager, AcpSink, SessionOptions, UsageLog};
use crate::types::{AgentId, AgentUpdate, PermissionRequest};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Added to Claude's system prompt for sessions Buma starts.
pub(crate) const BUMA_APPEND: &str = "You are running inside BSpace SDLC, BUMA's desktop app for taking a feature from \
idea to deploy, with the bspace-sdlc-skills plugin. Answer ordinary messages (a question, a quick task, a chat) \
normally: do not invoke a skill, and never start or restart an SDLC workflow, unless the user types a skill's /name \
or asks for what a skill does. The using-bspace-sdlc skill starts only when the user types /using-bspace-sdlc, or when \
this chat is already a feature (its folder has an AGENTS.md brief). When the user has to choose, ask with your \
AskUserQuestion tool: Buma shows it as a card with the options. Never write JSON or markup for a choice.";

/// The Buma agent plugin in the repo, used when the bundled copy is missing (`tauri dev`).
/// Debug builds only: a release build must never reach into the build machine's checkout.
fn dev_plugin_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("skills")
        .join("agent-plugin");
    dir.join(".claude-plugin").join("plugin.json").is_file().then_some(dir)
}

/// The repo copy in debug builds (it is the one being edited; the build's copy in target/ goes stale,
/// a skill deleted from the repo stays there), else `<resource dir>/agent-plugin` when it holds the plugin.
/// `None` means Claude starts without the plugin, and the skills go into its first prompt instead.
pub(crate) fn plugin_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let found = dev_plugin_dir().or_else(|| {
        resource_dir
            .map(|r| r.join("agent-plugin"))
            .filter(|p| p.join(".claude-plugin").join("plugin.json").is_file())
    });
    if found.is_none() {
        eprintln!(
            "[buma] warning: agent-plugin/.claude-plugin/plugin.json is missing from the app resources; \
             Claude gets the Buma skills in its first prompt instead"
        );
    }
    found
}

/// The internal session (the setup installs) never talks to the user in a chat, so it gets neither
/// the plugin nor the system prompt.
pub(crate) fn wants_skills(chat_id: &str) -> bool {
    chat_id != "setup"
}

/// What a chat is for, as the usage log names it.
pub(crate) fn chat_kind(chat_id: &str, has_project: bool) -> &'static str {
    if chat_id == "setup" {
        "setup"
    } else if has_project {
        "project"
    } else {
        "chat"
    }
}

/// opencode logs a failed model call (a free model's usage limit) and then never answers the prompt:
/// its log, for the session to watch. None for other agents.
fn error_log(agent: AgentId) -> Option<PathBuf> {
    if !matches!(agent, AgentId::Opencode | AgentId::Custom) {
        return None;
    }
    let home = crate::infra::exec::home_dir()?;
    let db = crate::domain::usage::opencode_db(&home, std::env::var("XDG_DATA_HOME").ok().as_deref());
    Some(db.parent()?.join("log").join("opencode.log"))
}

/// Claude gets the plugin and the system prompt through `_meta` (so nothing is
/// installed in the user's own `~/.claude`); every agent gets `BSPACE_SDLC_APP=1`.
/// Without `skills` (internal sessions) there is no `_meta` at all.
pub(crate) fn session_options(agent: AgentId, plugin: Option<&Path>, skills: bool) -> SessionOptions {
    let env = vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())];
    let use_modes = agent == AgentId::Claude;
    if agent != AgentId::Claude || !skills {
        return SessionOptions { meta: None, authenticate: None, env, auto: false, use_modes, mode_timeout: None, model: None, error_log: error_log(agent), usage_log: None };
    }
    let mut meta = serde_json::json!({ "systemPrompt": { "append": BUMA_APPEND } });
    if let Some(path) = plugin {
        meta["claudeCode"] = serde_json::json!({
            "options": { "plugins": [{ "type": "local", "path": path.to_string_lossy() }] }
        });
    }
    SessionOptions { meta: Some(meta), authenticate: None, env, auto: false, use_modes, mode_timeout: None, model: None, error_log: error_log(agent), usage_log: None }
}

/// Adds a local plugin to a Claude session that has `_meta` (sessions without it get no plugins).
fn add_plugin(options: &mut SessionOptions, path: &Path) {
    let Some(meta) = options.meta.as_mut() else { return };
    let entry = serde_json::json!({ "type": "local", "path": path.to_string_lossy() });
    match meta["claudeCode"]["options"]["plugins"].as_array_mut() {
        Some(list) => list.push(entry),
        None => meta["claudeCode"] = serde_json::json!({ "options": { "plugins": [entry] } }),
    }
}

/// An agent's settings key, such as `claude` (its serialized id).
pub(crate) fn agent_key(agent: AgentId) -> String {
    serde_json::to_value(agent).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

/// The install chat never runs in auto mode (installs need the user's approval); other chats follow
/// the chat's Auto toggle.
pub(crate) fn wants_auto(chat_id: &str, requested: bool) -> bool {
    chat_id != "setup" && requested
}

/// Claude without the plugin has no skills unless the first prompt carries them.
pub(crate) fn needs_skills_text(agent: AgentId, plugin: Option<&Path>) -> bool {
    agent == AgentId::Claude && plugin.is_none()
}

/// What a chat's session starts with, besides the agent's command.
pub(crate) struct ChatSession<'a> {
    pub agent: AgentId,
    pub chat_id: &'a str,
    /// The app data folder (installed plugins, the user's skills, the usage log), when known.
    pub data: Option<&'a Path>,
    /// The app's resource folder, which holds the bundled plugin.
    pub resource_dir: Option<&'a Path>,
    /// The chat runs in a project's (or an attached) folder rather than its own.
    pub has_folder: bool,
    pub auto: bool,
    pub model: Option<String>,
    /// The account's and the launch's environment, in that order.
    pub env: Vec<(String, String)>,
    /// The AI image endpoint's environment for this session, set last.
    pub proxy_env: Vec<(String, String)>,
}

impl ChatSession<'_> {
    /// The session options, and whether Claude started without the Buma plugin, so the caller must
    /// send the skills as text in the first prompt (other agents always get them that way).
    pub(crate) fn options(self) -> (SessionOptions, bool) {
        let skills = wants_skills(self.chat_id);
        let claude = self.agent == AgentId::Claude && skills;
        // Every plugin that is on: the bundled bspace-sdlc-skills (unless an installed update replaces it)
        // and the ones installed on the Skills screen.
        let plugins: Vec<PathBuf> = if claude {
            let bundled = plugin_dir(self.resource_dir);
            match self.data.and_then(|d| crate::domain::plugins::root(d).ok()) {
                Some(root) => crate::domain::plugins::active_paths(&root, bundled.as_deref()),
                None => bundled.into_iter().collect(),
            }
        } else {
            Vec::new()
        };
        let plugin = plugins.first().cloned();
        let mut options = session_options(self.agent, plugin.as_deref(), skills);
        for more in plugins.iter().skip(1) {
            add_plugin(&mut options, more);
        }
        // The user's own skills (the Skills screen) load as a second plugin.
        if claude {
            if let Some(mine) = self.data.and_then(|d| crate::domain::skills::root(d).ok()).and_then(|r| crate::domain::skills::plugin(&r)) {
                add_plugin(&mut options, &mine);
            }
        }
        options.env.extend(self.env);
        options.auto = wants_auto(self.chat_id, self.auto);
        options.model = self.model;
        options.usage_log = self.data.map(|dir| UsageLog {
            path: dir.join("agent-usage.jsonl"),
            agent: agent_key(self.agent),
            kind: chat_kind(self.chat_id, self.has_folder).to_string(),
        });
        // AI images with the user's credits: this session's own token for Buma's endpoint.
        options.env.extend(self.proxy_env);
        (options, skills && needs_skills_text(self.agent, plugin.as_deref()))
    }
}

/// Never shows anything: a probe session's updates go nowhere.
struct QuietSink;
impl AcpSink for QuietSink {
    fn update(&self, _chat_id: &str, _u: AgentUpdate) {}
    fn permission(&self, _req: PermissionRequest) {}
}

/// Runs a short session `probe` in a scratch folder under `cache_dir` (to sign in, or to read the
/// models before any chat with the agent has run), hands it to `read`, then stops it.
pub(crate) async fn probe<T>(
    acp: &AcpManager,
    cache_dir: &Path,
    probe: &str,
    command: &[String],
    options: SessionOptions,
    read: impl FnOnce(&AcpManager, &str) -> T,
) -> Result<T, String> {
    let cwd = cache_dir.join("model-probe");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let started = acp.start_with(probe, command, &cwd, Arc::new(QuietSink), options).await;
    let out = started.map(|()| read(acp, probe));
    let _ = acp.stop(probe).await;
    out.map_err(|e| e.to_string())
}


#[cfg(test)]
mod tests {
    #[test]
    fn claudes_system_prompt_leaves_ordinary_messages_alone() {
        // Only a typed /name, a request for what a skill does, or a chat that already is a feature starts a skill.
        assert!(super::BUMA_APPEND.contains("Answer ordinary messages"));
        assert!(super::BUMA_APPEND.contains("never start or restart an SDLC workflow"));
        assert!(super::BUMA_APPEND.contains("only when the user types /using-bspace-sdlc"));
        assert!(!super::BUMA_APPEND.contains("start from the using-bspace-sdlc skill, which routes"));
    }

    use super::*;

    #[test]
    fn chat_kind_names_what_the_chat_is_for() {
        assert_eq!(chat_kind("setup", false), "setup");
        assert_eq!(chat_kind("abc", true), "project");
        assert_eq!(chat_kind("abc", false), "chat");
    }

    #[test]
    fn session_options_for_claude_load_the_plugin() {
        let plugin = PathBuf::from("/res/agent-plugin");
        let o = session_options(AgentId::Claude, Some(&plugin), true);
        assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
        let meta = o.meta.unwrap();
        let path = meta["claudeCode"]["options"]["plugins"][0]["path"].as_str().unwrap();
        assert_eq!(PathBuf::from(path), plugin);
        assert_eq!(meta["claudeCode"]["options"]["plugins"][0]["type"], "local");
        assert_eq!(meta["systemPrompt"]["append"], BUMA_APPEND);
    }

    #[test]
    fn session_options_for_other_agents_only_set_env() {
        for id in [AgentId::Opencode, AgentId::Codex, AgentId::Gemini] {
            let o = session_options(id, Some(Path::new("/x")), true);
            assert!(o.meta.is_none());
            assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
        }
    }

    #[test]
    fn the_users_skills_load_as_a_second_plugin() {
        let mut o = session_options(AgentId::Claude, Some(Path::new("/res/agent-plugin")), true);
        add_plugin(&mut o, Path::new("/data/user-skills"));
        let plugins = &o.meta.unwrap()["claudeCode"]["options"]["plugins"];
        assert_eq!(plugins[1]["path"], "/data/user-skills");
        assert_eq!(plugins[1]["type"], "local");

        let mut alone = session_options(AgentId::Claude, None, true);
        add_plugin(&mut alone, Path::new("/data/user-skills"));
        assert_eq!(alone.meta.unwrap()["claudeCode"]["options"]["plugins"][0]["path"], "/data/user-skills");

        let mut internal = session_options(AgentId::Claude, None, false);
        add_plugin(&mut internal, Path::new("/data/user-skills"));
        assert!(internal.meta.is_none());
    }

    #[test]
    fn claude_without_a_plugin_folder_still_gets_the_append() {
        let o = session_options(AgentId::Claude, None, true);
        let meta = o.meta.unwrap();
        assert!(meta["claudeCode"].is_null());
        assert_eq!(meta["systemPrompt"]["append"], BUMA_APPEND);
    }

    #[test]
    fn plugin_dir_is_the_repo_copy_in_debug_builds_else_the_bundled_one() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("agent-plugin").join(".claude-plugin");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("plugin.json"), "{}").unwrap();
        let expected = if cfg!(debug_assertions) { dev_plugin_dir() } else { Some(tmp.path().join("agent-plugin")) };
        assert_eq!(plugin_dir(Some(tmp.path())), expected);
    }

    #[test]
    fn the_system_prompt_asks_with_the_question_tool_not_a2ui() {
        assert!(BUMA_APPEND.contains("AskUserQuestion"));
        assert!(!BUMA_APPEND.to_lowercase().contains("a2ui"));
    }

    #[test]
    fn dev_plugin_folder_exists_in_the_repo() {
        // Only debug builds look in the repo; a release build must use its bundled copy.
        assert_eq!(dev_plugin_dir().is_some(), cfg!(debug_assertions));
    }

    #[test]
    fn internal_sessions_get_no_meta() {
        assert!(!wants_skills("setup"));
        assert!(wants_skills("c1"));
    }

    #[test]
    fn auto_mode_rules() {
        assert!(!wants_auto("setup", true));
        assert!(wants_auto("c1", true));
        assert!(!wants_auto("c1", false));
    }

    #[test]
    fn internal_sessions_get_no_meta_options() {
        let o = session_options(AgentId::Claude, Some(Path::new("/p")), false);
        assert!(o.meta.is_none());
        assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
    }

    #[test]
    fn claude_without_the_plugin_gets_the_skills_as_text() {
        assert!(needs_skills_text(AgentId::Claude, None));
        assert!(!needs_skills_text(AgentId::Claude, Some(Path::new("/p"))));
        // Other agents get them as text anyway; the app decides that itself.
        assert!(!needs_skills_text(AgentId::Codex, None));
    }
}
