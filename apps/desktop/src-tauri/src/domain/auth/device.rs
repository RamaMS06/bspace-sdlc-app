//! The Buma API's device-authorization calls (`/v1/auth/device`, `/v1/auth/token`, `/v1/me`,
//! `/v1/auth/logout`) and the poll loop that waits for the user to approve.

use std::time::Duration;

use crate::infra::api_url::endpoint;
use crate::types::{Account, AuthError};
use serde::Deserialize;

/// Polls in a row that may fail (network or server) before signing in gives up.
const MAX_POLL_FAILURES: u32 = 3;

/// `POST /v1/auth/device` (shared `AuthDeviceResponse`). The device code never leaves Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// `POST /v1/auth/token`, 200 (shared `AuthTokenResponse`).
#[derive(Debug, Clone, Deserialize)]
pub struct Issued {
    pub token: String,
    pub account: Account,
}

/// One answer from `POST /v1/auth/token`.
#[derive(Debug)]
pub enum PollReply {
    Pending,
    SlowDown,
    Expired,
    Denied,
    Issued(Issued),
    Network,
    Server,
}

/// `GET /v1/me` with a stored token.
#[derive(Debug)]
pub enum Me {
    Account(Account),
    /// 401: the token is no good any more.
    Unauthorized,
    /// Offline, or the API is having a bad moment: keep the token.
    Unavailable,
}

/// The status and body of a response; `None` when the API couldn't be reached.
async fn send(req: reqwest::RequestBuilder) -> Option<(u16, Vec<u8>)> {
    let res = req.send().await.ok()?;
    let status = res.status().as_u16();
    Some((status, res.bytes().await.ok()?.to_vec()))
}

pub async fn request_device(client: &reqwest::Client, base: &str) -> Result<DeviceCode, AuthError> {
    let (status, body) =
        send(client.post(endpoint(base, "/v1/auth/device"))).await.ok_or(AuthError::Network)?;
    match status {
        200..=299 => serde_json::from_slice::<DeviceCode>(&body)
            .ok()
            .filter(|d| !d.device_code.is_empty() && !d.user_code.is_empty())
            .ok_or(AuthError::Server),
        429 => Err(AuthError::RateLimited),
        _ => Err(AuthError::Server),
    }
}

pub async fn poll_token(client: &reqwest::Client, base: &str, device_code: &str) -> PollReply {
    let req = client
        .post(endpoint(base, "/v1/auth/token"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "deviceCode": device_code }).to_string());
    let Some((status, body)) = send(req).await else { return PollReply::Network };
    #[derive(Deserialize)]
    struct TokenError {
        error: String,
    }
    match status {
        200..=299 => match serde_json::from_slice::<Issued>(&body) {
            Ok(i) if i.token.starts_with("tyg_") && i.token.len() > 4 => PollReply::Issued(i),
            _ => PollReply::Server,
        },
        429 => PollReply::SlowDown,
        400 => match serde_json::from_slice::<TokenError>(&body).map(|e| e.error) {
            Ok(e) if e == "authorization_pending" => PollReply::Pending,
            Ok(e) if e == "slow_down" => PollReply::SlowDown,
            Ok(e) if e == "expired_token" => PollReply::Expired,
            Ok(e) if e == "access_denied" => PollReply::Denied,
            _ => PollReply::Server,
        },
        _ => PollReply::Server,
    }
}

pub async fn fetch_me(client: &reqwest::Client, base: &str, token: &str) -> Me {
    let Some((status, body)) = send(client.get(endpoint(base, "/v1/me")).bearer_auth(token)).await else {
        return Me::Unavailable;
    };
    match status {
        200..=299 => serde_json::from_slice(&body).map(Me::Account).unwrap_or(Me::Unavailable),
        401 => Me::Unauthorized,
        _ => Me::Unavailable,
    }
}

/// `POST /v1/auth/logout`; best effort, the result is ignored.
pub async fn revoke(client: &reqwest::Client, base: &str, token: &str) {
    let req = client.post(endpoint(base, "/v1/auth/logout")).bearer_auth(token).timeout(Duration::from_secs(5));
    let _ = send(req).await;
}

