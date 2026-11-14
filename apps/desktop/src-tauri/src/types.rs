//! Serde mirrors of the TypeScript types in `packages/shared/src/types.ts`.
//! Field names are camelCase and string unions serialize to the exact TS literals.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Opencode,
    Gemini,
    Codex,
    Antigravity,
    Cursor,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: AgentId,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub acp_command: Vec<String>,
    pub recommended: bool,
    /// The agent's own sign-in is saved on this computer (its credentials file). Claude signs in
    /// through Buma's own folder (`claude_account`), so it is false here.
    #[serde(default)]
    pub signed_in: bool,
    /// Who is signed in: the email of the ChatGPT or Google account, or what the key is for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OsKind {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Brew,
    Winget,
    Apt,
    Dnf,
    Pacman,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: OsKind,
    pub os_version: String,
    pub package_manager: Option<PackageManager>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolId {
    #[serde(rename = "node")]
    Node,
    #[serde(rename = "git")]
    Git,
    #[serde(rename = "python")]
    Python,
    #[serde(rename = "figma-mcp")]
    FigmaMcp,
    #[serde(rename = "figma")]
    Figma,
    #[serde(rename = "flutter")]
    Flutter,
    #[serde(rename = "word")]
    Word,
    #[serde(rename = "azure-cli")]
    AzureCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: ToolId,
    pub name: String,
    pub required: bool,
    pub found: bool,
    pub version: Option<String>,
    pub ok: bool,
    pub detail: String,
}

/// The language of Buma's own interface, not of the work it does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    Id,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Draft,
    Building,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub folder: String,
    pub status: ProjectStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub project_id: Option<String>,
    pub agent_id: AgentId,
    pub title: String,
    pub created_at: String,
    /// A folder the user attached to this chat (composer › Add folder): its agent works there.
    #[serde(default)]
    pub folder: Option<String>,
}

