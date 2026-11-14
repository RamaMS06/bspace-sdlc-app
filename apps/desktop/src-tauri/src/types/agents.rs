//! Coding agents: the agent list and what a running agent streams to the UI (updates, permission requests, questions).

use serde::{Deserialize, Serialize};
use super::ToolCallStatus;

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