// ---- polling ----

/// What the poller does after a reply.
#[derive(Debug)]
pub enum Step {
    /// Poll again after this many seconds.
    Wait(u64),
    Done(Result<Issued, AuthError>),
}

/// The polling state machine: the interval (seconds) and the failures in a row.
pub struct PollState {
    pub interval: u64,
    failures: u32,
}

impl PollState {
    pub fn new(interval: u64) -> Self {
        Self { interval: interval.clamp(1, 60), failures: 0 }
    }

    pub fn next(&mut self, reply: PollReply) -> Step {
        let failed = |st: &mut Self, why: AuthError| {
            st.failures += 1;
            if st.failures >= MAX_POLL_FAILURES {
                Step::Done(Err(why))
            } else {
                Step::Wait(st.interval)
            }
        };
        match reply {
            PollReply::Pending => {
                self.failures = 0;
                Step::Wait(self.interval)
            }
            PollReply::SlowDown => {
                self.failures = 0;
                self.interval += 5;
                Step::Wait(self.interval)
            }
            PollReply::Expired => Step::Done(Err(AuthError::Expired)),
            PollReply::Denied => Step::Done(Err(AuthError::Denied)),
            PollReply::Issued(i) => Step::Done(Ok(i)),
            PollReply::Network => failed(self, AuthError::Network),
            PollReply::Server => failed(self, AuthError::Server),
        }
    }
}

