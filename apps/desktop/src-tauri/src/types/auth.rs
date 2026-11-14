//! Sign in (mirrors packages/shared/src/auth.ts).

use serde::{Deserialize, Serialize};

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
