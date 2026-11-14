//! Sign in with Google through the Buma API, device-authorization style. The desktop asks
//! the API for a device code, opens the browser, and polls until the user approves; the
//! token it gets back lives in the OS keychain and never reaches the webview.

mod device;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::infra::http::no_redirect_client;
use crate::infra::token_store::{io_err, StoreError, TokenStore};
use crate::types::{Account, AuthError, AuthStart, AuthState, AuthStatus};
use device::*;

/// The keychain account for an API base: `api:` + origin + path, without a trailing slash,
/// so a token is bound to the API it came from. Every sign-in path goes through here, so it is
/// also the one guard against plain http: a token only travels over https, or over http to
/// this computer (`localhost`, 127.0.0.0/8, `::1`). Anything else is `Insecure` and has no key.
pub fn account_key(base: &str) -> Result<String, AuthError> {
    let url = reqwest::Url::parse(base.trim()).map_err(|_| AuthError::Server)?;
    let Some(host) = url.host_str() else { return Err(AuthError::Server) };
    let secure = match url.scheme() {
        "https" => true,
        // The URL parser has already lower-cased the host and normalised IPv4 (`127.1`).
        "http" => {
            host == "localhost"
                || host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback())
                || host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::Ipv6Addr>().is_ok_and(|ip| ip.is_loopback())
        }
        _ => return Err(AuthError::Server),
    };
    if !secure {
        return Err(AuthError::Insecure);
    }
    Ok(format!("api:{}{}", url.origin().ascii_serialization(), url.path().trim_end_matches('/')))
}

// ---- the signed-in state ----

/// The cached account per keychain account; the app keeps it in the settings table.
pub trait AccountCache: Send + Sync {
    fn load(&self, key: &str) -> Option<Account>;
    fn save(&self, key: &str, account: Option<&Account>);
}

impl AccountCache for crate::infra::db::Db {
    fn load(&self, key: &str) -> Option<Account> {
        self.auth_account(key)
    }
    fn save(&self, key: &str, account: Option<&Account>) {
        if let Err(e) = self.set_auth_account(key, account) {
            eprintln!("[auth] couldn't cache the account: {e}");
        }
    }
}

/// Where `auth://changed` goes.
pub trait AuthSink: Send + Sync {
    fn changed(&self, status: &AuthStatus);
}

pub const EVENT: &str = "auth://changed";

fn make_status(state: AuthState, base: &str, account: Option<Account>, error: Option<AuthError>, offline: bool) -> AuthStatus {
    AuthStatus { state, signed_in: state == AuthState::SignedIn, account, error, offline, api_url: base.to_string() }
}

struct Inner {
    base: String,
    status: AuthStatus,
    /// Bumped by every status change: a refresh applies only when nothing changed meanwhile.
    version: u64,
    /// Bumped by every start, cancel, logout and API switch: a sign-in finishes only while current.
    attempt: u64,
    poll: Option<tokio::task::AbortHandle>,
}

/// Signing in and out, and the state the UI shows. At most one poll task runs.
pub struct Auth {
    store: Arc<dyn TokenStore>,
    /// Held around every store call, so a check-then-delete can't interleave with a save.
    store_lock: Arc<Mutex<()>>,
    cache: Arc<dyn AccountCache>,
    sink: Arc<dyn AuthSink>,
    client: reqwest::Client,
    tick: Duration,
    inner: Mutex<Inner>,
}

