//! Board cards (jobs).

use serde::{Deserialize, Serialize};
use super::AgentId;

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
