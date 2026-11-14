//! Agent usage limits and spend.

use serde::{Deserialize, Serialize};
use super::AgentId;

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