impl Auth {
    pub fn new(
        store: Arc<dyn TokenStore>,
        cache: Arc<dyn AccountCache>,
        sink: Arc<dyn AuthSink>,
        tick: Duration,
    ) -> Result<Arc<Self>, String> {
        let inner = Inner {
            base: String::new(),
            status: make_status(AuthState::SignedOut, "", None, None, false),
            version: 0,
            attempt: 0,
            poll: None,
        };
        Ok(Arc::new(Self {
            store,
            store_lock: Arc::default(),
            cache,
            sink,
            client: no_redirect_client()?,
            tick,
            inner: Mutex::new(inner),
        }))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set(&self, inner: &mut Inner, status: AuthStatus) {
        inner.version += 1;
        inner.status = status.clone();
        self.sink.changed(&status);
    }

    /// Ends the current sign-in, if any; a poll still in flight finds itself out of date.
    fn stop_poll(inner: &mut Inner) {
        inner.attempt += 1;
        if let Some(h) = inner.poll.take() {
            h.abort();
        }
    }

    /// The keychain can block (or ask the user), so it runs off the async threads.
    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&dyn TokenStore) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        let store = self.store.clone();
        let lock = self.store_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
            f(store.as_ref())
        })
        .await
        .map_err(io_err)?
    }

    async fn load_token(&self, key: &str) -> Option<String> {
        let key = key.to_string();
        self.blocking(move |s| s.get(&key)).await.unwrap_or_else(|e| {
            eprintln!("[auth] couldn't read the sign-in token: {e}");
            None
        })
    }

    /// The stored token for `base`, for the other API calls Rust makes for the signed-in user
    /// (AI credits and images). It never goes to the webview. None when signed out or the address isn't safe.
    pub async fn token(&self, base: &str) -> Option<String> {
        let key = account_key(base.trim()).ok()?;
        self.load_token(&key).await
    }

    /// The no-redirect client every call with the token goes through.
    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// The current state; never the token.
    pub fn status(&self) -> AuthStatus {
        self.lock().status.clone()
    }

    /// Applies `status` only if nothing else changed the state since `version` was read and no
    /// sign-in has started. Returns the new version.
    fn apply_if(&self, base: &str, version: u64, status: AuthStatus) -> Option<u64> {
        let mut i = self.lock();
        if i.base != base || i.version != version || i.poll.is_some() {
            return None;
        }
        self.set(&mut i, status);
        Some(i.version)
    }

    /// Works out the state for `base`: no token is signed out; otherwise `/v1/me` decides. A 401
    /// clears the token; no answer keeps it and shows the cached account as offline. A new
    /// base stops any sign-in in progress for the old one.
    pub async fn refresh(self: &Arc<Self>, base: &str) {
        let base = base.trim().to_string();
        let mut version = {
            let mut i = self.lock();
            if i.base != base {
                Self::stop_poll(&mut i);
                i.base = base.clone();
            } else if i.poll.is_some() {
                return;
            }
            i.version
        };
        let signed_out = || make_status(AuthState::SignedOut, &base, None, None, false);
        let Ok(key) = account_key(&base) else {
            self.apply_if(&base, version, signed_out());
            return;
        };
        let Some(token) = self.load_token(&key).await else {
            self.cache.save(&key, None);
            self.apply_if(&base, version, signed_out());
            return;
        };
        // Show the account we know right away; /v1/me confirms it.
        if let Some(cached) = self.cache.load(&key) {
            let shown = make_status(AuthState::SignedIn, &base, Some(cached), None, false);
            match self.apply_if(&base, version, shown) {
                Some(v) => version = v,
                None => return,
            }
        }
        let status = match fetch_me(&self.client, &base, &token).await {
            Me::Account(a) => {
                self.cache.save(&key, Some(&a));
                make_status(AuthState::SignedIn, &base, Some(a), None, false)
            }
            Me::Unauthorized => {
                // Only this token: a sign-in may have saved a newer one while /v1/me answered.
                let k = key.clone();
                let removed = self
                    .blocking(move |s| match s.get(&k)? {
                        Some(t) if t == token => s.delete(&k).map(|()| true),
                        _ => Ok(false),
                    })
                    .await;
                match removed {
                    Ok(true) => self.cache.save(&key, None),
                    Ok(false) => return,
                    Err(e) => eprintln!("[auth] couldn't remove a revoked token: {e}"),
                }
                signed_out()
            }
            Me::Unavailable => make_status(AuthState::SignedIn, &base, self.cache.load(&key), None, true),
        };
        self.apply_if(&base, version, status);
    }

    /// Asks the API for a device code and starts the one poll task; any earlier one stops.
    /// `Ok(None)` when it was cancelled before the API answered.
    pub async fn start(self: &Arc<Self>, base: &str) -> Result<Option<AuthStart>, AuthError> {
        let base = base.trim().to_string();
        let attempt = {
            let mut i = self.lock();
            Self::stop_poll(&mut i);
            i.base = base.clone();
            i.attempt
        };
        // No request at all to an address a token couldn't safely come back from.
        if let Err(e) = account_key(&base) {
            let mut i = self.lock();
            if i.attempt == attempt {
                self.set(&mut i, make_status(AuthState::Error, &base, None, Some(e), false));
            }
            return Err(e);
        }
        let device = request_device(&self.client, &base).await.and_then(|d| {
            // Only a web page may be opened from what the API says.
            let ok = |u: &str| reqwest::Url::parse(u).is_ok_and(|u| matches!(u.scheme(), "http" | "https"));
            if ok(&d.verification_uri) && ok(&d.verification_uri_complete) {
                Ok(d)
            } else {
                Err(AuthError::Server)
            }
        });
        let mut i = self.lock();
        if i.attempt != attempt {
            return Ok(None);
        }
        let device = match device {
            Ok(d) => d,
            Err(e) => {
                self.set(&mut i, make_status(AuthState::Error, &base, None, Some(e), false));
                return Err(e);
            }
        };
        let shown = AuthStart {
            user_code: device.user_code.clone(),
            verification_uri: device.verification_uri.clone(),
            verification_uri_complete: device.verification_uri_complete.clone(),
            expires_in: device.expires_in,
        };
        let this = Arc::clone(self);
        let poll_base = base.clone();
        let task = tokio::spawn(async move { this.finish(poll_base, device, attempt).await });
        i.poll = Some(task.abort_handle());
        self.set(&mut i, make_status(AuthState::Pending, &base, None, None, false));
        Ok(Some(shown))
    }

    /// The poll task: waits for the token, keeps it, and says how it went.
    async fn finish(self: Arc<Self>, base: String, device: DeviceCode, attempt: u64) {
        let result = poll_until_done(&self.client, &base, &device, self.tick).await;
        if self.lock().attempt != attempt {
            return;
        }
        let status = match result {
            Ok(Issued { token, account }) => match account_key(&base) {
                Ok(key) => {
                    let k = key.clone();
                    let token_copy = token.clone();
                    match self.blocking(move |s| s.set(&k, &token)).await {
                        Ok(()) => {
                            self.cache.save(&key, Some(&account));
                            make_status(AuthState::SignedIn, &base, Some(account), None, false)
                        }
                        Err(e) => {
                            eprintln!("[auth] couldn't save the sign-in token: {e}");
                            // Nobody holds it now, so it shouldn't stay live at the API.
                            revoke(&self.client, &base, &token_copy).await;
                            let why = if matches!(e, StoreError::Refused(_)) { AuthError::Keychain } else { AuthError::Storage };
                            make_status(AuthState::Error, &base, None, Some(why), false)
                        }
                    }
                }
                Err(e) => make_status(AuthState::Error, &base, None, Some(e), false),
            },
            Err(e) => make_status(AuthState::Error, &base, None, Some(e), false),
        };
        let mut i = self.lock();
        if i.attempt == attempt {
            i.poll = None;
            self.set(&mut i, status);
        }
    }

    /// Stops signing in.
    pub fn cancel(&self) {
        let mut i = self.lock();
        Self::stop_poll(&mut i);
        if matches!(i.status.state, AuthState::Pending | AuthState::Error) {
            let base = i.base.clone();
            self.set(&mut i, make_status(AuthState::SignedOut, &base, None, None, false));
        }
    }

    /// Revokes the token at the API (best effort) and forgets it here.
    pub async fn logout(self: &Arc<Self>, base: &str) -> Result<(), AuthError> {
        let base = base.trim().to_string();
        {
            let mut i = self.lock();
            Self::stop_poll(&mut i);
            i.base = base.clone();
        }
        if let Ok(key) = account_key(&base) {
            if let Some(token) = self.load_token(&key).await {
                revoke(&self.client, &base, &token).await;
            }
            let k = key.clone();
            self.blocking(move |s| s.delete(&k)).await.map_err(|e| {
                eprintln!("[auth] couldn't remove the sign-in token: {e}");
                AuthError::Storage
            })?;
            self.cache.save(&key, None);
        }
        let mut i = self.lock();
        self.set(&mut i, make_status(AuthState::SignedOut, &base, None, None, false));
        Ok(())
    }

    /// App exit: stop polling.
    pub fn shutdown(&self) {
        Self::stop_poll(&mut self.lock());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::http::no_redirect_client as http_client;
    use crate::infra::token_store::tests::denied;
    use crate::infra::token_store::{FileStore, MemoryStore, SecureStore};
    use crate::test_support::*;
    use std::collections::HashMap;

    #[test]
    fn account_key_is_origin_plus_path() {
        assert_eq!(account_key("https://bspace.buma.internal/api").unwrap(), "api:https://bspace.buma.internal/api");
        assert_eq!(account_key(" https://BSpace.Buma.Internal:443/api/ ").unwrap(), "api:https://bspace.buma.internal/api");
        assert_eq!(account_key("http://localhost:8787/api").unwrap(), "api:http://localhost:8787/api");
        assert_eq!(account_key("http://localhost:8787").unwrap(), "api:http://localhost:8787");
        assert_ne!(account_key("http://localhost:8787/api").unwrap(), account_key("http://127.0.0.1:8787/api").unwrap());
        assert!(account_key("not a url").is_err());
        assert!(account_key("file:///etc/passwd").is_err());
    }

    #[test]
    fn plain_http_is_only_for_this_computer() {
        for ok in ["http://localhost:8787/api", "http://LOCALHOST/api", "http://127.0.0.1:8787/api", "http://127.9.8.7/api", "http://127.1/api", "http://[::1]:8787/api", "https://example.com/api"] {
            assert!(account_key(ok).is_ok(), "{ok}");
        }
        for bad in ["http://bspace.buma.internal/api", "http://192.168.1.20:8787/api", "http://10.0.0.1/api", "http://[::2]/api", "http://localhost.evil.com/api", "http://127.0.0.1.evil.com/api", "http://[::ffff:192.168.1.1]/api"] {
            assert_eq!(account_key(bad), Err(AuthError::Insecure), "{bad}");
        }
        assert_eq!(account_key("not a url"), Err(AuthError::Server));
    }


    // ---- the signed-in state ----

    #[derive(Default)]
    struct MemCache(Mutex<HashMap<String, Account>>);
    impl AccountCache for MemCache {
        fn load(&self, key: &str) -> Option<Account> {
            self.0.lock().unwrap().get(key).cloned()
        }
        fn save(&self, key: &str, account: Option<&Account>) {
            let mut m = self.0.lock().unwrap();
            match account {
                Some(a) => m.insert(key.into(), a.clone()),
                None => m.remove(key),
            };
        }
    }

    #[derive(Default)]
    struct Rec(Mutex<Vec<AuthStatus>>);
    impl AuthSink for Rec {
        fn changed(&self, status: &AuthStatus) {
            self.0.lock().unwrap().push(status.clone());
        }
    }
    impl Rec {
        fn all(&self) -> Vec<AuthStatus> {
            self.0.lock().unwrap().clone()
        }
        fn last(&self) -> Option<AuthStatus> {
            self.0.lock().unwrap().last().cloned()
        }
    }

    struct Rig {
        auth: Arc<Auth>,
        store: Arc<MemoryStore>,
        cache: Arc<MemCache>,
        rec: Arc<Rec>,
    }

    fn rig() -> Rig {
        let store = Arc::new(MemoryStore::default());
        let cache = Arc::new(MemCache::default());
        let rec = Arc::new(Rec::default());
        let auth = Auth::new(store.clone(), cache.clone(), rec.clone(), TICK).unwrap();
        Rig { auth, store, cache, rec }
    }

    fn account(plan: &str) -> Account {
        Account { id: "acc_1".into(), email: Some("a@b.c".into()), name: Some("Ana".into()), plan: plan.into(), features: vec![], credits: 0 }
    }

    fn key(base: &str) -> String {
        account_key(base).unwrap()
    }

    async fn until(rec: &Rec, want: impl Fn(&AuthStatus) -> bool) -> AuthStatus {
        for _ in 0..500 {
            if let Some(s) = rec.last().filter(|s| want(s)) {
                return s;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("never got there; events: {:?}", rec.all());
    }

    /// A fake API that issues a token after two pending polls and knows that token at /v1/me.
    async fn api() -> Fake {
        fake(|r, n| match r.path.as_str() {
            "/api/v1/auth/device" => (200, DEVICE.into()),
            "/api/v1/auth/token" if n < 2 => err("authorization_pending"),
            "/api/v1/auth/token" => (200, ISSUED.into()),
            "/api/v1/me" if r.auth.as_deref() == Some("Bearer tyg_abc") => (200, ME.into()),
            "/api/v1/me" => (401, r#"{"error":"unauthorized"}"#.into()),
            "/api/v1/auth/logout" => (204, String::new()),
            _ => (404, "{}".into()),
        })
        .await
    }

    #[tokio::test]
    async fn token_is_the_stored_one_for_that_base_only() {
        let r = rig();
        r.store.set(&key("http://localhost:8787/api"), "tyg_abc").unwrap();
        assert_eq!(r.auth.token(" http://localhost:8787/api/ ").await.as_deref(), Some("tyg_abc"));
        assert_eq!(r.auth.token("https://bspace.buma.internal/api").await, None);
        assert_eq!(r.auth.token("http://example.com/api").await, None, "never over plain http to another computer");
    }

    #[tokio::test]
    async fn no_token_is_signed_out() {
        let r = rig();
        let f = api().await;
        r.auth.refresh(&f.base).await;
        let s = r.auth.status();
        assert_eq!((s.state, s.signed_in, s.api_url.as_str()), (AuthState::SignedOut, false, f.base.as_str()));
        assert_eq!(r.rec.last(), Some(s));
        assert!(f.hits("/api/v1/me").is_empty(), "nothing to check without a token");
    }

    #[tokio::test]
    async fn a_stored_token_is_checked_at_me_and_the_account_cached() {
        let r = rig();
        let f = api().await;
        r.store.set(&key(&f.base), "tyg_abc").unwrap();
        r.auth.refresh(&f.base).await;
        let s = r.auth.status();
        assert_eq!((s.state, s.offline), (AuthState::SignedIn, false));
        assert_eq!(s.account.as_ref().map(|a| a.plan.as_str()), Some("pro"));
        assert_eq!(r.cache.load(&key(&f.base)).map(|a| a.plan), Some("pro".into()));
    }

    #[tokio::test]
    async fn a_401_clears_the_token_and_the_cache() {
        let r = rig();
        let f = api().await;
        r.store.set(&key(&f.base), "tyg_revoked").unwrap();
        r.cache.save(&key(&f.base), Some(&account("free")));
        r.auth.refresh(&f.base).await;
        assert_eq!(r.auth.status().state, AuthState::SignedOut);
        assert_eq!(r.store.get(&key(&f.base)).unwrap(), None);
        assert_eq!(r.cache.load(&key(&f.base)), None);
    }

    #[tokio::test]
    async fn a_late_401_for_an_old_token_leaves_a_newer_one_alone() {
        let store = Arc::new(MemoryStore::default());
        let cache = Arc::new(MemCache::default());
        let rec = Arc::new(Rec::default());
        let auth = Auth::new(store.clone(), cache.clone(), rec.clone(), TICK).unwrap();
        let during = store.clone();
        let slot: Arc<Mutex<String>> = Arc::default();
        let k = slot.clone();
        let f = fake(move |_, _| {
            // While /v1/me checks the old token, a sign-in saves a new one.
            during.set(&k.lock().unwrap(), "tyg_new").unwrap();
            (401, r#"{"error":"unauthorized"}"#.into())
        })
        .await;
        *slot.lock().unwrap() = key(&f.base);
        store.set(&key(&f.base), "tyg_old").unwrap();
        cache.save(&key(&f.base), Some(&account("pro")));
        auth.refresh(&f.base).await;
        assert_eq!(store.get(&key(&f.base)).unwrap().as_deref(), Some("tyg_new"));
        assert_eq!(cache.load(&key(&f.base)), Some(account("pro")), "the newer sign-in's account stays");
    }

    #[tokio::test]
    async fn offline_keeps_the_token_and_shows_the_cached_account() {
        let r = rig();
        let base = dead_base().await;
        r.store.set(&key(&base), "tyg_abc").unwrap();
        r.cache.save(&key(&base), Some(&account("pro")));
        r.auth.refresh(&base).await;
        let s = r.auth.status();
        assert_eq!((s.state, s.offline, s.account), (AuthState::SignedIn, true, Some(account("pro"))));
        assert_eq!(r.store.get(&key(&base)).unwrap().as_deref(), Some("tyg_abc"));
    }

    #[tokio::test]
    async fn signing_in_stores_the_token_and_never_shows_it() {
        let r = rig();
        let f = api().await;
        let started = r.auth.start(&f.base).await.unwrap().unwrap();
        assert_eq!(started.user_code, "ABCD-EFGH");
        assert_eq!(started.verification_uri_complete, "http://x/api/auth/device?code=ABCD-EFGH");
        assert_eq!(r.auth.status().state, AuthState::Pending);
        let s = until(&r.rec, |s| s.state == AuthState::SignedIn).await;
        assert_eq!(s.account.as_ref().and_then(|a| a.email.as_deref()), Some("a@b.c"));
        assert_eq!(r.store.get(&key(&f.base)).unwrap().as_deref(), Some("tyg_abc"));
        assert_eq!(r.cache.load(&key(&f.base)).map(|a| a.id), Some("acc_1".into()));
        let shown = serde_json::to_string(&(r.rec.all(), started, r.auth.status())).unwrap();
        assert!(!shown.contains("tyg_") && !shown.contains("dev-secret"), "{shown}");
    }

    #[tokio::test]
    async fn a_keychain_deny_fails_the_sign_in_and_leaves_no_token_anywhere() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let store = Arc::new(SecureStore::new(denied(), FileStore::new(path.clone())));
        let rec = Arc::new(Rec::default());
        let auth = Auth::new(store, Arc::new(MemCache::default()), rec.clone(), TICK).unwrap();
        let f = api().await;
        auth.start(&f.base).await.unwrap();
        let s = until(&rec, |s| s.state == AuthState::Error).await;
        assert_eq!((s.error, s.signed_in, s.account), (Some(AuthError::Keychain), false, None));
        assert!(!path.exists());
        let revoked = f.hits("/api/v1/auth/logout");
        assert_eq!(revoked.first().and_then(|r| r.auth.as_deref()), Some("Bearer tyg_abc"), "the unsaved token is revoked");
    }

    #[tokio::test]
    async fn a_denied_sign_in_is_an_error() {
        let r = rig();
        let f = fake(|r, _| if r.path.ends_with("/device") { (200, DEVICE.into()) } else { err("access_denied") }).await;
        r.auth.start(&f.base).await.unwrap();
        let s = until(&r.rec, |s| s.state == AuthState::Error).await;
        assert_eq!((s.error, s.signed_in), (Some(AuthError::Denied), false));
        assert_eq!(r.store.get(&key(&f.base)).unwrap(), None);
    }

    #[tokio::test]
    async fn signing_in_over_plain_http_to_another_computer_is_refused_without_a_request() {
        let r = rig();
        let base = "http://example.test/api";
        assert_eq!(r.auth.start(base).await.unwrap_err(), AuthError::Insecure);
        let s = r.auth.status();
        assert_eq!((s.state, s.error, s.signed_in), (AuthState::Error, Some(AuthError::Insecure), false));
        r.auth.refresh(base).await;
        assert_eq!(r.auth.status().state, AuthState::SignedOut);
    }

    #[tokio::test]
    async fn auth_calls_never_follow_a_redirect() {
        let target = fake(|_, _| (200, DEVICE.into())).await;
        let to = format!("{}/v1/auth/device", target.base);
        let f = fake(move |_, _| (307, to.clone())).await;
        let c = http_client().unwrap();
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::Server);
        assert!(matches!(poll_token(&c, &f.base, "dev-secret").await, PollReply::Server));
        assert!(target.hits.lock().unwrap().is_empty(), "the device code went nowhere else");
    }

    #[tokio::test]
    async fn an_unreachable_api_fails_the_start() {
        let r = rig();
        let base = dead_base().await;
        assert_eq!(r.auth.start(&base).await.unwrap_err(), AuthError::Network);
        assert_eq!((r.auth.status().state, r.auth.status().error), (AuthState::Error, Some(AuthError::Network)));
    }

    /// Pending forever, so a test can stop it.
    async fn slow_api() -> Fake {
        fake(|r, _| if r.path.ends_with("/device") { (200, DEVICE.into()) } else { err("authorization_pending") }).await
    }

    #[tokio::test]
    async fn cancel_stops_polling() {
        let r = rig();
        let f = slow_api().await;
        r.auth.start(&f.base).await.unwrap();
        tokio::time::sleep(TICK * 10).await;
        r.auth.cancel();
        assert_eq!(r.auth.status().state, AuthState::SignedOut);
        let polls = f.hits("/api/v1/auth/token").len();
        tokio::time::sleep(TICK * 20).await;
        assert!(f.hits("/api/v1/auth/token").len() <= polls + 1, "at most the poll already in flight");
        assert_eq!(r.rec.last().unwrap().state, AuthState::SignedOut);
    }

    #[tokio::test]
    async fn a_second_start_replaces_the_first() {
        let r = rig();
        let first = slow_api().await;
        let second = api().await;
        r.auth.start(&first.base).await.unwrap();
        tokio::time::sleep(TICK * 5).await;
        r.auth.start(&second.base).await.unwrap();
        let polls = first.hits("/api/v1/auth/token").len();
        until(&r.rec, |s| s.state == AuthState::SignedIn).await;
        assert!(first.hits("/api/v1/auth/token").len() <= polls + 1);
        assert_eq!(r.auth.status().api_url, second.base);
    }

    #[tokio::test]
    async fn switching_the_api_shows_that_apis_own_state() {
        let r = rig();
        let a = api().await;
        let b = api().await;
        r.store.set(&key(&a.base), "tyg_abc").unwrap();
        r.auth.refresh(&a.base).await;
        assert!(r.auth.status().signed_in);
        r.auth.refresh(&b.base).await;
        let s = r.auth.status();
        assert_eq!((s.state, s.api_url.as_str()), (AuthState::SignedOut, b.base.as_str()));
        assert_eq!(r.store.get(&key(&a.base)).unwrap().as_deref(), Some("tyg_abc"), "a's token stays for later");
        r.auth.refresh(&a.base).await;
        assert!(r.auth.status().signed_in);
    }

    #[tokio::test]
    async fn switching_the_api_mid_sign_in_stops_it() {
        let r = rig();
        let a = slow_api().await;
        let b = api().await;
        r.auth.start(&a.base).await.unwrap();
        tokio::time::sleep(TICK * 5).await;
        r.auth.refresh(&b.base).await;
        assert_eq!(r.auth.status().state, AuthState::SignedOut);
        let polls = a.hits("/api/v1/auth/token").len();
        tokio::time::sleep(TICK * 20).await;
        assert!(a.hits("/api/v1/auth/token").len() <= polls + 1);
    }

    #[tokio::test]
    async fn refreshing_the_same_api_leaves_a_sign_in_alone() {
        let r = rig();
        let f = api().await;
        r.auth.start(&f.base).await.unwrap();
        r.auth.refresh(&f.base).await;
        until(&r.rec, |s| s.state == AuthState::SignedIn).await;
    }

    #[tokio::test]
    async fn logout_revokes_and_forgets() {
        let r = rig();
        let f = api().await;
        r.store.set(&key(&f.base), "tyg_abc").unwrap();
        r.auth.refresh(&f.base).await;
        r.auth.logout(&f.base).await.unwrap();
        let hits = f.hits("/api/v1/auth/logout");
        assert_eq!(hits[0].auth.as_deref(), Some("Bearer tyg_abc"));
        assert_eq!(r.store.get(&key(&f.base)).unwrap(), None);
        assert_eq!(r.cache.load(&key(&f.base)), None);
        assert_eq!(r.auth.status().state, AuthState::SignedOut);
    }

    #[tokio::test]
    async fn logout_offline_still_forgets_the_token() {
        let r = rig();
        let base = dead_base().await;
        r.store.set(&key(&base), "tyg_abc").unwrap();
        r.auth.logout(&base).await.unwrap();
        assert_eq!(r.store.get(&key(&base)).unwrap(), None);
    }

    #[tokio::test]
    async fn shutdown_stops_polling() {
        let r = rig();
        let f = slow_api().await;
        r.auth.start(&f.base).await.unwrap();
        tokio::time::sleep(TICK * 5).await;
        r.auth.shutdown();
        let polls = f.hits("/api/v1/auth/token").len();
        tokio::time::sleep(TICK * 20).await;
        assert!(f.hits("/api/v1/auth/token").len() <= polls + 1);
    }
}
