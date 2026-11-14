//! The HTTP clients Buma makes its requests with. Each says who is calling (`bspace-sdlc-app/<version>`).

use std::time::Duration;

const USER_AGENT: &str = concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION"));

/// Per-request timeout of `no_redirect_client`.
const NO_REDIRECT_TIMEOUT: Duration = Duration::from_secs(15);

/// A client whose every request must finish within `timeout`.
pub(crate) fn client(timeout: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder().timeout(timeout).user_agent(USER_AGENT).build()
}

/// For large downloads on slow connections: no overall timeout, only a connect one.
pub(crate) fn download_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).user_agent(USER_AGENT).build()
}

/// The client for every sign-in call (the Buma API, Azure DevOps). It never follows a redirect: the
/// APIs don't send any, and this way a body holding a device code (or a bearer token) is never
/// replayed elsewhere.
pub(crate) fn no_redirect_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(NO_REDIRECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}
