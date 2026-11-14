//! Events sent to the webview, and the bridges that let the domain send them without knowing Tauri.

use crate::app::state::AppState;
use crate::domain::acp::AcpSink;
use crate::domain::auth::{AccountCache, AuthSink};
use crate::types::{Account, AgentQuestion, AgentUpdate, AuthStatus, PermissionRequest};
use tauri::{AppHandle, Emitter, Manager};

/// What a chat's agent streams: `{ chatId, update }`.
pub(crate) const AGENT_UPDATE: &str = "agent://update";
/// A permission the agent asks for.
pub(crate) const AGENT_PERMISSION: &str = "agent://permission";
/// A question the agent asks the user.
pub(crate) const AGENT_QUESTION: &str = "agent://question";
/// Something an agent asked the app to do through the AI endpoint: `{ chatId, name, context }`.
pub(crate) const AGENT_ACTION: &str = "agent://action";
/// The Claude sign-in page, for when the browser didn't open by itself.
pub(crate) const CLAUDE_SIGN_IN_URL: &str = "claude://sign-in-url";
/// The Your API engine download's progress, `{ done, total }` in bytes.
pub(crate) const ENGINE_PROGRESS: &str = "engine://progress";

/// Sends a chat agent's stream to the webview.
pub(crate) struct TauriSink(pub AppHandle);

impl AcpSink for TauriSink {
    fn update(&self, chat_id: &str, u: AgentUpdate) {
        let _ = self.0.emit(AGENT_UPDATE, serde_json::json!({ "chatId": chat_id, "update": u }));
    }

    fn permission(&self, req: PermissionRequest) {
        let _ = self.0.emit(AGENT_PERMISSION, req);
    }

    fn question(&self, q: AgentQuestion) {
        let _ = self.0.emit(AGENT_QUESTION, q);
    }
}

/// Sends the sign-in state (`auth://changed`) to the webview.
pub(crate) struct TauriAuthSink(pub AppHandle);

impl AuthSink for TauriAuthSink {
    fn changed(&self, status: &AuthStatus) {
        let _ = self.0.emit(crate::domain::auth::EVENT, status);
    }
}

/// The account cache in the app database (managed after this is made, so looked up per call).
pub(crate) struct AppAccountCache(pub AppHandle);

impl AccountCache for AppAccountCache {
    fn load(&self, key: &str) -> Option<Account> {
        self.0.try_state::<AppState>().and_then(|s| s.db.load(key))
    }
    fn save(&self, key: &str, account: Option<&Account>) {
        if let Some(s) = self.0.try_state::<AppState>() {
            s.db.save(key, account);
        }
    }
}
