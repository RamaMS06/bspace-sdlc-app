//! Start-up and shut-down: the managed state, the sign-in check, the tray, the agents' AI endpoint and
//! the install ping; and what happens when the app quits.

use crate::app::events::{AppAccountCache, TauriAuthSink, AGENT_ACTION};
use crate::app::state::{AppState, ClaudeSignIn, EngineInstall, UsageCache};
use crate::app::tray;
use crate::domain::acp::AcpManager;
use crate::domain::auth::Auth;
use crate::domain::{ai_proxy, environment, workspace};
use crate::infra::db::Db;
use crate::infra::exec::RealExec;
use crate::infra::telemetry;
use crate::infra::token_store::{ApiKeys, FileStore, KeyringStore, SecureStore, TokenStore};
use std::path::Path;
use std::sync::Arc;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent};

/// Builds the managed state and starts the background work. Runs once, before the window shows.
pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data)?;
    let db = Db::open(&data.join("buma.db"))?;
    // No agent survives a restart, so nothing can still be working.
    let _ = db.fail_stale_jobs("Buma was closed while this was running");
    // Also records the real home so later settings updates resolve defaults against it.
    let settings = db.get_settings(&home);
    let working = settings.working_folder.clone();
    allow_asset_folders(app.handle(), &db, &working);
    app.manage(UsageCache::default());
    app.manage(ClaudeSignIn::default());
    app.manage(ApiKeys::new(&data));
    app.manage(EngineInstall::default());
    let api_url = crate::infra::api_url::effective_api_url(&settings);
    app.manage(AppState { db, acp: AcpManager::new(), home });
    // Signed in? Checked against the API in the background; the UI listens for the answer.
    let auth = auth_manager(app.handle(), &data)?;
    app.manage(auth.clone());
    tauri::async_runtime::spawn(async move { auth.refresh(&api_url).await });
    // A tray that can't be made never crashes the start: background mode goes off, the window stays.
    if tray::sync_tray(app.handle(), &settings).is_err() {
        if let Some(state) = app.try_state::<AppState>() {
            let _ = tray::background_off(&state.db);
        }
    }
    // A login launch starts in the tray, when there is one.
    let args: Vec<String> = std::env::args().collect();
    if tray::launched_hidden(&args) && tray::has_tray(app.handle()) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    // The agents' AI images, paid with the user's credits (see ai_proxy).
    tauri::async_runtime::spawn(start_ai_proxy(app.handle().clone()));
    // Anonymous install ping, in the background; never blocks the UI, failures are ignored.
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let info = tauri::async_runtime::spawn_blocking(|| environment::system_info(&RealExec)).await;
        if let (Ok(info), Some(state)) = (info, handle.try_state::<AppState>()) {
            telemetry::ping_if_due(&state.db, &state.home, &info, chrono::Utc::now()).await;
        }
    });
    Ok(())
}

/// What the app does on its run events: the dock icon brings back a hidden window; quitting stops the
/// sign-in poll and every agent process.
pub(crate) fn on_run_event(handle: &AppHandle, event: RunEvent) {
    // Clicking the dock icon brings back a window hidden by background mode.
    #[cfg(target_os = "macos")]
    if matches!(event, RunEvent::Reopen { .. }) {
        tray::show_main(handle);
    }
    if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
        if let Some(auth) = handle.try_state::<Arc<Auth>>() {
            auth.shutdown();
        }
        // Don't leave agent processes behind.
        if let Some(state) = handle.try_state::<AppState>() {
            tauri::async_runtime::block_on(state.acp.stop_all());
        }
    }
}

/// Lets the webview load files from `asset_folders` (the working folder and every project's folder).
pub(crate) fn allow_asset_folders(app: &AppHandle, db: &Db, working: &str) {
    for folder in workspace::asset_folders(db, working) {
        let _ = app.asset_protocol_scope().allow_directory(&folder, true);
    }
}

/// The app's sign-in state: tokens in the OS keychain, `<app_data>/auth.json` only when it fails.
///
/// Dev builds keep the token in `<app_data>/auth-dev.json` (0600) and never touch the keychain: macOS
/// ties "Always Allow" to the binary's code signature, and every rebuild of an ad-hoc signed dev binary
/// is a new signature, so the keychain would ask for the login password after every restart.
fn auth_manager(app: &AppHandle, data_dir: &Path) -> Result<Arc<Auth>, String> {
    let store: Arc<dyn TokenStore> = if cfg!(debug_assertions) {
        Arc::new(FileStore::new(data_dir.join("auth-dev.json")))
    } else {
        Arc::new(SecureStore::new(KeyringStore, FileStore::new(data_dir.join("auth.json"))))
    };
    Auth::new(
        store,
        Arc::new(AppAccountCache(app.clone())),
        Arc::new(TauriAuthSink(app.clone())),
        std::time::Duration::from_secs(1),
    )
}

/// Starts the agents' AI endpoint (see `ai_proxy`) and keeps it in the app state. Jobs run with the
/// signed-in user's token, which never leaves Rust.
async fn start_ai_proxy(handle: AppHandle) {
    let for_folder = handle.clone();
    let folder_for = Arc::new(move |chat: &str| {
        for_folder.try_state::<AppState>().and_then(|s| workspace::chat_cwd(&s.db, &s.working(), chat).ok())
    });
    let for_run = handle.clone();
    let run: ai_proxy::Runner = Arc::new(move |job, folder| {
        let handle = for_run.clone();
        Box::pin(async move {
            let (Some(state), Some(auth)) = (handle.try_state::<AppState>(), handle.try_state::<Arc<Auth>>()) else {
                return Err((503, serde_json::json!({ "error": "unavailable", "message": "Buma is still starting" })));
            };
            let auth = auth.inner().clone();
            let base = state.api_base();
            let token = auth.token(&base).await;
            let Some(token) = token else {
                return Err((401, serde_json::json!({ "error": "signed-out", "message": "The user isn't signed in to Buma: work without AI images" })));
            };
            ai_proxy::run_job(auth.client(), &base, &token, job, &folder).await
        })
    });
    let for_act = handle.clone();
    let act: ai_proxy::Actor = Arc::new(move |chat, name, context| {
        let _ = for_act.emit(AGENT_ACTION, serde_json::json!({ "chatId": chat, "name": name, "context": context }));
    });
    match ai_proxy::start(folder_for, run, act).await {
        Ok(proxy) => {
            handle.manage(proxy);
        }
        Err(e) => eprintln!("[ai] the agents' AI endpoint couldn't start: {e}"),
    }
}