/// Polls until the code is approved, refused or runs out. One `tick` is a second in the app;
/// tests shrink it.
pub async fn poll_until_done(
    client: &reqwest::Client,
    base: &str,
    device: &DeviceCode,
    tick: Duration,
) -> Result<Issued, AuthError> {
    use tokio::time::{sleep_until, Instant};
    let mut st = PollState::new(device.interval);
    let deadline = Instant::now() + tick * device.expires_in.min(3600) as u32;
    let mut wait = st.interval;
    loop {
        let at = Instant::now() + tick * wait as u32;
        if at > deadline {
            sleep_until(deadline).await;
            return Err(AuthError::Expired);
        }
        sleep_until(at).await;
        match st.next(poll_token(client, base, &device.device_code).await) {
            Step::Wait(w) => wait = w,
            Step::Done(r) => return r,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::http::no_redirect_client as http_client;
    use crate::test_support::*;

    fn device(interval: u64, expires_in: u64) -> DeviceCode {
        let mut d: DeviceCode = serde_json::from_str(DEVICE).unwrap();
        d.interval = interval;
        d.expires_in = expires_in;
        d
    }

    #[tokio::test]
    async fn request_device_keeps_the_base_path() {
        let f = fake(|_, _| (200, DEVICE.into())).await;
        let d = request_device(&http_client().unwrap(), &format!("{}/", f.base)).await.unwrap();
        assert_eq!((d.user_code.as_str(), d.device_code.as_str(), d.interval), ("ABCD-EFGH", "dev-secret", 1));
        let hits = f.hits("/api/v1/auth/device");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].method, "POST");
    }

    #[tokio::test]
    async fn request_device_errors() {
        let c = http_client().unwrap();
        let f = fake(|_, _| (429, r#"{"error":"rate_limited"}"#.into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::RateLimited);
        let f = fake(|_, _| (404, "{}".into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::Server);
        let f = fake(|_, _| (200, "<html>".into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::Server);
        assert_eq!(request_device(&c, &dead_base().await).await.unwrap_err(), AuthError::Network);
    }

    #[test]
    fn poll_state_respects_interval_and_slow_down() {
        let mut st = PollState::new(5);
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::SlowDown), Step::Wait(10)));
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(10)));
        assert!(matches!(st.next(PollReply::SlowDown), Step::Wait(15)));
        assert!(matches!(st.next(PollReply::Expired), Step::Done(Err(AuthError::Expired))));
        assert!(matches!(PollState::new(5).next(PollReply::Denied), Step::Done(Err(AuthError::Denied))));
        assert_eq!(PollState::new(0).interval, 1, "never hammer the API");
    }

    #[test]
    fn poll_state_tolerates_a_few_failures_in_a_row() {
        let mut st = PollState::new(5);
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Server), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(5)), "a good reply resets the count");
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Network), Step::Done(Err(AuthError::Network))));
        let mut st = PollState::new(5);
        st.next(PollReply::Server);
        st.next(PollReply::Server);
        assert!(matches!(st.next(PollReply::Server), Step::Done(Err(AuthError::Server))));
    }

    #[tokio::test]
    async fn polls_through_pending_and_slow_down_to_a_token() {
        let f = fake(|r, n| {
            assert_eq!(r.path, "/api/v1/auth/token");
            match n {
                0 => err("authorization_pending"),
                1 => err("slow_down"),
                2 => err("authorization_pending"),
                _ => (200, ISSUED.into()),
            }
        })
        .await;
        let started = std::time::Instant::now();
        let issued = poll_until_done(&http_client().unwrap(), &f.base, &device(1, 600), TICK).await.unwrap();
        assert_eq!(issued.token, "tyg_abc");
        assert_eq!(issued.account.email.as_deref(), Some("a@b.c"));
        let hits = f.hits("/api/v1/auth/token");
        assert_eq!(hits.len(), 4);
        assert!(hits.iter().all(|h| h.method == "POST" && h.body.contains(r#""deviceCode":"dev-secret""#)));
        // 1 + 1 + 6 + 6 ticks: slow_down added five seconds to every wait after it.
        assert!(started.elapsed() >= TICK * 14, "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn polling_stops_on_deny_and_expiry() {
        let c = http_client().unwrap();
        let f = fake(|_, n| if n == 0 { err("authorization_pending") } else { err("access_denied") }).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 600), TICK).await.unwrap_err(), AuthError::Denied);
        let f = fake(|_, _| err("expired_token")).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 600), TICK).await.unwrap_err(), AuthError::Expired);
        // The code runs out on this side too, even while the server keeps saying pending.
        let f = fake(|_, _| err("authorization_pending")).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 5), TICK).await.unwrap_err(), AuthError::Expired);
        assert!(f.hits("/api/v1/auth/token").len() <= 5);
    }

    #[tokio::test]
    async fn a_token_without_the_tyg_prefix_is_refused() {
        let f = fake(|_, _| (200, ISSUED.replace("tyg_abc", "abc"))).await;
        assert!(matches!(poll_token(&http_client().unwrap(), &f.base, "d").await, PollReply::Server));
    }

    #[tokio::test]
    async fn me_sends_the_bearer_token_and_reads_401() {
        let c = http_client().unwrap();
        let f = fake(|r, _| if r.auth.as_deref() == Some("Bearer tyg_ok") { (200, ME.into()) } else { (401, r#"{"error":"unauthorized"}"#.into()) }).await;
        let Me::Account(a) = fetch_me(&c, &f.base, "tyg_ok").await else { panic!("expected the account") };
        assert_eq!((a.plan.as_str(), a.features.as_slice(), a.credits), ("pro", ["ai-images".to_string()].as_slice(), 310));
        assert_eq!(f.hits("/api/v1/me")[0].method, "GET");
        assert!(matches!(fetch_me(&c, &f.base, "tyg_old").await, Me::Unauthorized));
        let f = fake(|_, _| (503, "{}".into())).await;
        assert!(matches!(fetch_me(&c, &f.base, "tyg_ok").await, Me::Unavailable));
        assert!(matches!(fetch_me(&c, &dead_base().await, "tyg_ok").await, Me::Unavailable));
    }

    #[tokio::test]
    async fn revoke_posts_logout_with_the_token() {
        let f = fake(|_, _| (204, String::new())).await;
        revoke(&http_client().unwrap(), &f.base, "tyg_ok").await;
        let hits = f.hits("/api/v1/auth/logout");
        assert_eq!((hits[0].method.as_str(), hits[0].auth.as_deref()), ("POST", Some("Bearer tyg_ok")));
        revoke(&http_client().unwrap(), &dead_base().await, "tyg_ok").await;
    }
}