/// A chat in the sidebar's Recent list: its project's title, and when anything last happened in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentChat {
    pub id: String,
    pub project_id: Option<String>,
    pub agent_id: AgentId,
    pub title: String,
    pub created_at: String,
    pub project_title: Option<String>,
    /// The newest message's time, or the chat's own when it has none (RFC 3339).
    pub active_at: String,
    /// When the thread was archived (RFC 3339); only set in the archive's list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MessagePart {
    Text {
        text: String,
    },
    Mention {
        project_id: String,
        title: String,
    },
    File {
        path: String,
        name: String,
        mime: String,
        size: u64,
        /// When the file was last written (an image the agent made): the UI reloads a rewritten one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        modified_at: Option<String>,
    },
    Tool {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        /// The ACP tool kind (`read`, `edit`, `execute` ...), when the agent said.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_kind: Option<String>,
        /// The first file the tool touches.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Thought {
        text: String,
    },
    A2ui {
        surface_id: String,
        messages: Vec<serde_json::Value>,
    },
    #[serde(rename = "a2ui-action")]
    A2uiAction {
        summary: String,
        action: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: MessageRole,
    pub parts: Vec<MessagePart>,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Build,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobStatus {
    Queued,
    Working,
    NeedsYou,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
    pub project_id: Option<String>,
    pub chat_id: Option<String>,
    pub agent_id: AgentId,
    pub status: JobStatus,
    pub progress: Option<f64>,
    pub note: Option<String>,
    pub updated_at: String,
    /// When the card was archived off the board (RFC 3339). Only the database sets it: a write from the UI
    /// never carries it, and a card whose status changes comes back on the board.
    #[serde(default)]
    pub archived_at: Option<String>,
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
    pub api_provider: Option<crate::api_engine::ApiProvider>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentUpdate {
    Text {
        text: String,
    },
    Thought {
        text: String,
    },
    Tool {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_kind: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Done {
        stop_reason: String,
    },
    Error {
        message: String,
    },
    /// The models the agent offers for this session and the one in use (sent when the session
    /// starts and whenever the model changes).
    Models {
        current: Option<String>,
        options: Vec<ModelChoice>,
    },
}

/// One model an agent offers: `value` is what the agent is told, `name` what the user reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub value: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionOption {
    pub id: String,
    pub label: String,
    pub kind: PermissionOptionKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub chat_id: String,
    pub request_id: String,
    pub title: String,
    pub commands: Vec<String>,
    pub options: Vec<PermissionOption>,
}

/// A question the agent asks the user through ACP (`elicitation/create`, form mode): a message
/// and the JSON Schema of the answer (`properties` with `oneOf` options, multi-select arrays,
/// free text). The UI draws it as a card; the answer goes back with `agent_respond_question`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuestion {
    pub chat_id: String,
    pub request_id: String,
    pub message: String,
    pub schema: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_id_and_job_kind_literals() {
        assert_eq!(serde_json::to_value(ToolId::FigmaMcp).unwrap(), json!("figma-mcp"));
        assert_eq!(serde_json::to_value(JobKind::Build).unwrap(), json!("build"));
        assert_eq!(serde_json::to_value(JobStatus::NeedsYou).unwrap(), json!("needs-you"));
    }

    #[test]
    fn message_part_a2ui_round_trips() {
        let v = json!({"type":"a2ui","surfaceId":"s","messages":[]});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2ui { surface_id, .. } if surface_id == "s"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
        let v = json!({"type":"a2ui-action","summary":"Picked: A","action":{"version":"v0.9"}});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2uiAction { summary, .. } if summary == "Picked: A"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn message_part_file_round_trips() {
        let v = json!({"type":"file","path":"/w/attachments/a.pdf","name":"a.pdf",
            "mime":"application/pdf","size":2048});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::File { size: 2048, modified_at: None, .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
        // An image the agent made keeps its time.
        let v = json!({"type":"file","path":"/w/p/a.png","name":"a.png","mime":"image/png","size":3,
            "modifiedAt":"2026-11-04T10:00:00.000Z"});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::File { modified_at: Some(_), .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn agent_update_tool_round_trips() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Run","status":"running"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let d = json!({"kind":"done","stopReason":"end_turn"});
        let u: AgentUpdate = serde_json::from_value(d.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), d);
    }

    #[test]
    fn tool_kind_and_path_are_optional_and_camel_case() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let part = json!({"type":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let p: MessagePart = serde_json::from_value(part.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), part);
        let t = json!({"type":"thought","text":"hmm"});
        let p: MessagePart = serde_json::from_value(t.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), t);
    }

}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub label: String,
    pub window: UsageWindow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UsageStatus {
    Ok,
    SignedOut,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub agent_id: AgentId,
    pub status: UsageStatus,
    pub session: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
    pub model_weekly: Option<ModelUsage>,
    pub updated_at: String,
    pub message: Option<String>,
    /// For agents without plan limits (opencode): what they used today and over the last 7 days.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spend: Option<SpendSummary>,
    /// Which account of the agent these numbers are for (`default` or an extra account's id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Who is signed in to it (an email), when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

/// Replies, tokens (input, output and reasoning; cached reads left out) and cost over a period.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spend {
    pub replies: u64,
    pub tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendSummary {
    pub today: Spend,
    pub week: Spend,
}

// ---- sign in (mirrors packages/shared/src/auth.ts) ----

/// The signed-in account (`GET /v1/me`). Plan and features stay strings so a new one from the
/// API never breaks parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub plan: String,
    #[serde(default)]
    pub features: Vec<String>,
    /// AI credits a month that come with the plan. Missing in accounts cached before credits existed.
    #[serde(default)]
    pub credits: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthState {
    SignedIn,
    SignedOut,
    Pending,
    Error,
}

/// Why signing in stopped or couldn't start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthError {
    /// The code ran out before it was approved.
    Expired,
    /// The user (or Google) said no.
    Denied,
    /// The API couldn't be reached.
    Network,
    /// The API answered something unexpected (wrong address, server error).
    Server,
    /// Too many sign-in attempts from this network.
    RateLimited,
    /// The token couldn't be saved on this computer.
    Storage,
    /// The API address is plain http to another computer, so a token would travel unencrypted.
    Insecure,
    /// The keychain refused to keep the token (the user clicked Deny, or it stayed locked).
    Keychain,
}

/// `auth_status()` and the `auth://changed` event. Never carries the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub state: AuthState,
    pub signed_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<Account>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AuthError>,
    /// Signed in, but the API couldn't be reached to confirm it; `account` is the cached one.
    pub offline: bool,
    /// The API base this state belongs to.
    pub api_url: String,
}

/// `auth_start()`: what the sign-in dialog shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStart {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
}
