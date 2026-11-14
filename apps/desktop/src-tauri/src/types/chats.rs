//! Chats and their messages.

use serde::{Deserialize, Serialize};
use super::AgentId;

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
