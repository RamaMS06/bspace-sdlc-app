//! App settings.

use serde::{Deserialize, Serialize};
use super::AgentId;

/// The language of Buma's own interface, not of the work it does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    Id,
    En,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub working_folder: String,
    pub default_agent: AgentId,
    pub onboarded: bool,
    /// Base URL of the optional Buma API; `BUMA_API_URL` overrides it at read time
    /// (`styles_sync::effective_api_url`) without being stored. The Settings screen saves an
    /// empty field as the default URL.
    pub api_url: String,
    /// Random uuid v4 made on first run (empty until then); never derived from the machine.
    pub install_id: String,
    /// Sends the anonymous daily install ping.
    pub share_install_stats: bool,
    /// RFC 3339 time of the last successful ping.
    pub last_ping_at: Option<String>,
    /// Chats start in auto mode: the agent runs commands without asking.
    #[serde(default)]
    pub auto_mode: bool,
    /// Language of the interface. `None` until the first run, when the UI picks one from the
    /// system language and saves it.
    #[serde(default)]
    pub ui_language: Option<UiLanguage>,
    /// Closing the window hides it to the tray instead of quitting.
    #[serde(default)]
    pub background_mode: bool,
    /// Start Buma when the user logs in; only meaningful while `background_mode` is on.
    #[serde(default)]
    pub open_at_login: bool,
    /// The model picked for each agent (agent id → the agent's own model value). Missing: the
    /// agent's own default.
    #[serde(default)]
    pub agent_models: std::collections::BTreeMap<String, String>,
    /// "Your API" (the `custom` agent): the provider, address and model. The key is in the keychain.
    #[serde(default)]
    pub api_provider: Option<ApiProvider>,
}

/// The provider the user set up. `provider` is the preset the UI picked (`deepseek`, `9router`,
/// `commandcode`, `other`) and only names it; `base_url` is what is called.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiProvider {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    /// Every model the key can use (from the check), offered in the chat's model menu.
    #[serde(default)]
    pub models: Vec<String>,
}
