//! The state Tauri manages: built once at start-up, then handed to the commands.

use crate::domain::acp::AcpManager;
use crate::infra::db::Db;
use crate::types::AgentUsage;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Shared Tauri state.
pub(crate) struct AppState {
    pub db: Db,
    pub acp: AcpManager,
    pub home: PathBuf,
}

impl AppState {
    pub(crate) fn working(&self) -> PathBuf {
        PathBuf::from(self.db.get_settings(&self.home).working_folder)
    }

    /// The Buma API the app talks to: `BUMA_API_URL`, else the address in Settings.
    pub(crate) fn api_base(&self) -> String {
        crate::infra::api_url::effective_api_url(&self.db.get_settings(&self.home))
    }
}

/// The Claude sign-in that is waiting for the browser, so it can be cancelled.
#[derive(Default)]
pub(crate) struct ClaudeSignIn(pub Mutex<Option<tokio::sync::oneshot::Sender<()>>>);

/// One Your API engine download at a time.
#[derive(Default)]
pub(crate) struct EngineInstall(pub tokio::sync::Mutex<()>);

/// Last agent usage results, reused for five minutes unless the UI forces a refresh.
#[derive(Default)]
pub(crate) struct UsageCache(pub Mutex<Option<(Instant, Vec<AgentUsage>)>>);

impl UsageCache {
    pub(crate) const TTL: Duration = Duration::from_secs(300);

    /// Forgets the last results: an account changed, so they are someone else's.
    pub(crate) fn clear(&self) -> Result<(), String> {
        *self.0.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }
}
