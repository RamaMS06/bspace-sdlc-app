//! Tauri commands: the thin layer between the UI and the Rust modules.

use crate::db::Db;
use crate::system::{self, RealExec};
use crate::types::*;
use crate::acp::{AcpManager, AcpSink, PromptPart};
use crate::projects;
use crate::auth::{AccountCache, Auth, AuthSink, FileStore, KeyringStore, SecureStore};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub type CmdResult<T> = Result<T, String>;

/// Shared Tauri state.
pub struct AppState {
    pub db: Db,
    pub acp: AcpManager,
    pub home: PathBuf,
}

impl AppState {
    pub fn working(&self) -> PathBuf {
        PathBuf::from(self.db.get_settings(&self.home).working_folder)
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- system and settings ----

#[tauri::command]
pub async fn get_system_info() -> CmdResult<SystemInfo> {
    tauri::async_runtime::spawn_blocking(|| system::system_info(&RealExec))
        .await
        .map_err(err)
}

/// The operating system's preferred language, like `id-ID` or `en-US`. The webview's own
/// `navigator.language` follows the app bundle (English only), not the system, so the first-run
/// interface language is picked from this instead.
#[tauri::command]
pub fn system_locale() -> Option<String> {
    clean_locale(sys_locale::get_locale())
}

fn clean_locale(raw: Option<String>) -> Option<String> {
    raw.map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && !is_posix_default(l))
}

/// `C`, `POSIX` and values like `C.UTF-8` mean "no language chosen", not a language.
fn is_posix_default(l: &str) -> bool {
    ["C", "POSIX"].iter().any(|p| {
        l.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '@', '_', '-']))
    })
}

#[tauri::command]
pub async fn detect_agents(app: AppHandle) -> CmdResult<Vec<AgentInfo>> {
    let mut agents = tauri::async_runtime::spawn_blocking(|| system::detect_agents(&RealExec))
        .await
        .map_err(err)?;
    agents.push(api_agent_info(&app).await);
    Ok(agents)
}

#[tauri::command]
pub async fn check_tools(app: AppHandle, agent: Option<AgentId>) -> CmdResult<Vec<ToolStatus>> {
    // Figma MCP is checked in the config of the agent that will do the work.
    let claude_dir = claude_config_dir(&app).ok();
    let files = system::mcp_config_files(agent.unwrap_or(AgentId::Claude), claude_dir.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        // The user may have just installed a tool in their terminal: read their shell's PATH again.
        system::refresh_shell_path();
        system::check_tools(&RealExec, &files)
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.db.get_settings(&state.home)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> CmdResult<Settings> {
    let old_api = crate::styles_sync::effective_api_url(&state.db.get_settings(&state.home));
    let settings = state.db.update_settings(patch).map_err(err)?;
    let new_api = crate::styles_sync::effective_api_url(&settings);
    if new_api != old_api {
        // A token belongs to the API it came from: show the new API's own state.
        if let Some(auth) = app.try_state::<Arc<Auth>>() {
            let auth = auth.inner().clone();
            tauri::async_runtime::spawn(async move { auth.refresh(&new_api).await });
        }
    }
    allow_asset_folders(&app, &state.db, &settings.working_folder);
    if crate::scheduler::sync_tray(&app, &settings).is_err() {
        // No tray here: background mode is turned back off and the user is told why.
        crate::scheduler::background_off(&state.db)?;
        return Err(crate::scheduler::TRAY_UNAVAILABLE.into());
    }
    Ok(settings)
}

/// Folders the webview may load files (attachments, images, workspace files) from: the working
/// folder plus every known project's own folder, which stays put when the working
/// folder changes. Nothing else is in the asset scope.
pub fn asset_folders(db: &Db, working: &str) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(working)];
    for p in db.list_projects().unwrap_or_default() {
        let folder = PathBuf::from(&p.folder);
        if folder.is_dir() && !out.contains(&folder) {
            out.push(folder);
        }
    }
    out
}

pub fn allow_asset_folders(app: &AppHandle, db: &Db, working: &str) {
    for folder in asset_folders(db, working) {
        let _ = app.asset_protocol_scope().allow_directory(&folder, true);
    }
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)
}

// ---- projects ----

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<Project>> {
    state.db.list_projects().map_err(err)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    input: NewProject,
    brief: String,
) -> CmdResult<Project> {
    new_project(&state.db, Path::new(&state.working()), input, &brief)
}

/// A new draft project: its own folder in `working` with the brief, and its row.
pub fn new_project(db: &Db, working: &Path, input: NewProject, brief: &str) -> CmdResult<Project> {
    new_project_with(db, working, input, |dir| projects::write_project_brief(dir, brief))
}

/// `new_project` with the brief write passed in, so a test can make it fail. Whatever fails after the
/// folder exists removes it again: `create_project_folder` made it new.
fn new_project_with(
    db: &Db,
    working: &Path,
    input: NewProject,
    write_brief: impl FnOnce(&Path) -> std::io::Result<()>,
) -> CmdResult<Project> {
    let slugs: Vec<String> = db
        .list_projects()
        .map_err(err)?
        .into_iter()
        .map(|p| p.slug)
        .collect();
    let (slug, dir) = projects::create_project_folder(working, &input.title, &slugs)
        .map_err(|e| format!("Can't create the project folder: {e}"))?;
    if let Err(e) = write_brief(&dir) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("Can't write the project brief: {e}"));
    }
    let now = crate::db::now();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        title: input.title,
        slug,
        folder: dir.to_string_lossy().into_owned(),
        status: ProjectStatus::Draft,
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(e) = db.insert_project(&project) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(err(e));
    }
    Ok(project)
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    id: String,
    patch: serde_json::Value,
) -> CmdResult<Project> {
    state.db.update_project(&id, patch).map_err(err)
}

/// Moves a project to `status` (draft → building); never back unless `reset`. See `Db::set_project_status`.
#[tauri::command]
pub fn set_project_status(
    state: State<'_, AppState>,
    project_id: String,
    status: crate::types::ProjectStatus,
    reset: Option<bool>,
) -> CmdResult<Project> {
    state.db.set_project_status(&project_id, status, reset.unwrap_or(false)).map_err(err)
}

// ---- chats ----

#[tauri::command]
pub fn list_chats(state: State<'_, AppState>, project_id: Option<String>) -> CmdResult<Vec<Chat>> {
    state.db.list_chats(project_id.as_deref()).map_err(err)
}

/// The sidebar's Recent list: chats with and without a project, newest activity first.
/// Async so the query never runs on the main thread.
#[tauri::command]
pub async fn list_recent_chats(state: State<'_, AppState>, limit: Option<u32>) -> CmdResult<Vec<RecentChat>> {
    state.db.list_recent_chats(limit).map_err(err)
}

/// Archived threads for Settings › Archive.
#[tauri::command]
pub async fn list_archived_chats(state: State<'_, AppState>) -> CmdResult<Vec<RecentChat>> {
    state.db.list_archived_chats().map_err(err)
}

/// Archives (or restores) the thread a chat belongs to.
#[tauri::command]
pub fn set_thread_archived(state: State<'_, AppState>, chat_id: String, archived: bool) -> CmdResult<()> {
    state.db.set_thread_archived(&chat_id, archived).map_err(err)
}

/// What emptying the archive removed.
#[derive(serde::Serialize)]
pub struct PurgedArchive {
    chats: usize,
    cards: usize,
}

/// Deletes archived chats and cards for good. Projects and their files stay.
#[tauri::command]
pub fn purge_archive(state: State<'_, AppState>) -> CmdResult<PurgedArchive> {
    let (chats, cards) = state.db.purge_archive().map_err(err)?;
    Ok(PurgedArchive { chats, cards })
}

/// One chat by id, whether or not it belongs to a project.
pub fn lookup_chat(db: &Db, chat_id: &str) -> CmdResult<Option<Chat>> {
    db.get_chat(chat_id).map_err(err)
}

#[tauri::command]
pub fn get_chat(state: State<'_, AppState>, chat_id: String) -> CmdResult<Option<Chat>> {
    lookup_chat(&state.db, &chat_id)
}

#[tauri::command]
pub fn create_chat(
    state: State<'_, AppState>,
    project_id: Option<String>,
    agent_id: AgentId,
    title: String,
) -> CmdResult<Chat> {
    state
        .db
        .create_chat(project_id.as_deref(), agent_id, &title)
        .map_err(err)
}

/// Switches the chat to another agent. The agent id is validated by its enum on the way in.
#[tauri::command]
pub fn update_chat_agent(state: State<'_, AppState>, chat_id: String, agent_id: AgentId) -> CmdResult<Chat> {
    state
        .db
        .set_chat_agent(&chat_id, agent_id)
        .map_err(err)?
        .ok_or_else(|| format!("No chat {chat_id}"))
}

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, chat_id: String) -> CmdResult<Vec<ChatMessage>> {
    state.db.list_messages(&chat_id).map_err(err)
}

#[tauri::command]
pub fn add_message(
    state: State<'_, AppState>,
    chat_id: String,
    role: MessageRole,
    parts: Vec<MessagePart>,
) -> CmdResult<ChatMessage> {
    state.db.add_message(&chat_id, role, &parts).map_err(err)
}

// ---- jobs ----

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> CmdResult<Vec<Job>> {
    state.db.list_jobs().map_err(err)
}

#[tauri::command]
pub fn delete_job(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_job(&id).map_err(err)
}

/// Archives (or restores) board cards.
#[tauri::command]
pub fn set_jobs_archived(state: State<'_, AppState>, ids: Vec<String>, archived: bool) -> CmdResult<()> {
    state.db.set_jobs_archived(&ids, archived).map_err(err)
}

#[tauri::command]
pub fn upsert_job(state: State<'_, AppState>, job: Job) -> CmdResult<()> {
    state.db.upsert_job(&job).map_err(err)
}

// ---- sign in ----

struct TauriAuthSink(AppHandle);

impl AuthSink for TauriAuthSink {
    fn changed(&self, status: &AuthStatus) {
        let _ = self.0.emit(crate::auth::EVENT, status);
    }
}

/// The account cache in the app database (managed after this is made, so looked up per call).
struct AppAccountCache(AppHandle);

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

/// The app's sign-in state: tokens in the OS keychain, `<app_data>/auth.json` only when it fails.
///
/// Dev builds keep the token in `<app_data>/auth-dev.json` (0600) and never touch the keychain: macOS
/// ties "Always Allow" to the binary's code signature, and every rebuild of an ad-hoc signed dev binary
/// is a new signature, so the keychain would ask for the login password after every restart.
pub fn auth_manager(app: &AppHandle, data_dir: &Path) -> Result<Arc<Auth>, String> {
    let store: Arc<dyn crate::auth::TokenStore> = if cfg!(debug_assertions) {
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

/// `BUMA_API_URL` when it is set: it wins over the API address in Settings (a dev setup).
#[tauri::command]
pub fn api_url_override() -> Option<String> {
    std::env::var("BUMA_API_URL").ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn api_base(state: &AppState) -> String {
    crate::styles_sync::effective_api_url(&state.db.get_settings(&state.home))
}

/// `auth:<code>`, the code being the kebab-case `AuthError` the UI knows.
fn auth_err(e: AuthError) -> String {
    let code = serde_json::to_value(e).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
    format!("auth:{code}")
}

/// Starts signing in: gets a code from the API, opens the browser and polls in the background.
/// Errors are `auth:<code>`; `auth:cancelled` when a cancel came first.
#[tauri::command]
pub async fn auth_start(app: AppHandle, state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<AuthStart> {
    let base = api_base(&state);
    match auth.start(&base).await {
        Ok(Some(started)) => {
            use tauri_plugin_opener::OpenerExt;
            // The dialog has "Open browser again" for when this doesn't work.
            if let Err(e) = app.opener().open_url(&started.verification_uri_complete, None::<&str>) {
                eprintln!("[auth] couldn't open the browser: {e}");
            }
            Ok(started)
        }
        Ok(None) => Err("auth:cancelled".into()),
        Err(e) => Err(auth_err(e)),
    }
}

#[tauri::command]
pub fn auth_cancel(auth: State<'_, Arc<Auth>>) {
    auth.cancel();
}

#[tauri::command]
pub fn auth_status(auth: State<'_, Arc<Auth>>) -> AuthStatus {
    auth.status()
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<()> {
    let base = api_base(&state);
    auth.logout(&base).await.map_err(auth_err)
}

// ---- the Buma account's AI credits ----

/// `cloud:<code>`, the code being the kebab-case `CloudError` the UI knows.
fn cloud_err(e: crate::cloud::CloudError) -> String {
    format!("cloud:{}", e.code())
}

/// The API base and the stored sign-in token, or `cloud:signed-out`.
async fn cloud_token(state: &AppState, auth: &Arc<Auth>) -> Result<(String, String), String> {
    let base = api_base(state);
    let token = auth.token(&base).await.ok_or_else(|| cloud_err(crate::cloud::CloudError::SignedOut))?;
    Ok((base, token))
}

/// A 401 means the token is gone at the API: let the sign-in state find out (it clears it).
fn after_cloud<T>(auth: &Arc<Auth>, base: &str, what: &str, r: Result<T, crate::cloud::CloudError>) -> CmdResult<T> {
    if let Err(e) = &r {
        eprintln!("[cloud] {what}: {}", e.code());
        if *e == crate::cloud::CloudError::SignedOut {
            let (auth, base) = (auth.clone(), base.to_string());
            tauri::async_runtime::spawn(async move { auth.refresh(&base).await });
        }
    }
    r.map_err(cloud_err)
}

/// AI credits left in this cycle (`GET /v1/usage`).
#[tauri::command]
pub async fn cloud_usage(state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<serde_json::Value> {
    let auth = auth.inner().clone();
    let (base, token) = cloud_token(&state, &auth).await?;
    after_cloud(&auth, &base, "usage", crate::cloud::get(auth.client(), &base, &token, "/v1/usage").await)
}

// ---- AI images for agents ----

/// The folder a chat's agent works in (its project's, else its own under the working folder).
fn agent_folder(state: &AppState, chat_id: &str) -> Option<PathBuf> {
    let folder = project_folder_for_chat(state, chat_id).ok()?;
    resolve_cwd(&state.working(), chat_id, folder.as_deref()).ok()
}

/// Starts the agents' AI endpoint (see `ai_proxy`) and keeps it in the app state. Jobs run with the
/// signed-in user's token, which never leaves Rust.
pub async fn start_ai_proxy(handle: AppHandle) {
    let for_folder = handle.clone();
    let folder_for = Arc::new(move |chat: &str| for_folder.try_state::<AppState>().and_then(|s| agent_folder(&s, chat)));
    let for_run = handle.clone();
    let run: crate::ai_proxy::Runner = Arc::new(move |job, folder| {
        let handle = for_run.clone();
        Box::pin(async move {
            let (Some(state), Some(auth)) = (handle.try_state::<AppState>(), handle.try_state::<Arc<Auth>>()) else {
                return Err((503, serde_json::json!({ "error": "unavailable", "message": "Buma is still starting" })));
            };
            let auth = auth.inner().clone();
            let base = api_base(&state);
            let token = auth.token(&base).await;
            let Some(token) = token else {
                return Err((401, serde_json::json!({ "error": "signed-out", "message": "The user isn't signed in to Buma: work without AI images" })));
            };
            crate::ai_proxy::run_job(auth.client(), &base, &token, job, &folder).await
        })
    });
    let for_act = handle.clone();
    let act: crate::ai_proxy::Actor = Arc::new(move |chat, name, context| {
        let _ = for_act.emit("agent://action", serde_json::json!({ "chatId": chat, "name": name, "context": context }));
    });
    match crate::ai_proxy::start(folder_for, run, act).await {
        Ok(proxy) => {
            handle.manage(proxy);
        }
        Err(e) => eprintln!("[ai] the agents' AI endpoint couldn't start: {e}"),
    }
}

// ---- agent ----

struct TauriSink(AppHandle);

impl AcpSink for TauriSink {
    fn update(&self, chat_id: &str, u: AgentUpdate) {
        let _ = self.0.emit("agent://update", serde_json::json!({ "chatId": chat_id, "update": u }));
    }

    fn permission(&self, req: PermissionRequest) {
        let _ = self.0.emit("agent://permission", req);
    }

    fn question(&self, q: crate::types::AgentQuestion) {
        let _ = self.0.emit("agent://question", q);
    }
}

/// A chat id that is safe to use as a single folder name.
fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

/// Attaches a folder to a chat (its agent works there from the next session), or detaches it.
#[tauri::command]
pub fn set_chat_folder(state: State<'_, AppState>, chat_id: String, folder: Option<String>) -> CmdResult<Chat> {
    let folder = match folder {
        Some(f) => {
            let p = PathBuf::from(&f);
            if !p.is_absolute() || !p.is_dir() {
                return Err(format!("{f} is not a folder on this computer"));
            }
            Some(p.to_string_lossy().into_owned())
        }
        None => None,
    };
    state
        .db
        .set_chat_folder(&chat_id, folder.as_deref())
        .map_err(err)?
        .ok_or_else(|| "This chat no longer exists".to_string())
}

/// Moves a chat into a project: a feature started from a chat that began without one.
#[tauri::command]
pub fn set_chat_project(state: State<'_, AppState>, chat_id: String, project_id: String) -> CmdResult<Chat> {
    state
        .db
        .set_chat_project(&chat_id, &project_id)
        .map_err(err)?
        .ok_or_else(|| "This chat no longer exists".to_string())
}

/// Where this chat's agent runs. `project_folder` is the recorded folder of the chat's
/// (known) project, when it has one: that folder is used as is, even if the working
/// folder has changed since, as long as it still exists. Every other chat runs inside
/// `working`.
pub fn resolve_cwd(
    working: &Path,
    chat_id: &str,
    project_folder: Option<&Path>,
) -> CmdResult<PathBuf> {
    if let Some(folder) = project_folder {
        if !folder.is_dir() {
            return Err(format!("This project's folder is missing: {}", folder.display()));
        }
        return Ok(folder.to_path_buf());
    }
    let cwd = if chat_id == "setup" {
        working.join(".buma").join("setup")
    } else {
        if !safe_segment(chat_id) {
            return Err("That chat isn't valid".into());
        }
        working.join(".buma").join("chats").join(chat_id)
    };
    std::fs::create_dir_all(working).map_err(|e| format!("Can't create the working folder: {e}"))?;
    if !projects::ensure_inside(working, &cwd) {
        return Err("The agent can only work inside your working folder".into());
    }
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Can't create {}: {e}", cwd.display()))?;
    Ok(cwd)
}

/// The folder a chat's agent works in when it isn't the default: its project's, else a folder the user
/// attached to the chat.
fn project_folder_for_chat(state: &AppState, chat_id: &str) -> CmdResult<Option<PathBuf>> {
    let chat = state.db.get_chat(chat_id).map_err(err)?;
    let attached = chat.as_ref().and_then(|c| c.folder.clone());
    let Some(project_id) = chat.and_then(|c| c.project_id) else {
        return Ok(attached.map(PathBuf::from));
    };
    let project = state
        .db
        .get_project(&project_id)
        .map_err(err)?
        .ok_or("This chat's project no longer exists")?;
    Ok(Some(PathBuf::from(project.folder)))
}

/// Added to Claude's system prompt for sessions Buma starts.
pub const BUMA_APPEND: &str = "You are running inside BSpace SDLC, BUMA's desktop app for taking a feature from \
idea to deploy. Work with the bspace-sdlc-skills plugin: start from the using-bspace-sdlc skill, which routes by the \
files on disk. When the user has to choose, ask with your AskUserQuestion tool: Buma shows it as a card with the \
options. Never write JSON or markup for a choice.";

/// The Buma agent plugin in the repo, used when the bundled copy is missing (`tauri dev`).
/// Debug builds only: a release build must never reach into the build machine's checkout.
fn dev_plugin_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("skills")
        .join("agent-plugin");
    dir.join(".claude-plugin").join("plugin.json").is_file().then_some(dir)
}

/// The repo copy in debug builds (it is the one being edited; the build's copy in target/ goes stale,
/// a skill deleted from the repo stays there), else `<resource dir>/agent-plugin` when it holds the plugin.
/// `None` means Claude starts without the plugin, and the skills go into its first prompt instead.
fn plugin_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let found = dev_plugin_dir().or_else(|| {
        resource_dir
            .map(|r| r.join("agent-plugin"))
            .filter(|p| p.join(".claude-plugin").join("plugin.json").is_file())
    });
    if found.is_none() {
        eprintln!(
            "[buma] warning: agent-plugin/.claude-plugin/plugin.json is missing from the app resources; \
             Claude gets the Buma skills in its first prompt instead"
        );
    }
    found
}

/// The internal session (the setup installs) never talks to the user in a chat, so it gets neither
/// the plugin nor the system prompt.
pub fn wants_skills(chat_id: &str) -> bool {
    chat_id != "setup"
}

/// What a chat is for, as the usage log names it.
pub fn chat_kind(chat_id: &str, has_project: bool) -> &'static str {
    if chat_id == "setup" {
        "setup"
    } else if has_project {
        "project"
    } else {
        "chat"
    }
}

/// opencode logs a failed model call (a free model's usage limit) and then never answers the prompt:
/// its log, for the session to watch. None for other agents.
fn error_log(agent: AgentId) -> Option<PathBuf> {
    if !matches!(agent, AgentId::Opencode | AgentId::Custom) {
        return None;
    }
    let home = crate::system::home_dir()?;
    let db = crate::usage::opencode_db(&home, std::env::var("XDG_DATA_HOME").ok().as_deref());
    Some(db.parent()?.join("log").join("opencode.log"))
}

/// Claude gets the plugin and the system prompt through `_meta` (so nothing is
/// installed in the user's own `~/.claude`); every agent gets `BSPACE_SDLC_APP=1`.
/// Without `skills` (internal sessions) there is no `_meta` at all.
fn session_options(agent: AgentId, plugin: Option<&Path>, skills: bool) -> crate::acp::SessionOptions {
    let env = vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())];
    let use_modes = agent == AgentId::Claude;
    if agent != AgentId::Claude || !skills {
        return crate::acp::SessionOptions { meta: None, authenticate: None, env, auto: false, use_modes, mode_timeout: None, model: None, error_log: error_log(agent), usage_log: None };
    }
    let mut meta = serde_json::json!({ "systemPrompt": { "append": BUMA_APPEND } });
    if let Some(path) = plugin {
        meta["claudeCode"] = serde_json::json!({
            "options": { "plugins": [{ "type": "local", "path": path.to_string_lossy() }] }
        });
    }
    crate::acp::SessionOptions { meta: Some(meta), authenticate: None, env, auto: false, use_modes, mode_timeout: None, model: None, error_log: error_log(agent), usage_log: None }
}

/// Adds a local plugin to a Claude session that has `_meta` (sessions without it get no plugins).
fn add_plugin(options: &mut crate::acp::SessionOptions, path: &Path) {
    let Some(meta) = options.meta.as_mut() else { return };
    let entry = serde_json::json!({ "type": "local", "path": path.to_string_lossy() });
    match meta["claudeCode"]["options"]["plugins"].as_array_mut() {
        Some(list) => list.push(entry),
        None => meta["claudeCode"] = serde_json::json!({ "options": { "plugins": [entry] } }),
    }
}

// ---- plugins (the Skills screen's Plugins tab, see plugins.rs) ----

fn plugins_root(app: &AppHandle) -> CmdResult<PathBuf> {
    crate::plugins::root(&app.path().app_data_dir().map_err(err)?)
}

fn bundled_plugin(app: &AppHandle) -> Option<PathBuf> {
    plugin_dir(app.path().resource_dir().ok().as_deref())
}

/// The bundled plugin and every installed one, with what is on.
#[tauri::command]
pub fn plugins_list(app: AppHandle) -> CmdResult<Vec<crate::plugins::PluginInfo>> {
    Ok(crate::plugins::list(&plugins_root(&app)?, bundled_plugin(&app).as_deref()))
}

/// Reads a plugin (or a repo of them) from a folder, for the user to check before installing.
#[tauri::command]
pub async fn plugin_stage_folder(app: AppHandle, path: String) -> CmdResult<crate::plugins::Staged> {
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || crate::plugins::stage(&root, Path::new(&path))).await.map_err(err)?
}

/// Unpacks a .zip of a plugin (or a repo of them), for the user to check before installing.
#[tauri::command]
pub async fn plugin_stage_zip(app: AppHandle, path: String) -> CmdResult<crate::plugins::Staged> {
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("Can't read {path}: {e}"))?;
        let tmp = root.join(".staging").join(format!("zip-{}", uuid::Uuid::new_v4().simple()));
        let result = crate::skills_github::unpack(&bytes, &tmp).and_then(|_| crate::plugins::stage(&root, &tmp));
        let _ = std::fs::remove_dir_all(&tmp);
        result
    })
    .await
    .map_err(err)?
}

/// Downloads a GitHub repo (or a folder in it) and reads the plugins in it, for the user to check.
#[tauri::command]
pub async fn plugin_stage_github(app: AppHandle, url: String) -> CmdResult<crate::plugins::Staged> {
    use crate::skills_github as gh;
    let link = gh::parse_link(&url)?;
    let root = plugins_root(&app)?;
    let client = api_client(std::time::Duration::from_secs(90))?;
    let mut resp = client.get(link.archive_url()).send().await.map_err(|_| "Couldn't reach GitHub. Are you online?".to_string())?;
    match resp.status().as_u16() {
        200..=299 => {}
        404 => return Err("Nothing at that link. Check it, and note that private repos can't be added".into()),
        code => return Err(format!("GitHub didn't send the repo (error {code}). Try again in a minute")),
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "The download stopped. Try again".to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > gh::DOWNLOAD_LIMIT {
            return Err(format!("That repo is over {} MB, too big to add", gh::DOWNLOAD_LIMIT / 1024 / 1024));
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = root.join(".staging").join(format!("gh-{}", uuid::Uuid::new_v4().simple()));
        let result = gh::unpack(&bytes, &tmp).and_then(|_| {
            // The archive's top folder, then the folder the link points at.
            let top = std::fs::read_dir(&tmp).ok().and_then(|mut d| d.next()).and_then(|e| e.ok()).map(|e| e.path()).unwrap_or_else(|| tmp.clone());
            crate::plugins::stage(&root, &top.join(&link.path))
        });
        let _ = std::fs::remove_dir_all(&tmp);
        result
    })
    .await
    .map_err(err)?
}

/// Installs what was staged (replacing older versions). New sessions load it.
#[tauri::command]
pub fn plugin_install(app: AppHandle, id: String) -> CmdResult<Vec<crate::plugins::PluginInfo>> {
    let root = plugins_root(&app)?;
    crate::plugins::commit(&root, &id)?;
    Ok(crate::plugins::list(&root, bundled_plugin(&app).as_deref()))
}

#[tauri::command]
pub fn plugin_discard(app: AppHandle, id: String) -> CmdResult<()> {
    crate::plugins::discard(&plugins_root(&app)?, &id)
}

/// Removes an installed plugin; an update of the bundled one goes back to the bundled version.
#[tauri::command]
pub fn plugin_remove(app: AppHandle, name: String) -> CmdResult<Vec<crate::plugins::PluginInfo>> {
    let root = plugins_root(&app)?;
    crate::plugins::remove(&root, &name)?;
    Ok(crate::plugins::list(&root, bundled_plugin(&app).as_deref()))
}

#[tauri::command]
pub fn plugin_set_enabled(app: AppHandle, name: String, enabled: bool) -> CmdResult<Vec<crate::plugins::PluginInfo>> {
    let root = plugins_root(&app)?;
    crate::plugins::set_enabled(&root, &name, enabled)?;
    Ok(crate::plugins::list(&root, bundled_plugin(&app).as_deref()))
}

fn skills_root(app: &AppHandle) -> CmdResult<PathBuf> {
    crate::skills::root(&app.path().app_data_dir().map_err(err)?)
}

/// The user's own skills, on and off.
#[tauri::command]
pub fn skills_list(app: AppHandle) -> CmdResult<Vec<crate::skills::Skill>> {
    Ok(crate::skills::list(&skills_root(&app)?))
}

#[tauri::command]
pub fn skill_read(app: AppHandle, id: String) -> CmdResult<crate::skills::SkillDetail> {
    crate::skills::read(&skills_root(&app)?, &id)
}

/// Creates a skill (no `id`) or saves an existing one's description and instructions.
#[tauri::command]
pub fn skill_save(
    app: AppHandle,
    id: Option<String>,
    name: String,
    description: String,
    body: String,
) -> CmdResult<crate::skills::Skill> {
    let root = skills_root(&app)?;
    match id {
        Some(id) => crate::skills::update(&root, &id, &description, &body),
        None => crate::skills::create(&root, &name, &description, &body),
    }
}

#[tauri::command]
pub fn skill_set_enabled(app: AppHandle, id: String, enabled: bool) -> CmdResult<crate::skills::Skill> {
    crate::skills::set_enabled(&skills_root(&app)?, &id, enabled)
}

#[tauri::command]
pub fn skill_delete(app: AppHandle, id: String) -> CmdResult<()> {
    crate::skills::delete(&skills_root(&app)?, &id)
}

/// Adds a skill from a SKILL.md file or a folder with one.
#[tauri::command]
pub fn skill_import(app: AppHandle, path: String) -> CmdResult<crate::skills::Skill> {
    crate::skills::import(&skills_root(&app)?, Path::new(&path))
}

/// Skills found at a GitHub link, waiting in a download for the user to choose.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDownload {
    id: String,
    skills: Vec<crate::skills_github::FoundSkill>,
}

/// Downloads the repo at a GitHub link and lists the skills in it. Only one download is kept.
#[tauri::command]
pub async fn skill_github_fetch(app: AppHandle, url: String) -> CmdResult<SkillDownload> {
    use crate::skills_github as gh;
    let link = gh::parse_link(&url)?;
    let data = app.path().app_data_dir().map_err(err)?;
    let _ = std::fs::remove_dir_all(data.join("skill-downloads"));
    let client = api_client(std::time::Duration::from_secs(90))?;
    let mut resp = client.get(link.archive_url()).send().await.map_err(|_| "Couldn't reach GitHub. Are you online?".to_string())?;
    match resp.status().as_u16() {
        200..=299 => {}
        404 => return Err("Nothing at that link. Check it, and note that private repos can't be added".into()),
        code => return Err(format!("GitHub didn't send the repo (error {code}). Try again in a minute")),
    }
    let too_big = || format!("That repo is over {} MB, too big to add skills from", gh::DOWNLOAD_LIMIT / 1024 / 1024);
    if resp.content_length().is_some_and(|n| n > gh::DOWNLOAD_LIMIT) {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "The download stopped. Try again".to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > gh::DOWNLOAD_LIMIT {
            return Err(too_big());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let dir = gh::download_dir(&data, &id)?;
    let found = tokio::task::spawn_blocking(move || {
        let result = gh::unpack(&bytes, &dir).and_then(|_| gh::find_skills(&dir, &link.path));
        match result {
            Ok(skills) => Ok(skills.into_iter().map(|s| gh::FoundSkill { source: link.folder_url(&s.folder), ..s }).collect()),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                Err(e)
            }
        }
    })
    .await
    .map_err(err)??;
    Ok(SkillDownload { id, skills: found })
}

/// One skill the user chose from a download.
#[derive(serde::Deserialize)]
pub struct SkillPick {
    folder: String,
    source: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstall {
    added: Vec<crate::skills::Skill>,
    /// "folder: why" for each that couldn't be added.
    failed: Vec<String>,
}

/// Adds the chosen skills from a download (each with its files), then removes the download.
#[tauri::command]
pub fn skill_github_install(app: AppHandle, id: String, picks: Vec<SkillPick>) -> CmdResult<SkillInstall> {
    let dir = crate::skills_github::download_dir(&app.path().app_data_dir().map_err(err)?, &id)?;
    if !dir.is_dir() {
        return Err("That download is gone. Paste the link again".into());
    }
    let root = skills_root(&app)?;
    let base = dir.canonicalize().map_err(err)?;
    let (mut added, mut failed) = (Vec::new(), Vec::new());
    for p in picks {
        let folder = dir.join(&p.folder);
        let inside = folder.canonicalize().is_ok_and(|f| f.starts_with(&base));
        let result = if inside { crate::skills::import_from(&root, &folder, &p.source) } else { Err("not in the download".into()) };
        match result {
            Ok(s) => added.push(s),
            Err(e) => failed.push(format!("{}: {e}", if p.folder.is_empty() { "SKILL.md" } else { &p.folder })),
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(SkillInstall { added, failed })
}

/// Throws away a download the user closed without adding anything.
#[tauri::command]
pub fn skill_github_discard(app: AppHandle, id: String) -> CmdResult<()> {
    let dir = crate::skills_github::download_dir(&app.path().app_data_dir().map_err(err)?, &id)?;
    let _ = std::fs::remove_dir_all(dir);
    Ok(())
}

/// Buma's own Claude Code config folder (see `claude_account`), created on first use.
/// The Claude config folder of the active Claude account (the default: Buma's own `claude` folder).
pub fn claude_config_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let data = app.path().app_data_dir().map_err(err)?;
    let id = crate::accounts::active(&crate::accounts::load(&data), AgentId::Claude, "claude");
    let dir = crate::accounts::dir(&data, AgentId::Claude, &id).unwrap_or_else(|| crate::claude_account::config_dir(&data));
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// `CLAUDE_CONFIG_DIR` for a Claude session: Buma's own sign-in and a clean setup. Nothing for
/// other agents.
fn claude_env(app: &AppHandle, agent: AgentId) -> CmdResult<Vec<(String, String)>> {
    if agent != AgentId::Claude {
        // Codex and opencode on an extra account: their sign-in lives in that account's folder.
        let data = app.path().app_data_dir().map_err(err)?;
        let id = crate::accounts::active(&crate::accounts::load(&data), agent, &agent_key(agent));
        return Ok(match crate::accounts::dir(&data, agent, &id) {
            Some(d) if crate::accounts::supports_accounts(agent) => crate::accounts::env_for(agent, &d),
            _ => Vec::new(),
        });
    }
    let dir = claude_config_dir(app)?;
    Ok(vec![(crate::claude_account::CONFIG_ENV.to_string(), dir.to_string_lossy().into_owned())])
}

fn claude_program() -> CmdResult<PathBuf> {
    system::Exec::which(&RealExec, "claude").ok_or_else(|| "Can't find Claude Code on this computer".to_string())
}

/// The Claude sign-in that is waiting for the browser, so it can be cancelled.
#[derive(Default)]
pub struct ClaudeSignIn(pub std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>);

/// The event with the sign-in page, for when the browser didn't open by itself.
pub const CLAUDE_SIGN_IN_URL_EVENT: &str = "claude://sign-in-url";

/// Who is signed in to Claude in Buma.
#[tauri::command]
pub async fn claude_account(app: AppHandle) -> CmdResult<crate::claude_account::ClaudeAccount> {
    let dir = claude_config_dir(&app)?;
    let Ok(claude) = claude_program() else { return Ok(Default::default()) };
    Ok(crate::claude_account::status(&claude, &dir).await)
}

/// Signs in to Claude for Buma: Claude Code opens the browser and the user signs in there.
/// Resolves with the account once they're done; an error when cancelled, timed out or refused.
#[tauri::command]
pub async fn claude_sign_in(
    app: AppHandle,
    pending: State<'_, ClaudeSignIn>,
    usage: State<'_, crate::usage::UsageCache>,
) -> CmdResult<crate::claude_account::ClaudeAccount> {
    use crate::claude_account::{sign_in, status, SignInEnd, SIGN_IN_TIMEOUT};
    let dir = claude_config_dir(&app)?;
    let claude = claude_program()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    // A new sign-in replaces one still waiting.
    if let Some(old) = pending.0.lock().map_err(err)?.replace(tx) {
        let _ = old.send(());
    }
    let emitter = app.clone();
    let end = sign_in(&claude, &dir, SIGN_IN_TIMEOUT, rx, move |url| {
        let _ = emitter.emit(CLAUDE_SIGN_IN_URL_EVENT, url);
    })
    .await;
    *usage.0.lock().map_err(err)? = None;
    match end {
        SignInEnd::Done => {
            let account = status(&claude, &dir).await;
            if account.signed_in {
                Ok(account)
            } else {
                Err("Claude didn't finish signing in. Try again".into())
            }
        }
        SignInEnd::Cancelled => Err("cancelled".into()),
        SignInEnd::TimedOut => Err("Signing in took too long. Try again".into()),
        SignInEnd::Failed(why) => Err(why),
    }
}

/// Stops a sign-in that is waiting for the browser.
#[tauri::command]
pub fn claude_sign_in_cancel(pending: State<'_, ClaudeSignIn>) -> CmdResult<()> {
    if let Some(tx) = pending.0.lock().map_err(err)?.take() {
        let _ = tx.send(());
    }
    Ok(())
}

/// Signs out of Claude in Buma. Running Claude chats keep going until they end.
#[tauri::command]
pub async fn claude_sign_out(
    app: AppHandle,
    usage: State<'_, crate::usage::UsageCache>,
) -> CmdResult<crate::claude_account::ClaudeAccount> {
    let dir = claude_config_dir(&app)?;
    let claude = claude_program()?;
    *usage.0.lock().map_err(err)? = None;
    Ok(crate::claude_account::sign_out(&claude, &dir).await)
}

/// Starts the chat's agent. Resolves `true` when Claude started without the Buma
/// plugin, so the caller must send the skills as text in the first prompt (other
/// agents always get them that way).
#[tauri::command]
pub async fn agent_start(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    agent_id: AgentId,
    auto: Option<bool>,
) -> CmdResult<bool> {
    let (command, launch_env) = agent_launch(&app, agent_id).await?;
    let folder = project_folder_for_chat(&state, &chat_id)?;
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    let resource_dir = app.path().resource_dir().ok();
    let skills = wants_skills(&chat_id);
    // Every plugin that is on: the bundled bspace-sdlc-skills (unless an installed update replaces it)
    // and the ones installed on the Skills screen.
    let plugins: Vec<PathBuf> = if agent_id == AgentId::Claude && skills {
        let bundled = plugin_dir(resource_dir.as_deref());
        match app.path().app_data_dir().ok().and_then(|d| crate::plugins::root(&d).ok()) {
            Some(root) => crate::plugins::active_paths(&root, bundled.as_deref()),
            None => bundled.into_iter().collect(),
        }
    } else {
        Vec::new()
    };
    let plugin = plugins.first().cloned();
    let mut options = session_options(agent_id, plugin.as_deref(), skills);
    for more in plugins.iter().skip(1) {
        add_plugin(&mut options, more);
    }
    // The user's own skills (the Skills screen) load as a second plugin.
    if agent_id == AgentId::Claude && skills {
        if let Some(mine) = app.path().app_data_dir().ok().and_then(|d| crate::skills::root(&d).ok()).and_then(|r| crate::skills::plugin(&r)) {
            add_plugin(&mut options, &mine);
        }
    }
    options.env.extend(claude_env(&app, agent_id)?);
    options.env.extend(launch_env);
    options.auto = wants_auto(&chat_id, auto.unwrap_or(false));
    options.model = picked_model(&state, agent_id);
    options.usage_log = app.path().app_data_dir().ok().map(|dir| crate::acp::UsageLog {
        path: dir.join("agent-usage.jsonl"),
        agent: agent_key(agent_id),
        kind: chat_kind(&chat_id, folder.is_some()).to_string(),
    });
    // AI images with the user's credits: this session's own token for Buma's endpoint.
    if let Some(proxy) = app.try_state::<Arc<crate::ai_proxy::AiProxy>>() {
        options.env.extend(proxy.session_env(&chat_id));
    }
    let skills_as_text = skills && needs_skills_text(agent_id, plugin.as_deref());
    state
        .acp
        .start_with(&chat_id, &command, &cwd, Arc::new(TauriSink(app)), options)
        .await
        .map_err(err)?;
    Ok(skills_as_text)
}

fn agent_key(agent: AgentId) -> String {
    serde_json::to_value(agent).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

/// The model the user picked for this agent, if any.
fn picked_model(state: &AppState, agent: AgentId) -> Option<String> {
    state.db.get_settings(&state.home).agent_models.get(&agent_key(agent)).cloned()
}

/// The models an agent offers, and the one in use.
#[derive(serde::Serialize)]
pub struct AgentModels {
    current: Option<String>,
    options: Vec<crate::types::ModelChoice>,
}

/// Picks the model for an agent (None: its own default) and, when `chat_id` has a session
/// running, switches that session now. Later sessions of the agent start on it.
#[tauri::command]
pub async fn set_agent_model(
    state: State<'_, AppState>,
    agent_id: AgentId,
    model: Option<String>,
    chat_id: Option<String>,
) -> CmdResult<Settings> {
    let settings = state
        .db
        .update_settings(serde_json::json!({ "agentModels": { agent_key(agent_id): model } }))
        .map_err(err)?;
    if let (Some(chat), Some(value)) = (chat_id.as_deref(), model.as_deref()) {
        // No session yet is fine: it starts on the picked model.
        if state.acp.models(chat).is_ok() {
            state.acp.set_model(chat, value).await.map_err(err)?;
        }
    }
    Ok(settings)
}

/// Never shows anything: a probe session's updates go nowhere.
struct QuietSink;
impl crate::acp::AcpSink for QuietSink {
    fn update(&self, _chat_id: &str, _u: AgentUpdate) {}
    fn permission(&self, _req: crate::types::PermissionRequest) {}
}

/// The models an agent offers, read by opening a short session in a scratch folder (for the picker
/// before any chat with that agent has run). None when the agent doesn't report models.
/// The npm package that installs each agent's CLI (Add connection's Install). Claude and Codex run
/// through `npx` and need none; Antigravity and Cursor have their own installers.
pub fn agent_npm_package(agent: AgentId) -> Option<&'static str> {
    match agent {
        AgentId::Claude => Some("@anthropic-ai/claude-code"),
        AgentId::Codex => Some("@openai/codex"),
        AgentId::Gemini => Some("@google/gemini-cli"),
        AgentId::Opencode => Some("opencode-ai"),
        _ => None,
    }
}

/// Installs an agent's CLI with npm (`npm install -g`), for Add connection. The error is npm's last lines.
#[tauri::command]
pub async fn agent_install(agent_id: AgentId) -> CmdResult<()> {
    if agent_id == AgentId::Cursor {
        // Cursor's own installer script (it is not on npm): downloaded from cursor.com and run.
        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("powershell");
            c.args(["-NoProfile", "-Command", "irm 'https://cursor.com/install?win32=true' | iex"]);
            c
        } else {
            let mut c = tokio::process::Command::new("bash");
            c.args(["-c", "curl -fsS https://cursor.com/install | bash"]);
            c
        };
        let out = cmd.env("PATH", system::augmented_path()).output().await.map_err(|e| format!("Couldn't run the installer: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = text.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(tail.join("\n").into());
    }
    let pkg = agent_npm_package(agent_id).ok_or("This agent has its own installer")?;
    let out = tokio::process::Command::new(system::Exec::which(&RealExec, "npm").unwrap_or_else(|| "npm".into()))
        .args(["install", "-g", pkg])
        .env("PATH", system::augmented_path())
        .output()
        .await
        .map_err(|e| format!("Couldn't run npm: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = text.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    Err(tail.join("\n").into())
}

// ---- accounts (several per platform) ----

/// One account of an agent, for Settings › Agents › Provider.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub agent: AgentId,
    /// Who is signed in (an email), when that is known.
    pub account: Option<String>,
    pub signed_in: bool,
    pub active: bool,
}

/// Who is signed in to one account of an agent.
async fn account_view(data: &Path, home: &Path, f: &crate::accounts::AccountsFile, agent: AgentId, id: &str) -> AccountView {
    let dir = crate::accounts::dir(data, agent, id);
    let (signed_in, account) = match agent {
        AgentId::Claude => match (claude_program(), dir.as_deref()) {
            (Ok(claude), Some(d)) => {
                let a = crate::claude_account::status(&claude, d).await;
                (a.signed_in, a.email)
            }
            _ => (false, None),
        },
        _ => {
            let account = match dir.as_deref() {
                Some(d) => system::account_in(agent, d),
                None => system::agent_account(agent, home),
            };
            let saved = match dir.as_deref() {
                Some(d) => system::account_files_in(agent, d).iter().any(|p| p.is_file()),
                None => system::credential_files(agent, home).iter().any(|p| p.is_file()),
            };
            (saved, account)
        }
    };
    AccountView { id: id.to_string(), agent, account, signed_in, active: crate::accounts::active(f, agent, &agent_key(agent)) == id }
}

/// Every account of the agents that can have several (Claude, Codex, opencode): the default one first.
#[tauri::command]
pub async fn accounts_list(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Vec<AccountView>> {
    let data = app.path().app_data_dir().map_err(err)?;
    let f = crate::accounts::load(&data);
    let mut out = Vec::new();
    for agent in [AgentId::Claude, AgentId::Codex, AgentId::Opencode] {
        out.push(account_view(&data, &state.home, &f, agent, crate::accounts::DEFAULT).await);
        for e in f.extra.iter().filter(|e| e.agent == agent) {
            out.push(account_view(&data, &state.home, &f, agent, &e.id).await);
        }
    }
    Ok(out)
}

/// Adds an account to an agent (signed out until `account_sign_in`); returns its id.
#[tauri::command]
pub fn account_add(app: AppHandle, agent_id: AgentId) -> CmdResult<String> {
    if !crate::accounts::supports_accounts(agent_id) {
        return Err("This agent has one account".into());
    }
    let data = app.path().app_data_dir().map_err(err)?;
    crate::accounts::add(&data, agent_id, &uuid::Uuid::new_v4().to_string()).map_err(err)
}

/// Removes an extra account: signs it out (Claude's sign-in is in the Keychain) and deletes its folder.
#[tauri::command]
pub async fn account_remove(app: AppHandle, agent_id: AgentId, id: String) -> CmdResult<()> {
    let data = app.path().app_data_dir().map_err(err)?;
    if agent_id == AgentId::Claude && id != crate::accounts::DEFAULT {
        if let Ok(claude) = claude_program() {
            let _ = crate::claude_account::sign_out(&claude, &crate::accounts::extra_dir(&data, &id)).await;
        }
    }
    crate::accounts::remove(&data, &id).map_err(err)
}

/// Signs one account out. Claude: `claude auth logout` in that account's folder. Codex, opencode and
/// Gemini: their sign-in files are deleted (for the default account that is the CLI's own sign-in on
/// this computer, which the UI says before asking).
#[tauri::command]
pub async fn account_sign_out(app: AppHandle, state: State<'_, AppState>, usage: State<'_, crate::usage::UsageCache>, agent_id: AgentId, id: String) -> CmdResult<()> {
    let data = app.path().app_data_dir().map_err(err)?;
    let dir = crate::accounts::dir(&data, agent_id, &id);
    *usage.0.lock().map_err(err)? = None;
    if agent_id == AgentId::Claude {
        let dir = dir.ok_or("No folder for this account")?;
        let claude = claude_program()?;
        let _ = crate::claude_account::sign_out(&claude, &dir).await;
        return Ok(());
    }
    let files = crate::accounts::sign_out_files(agent_id, dir.as_deref(), &state.home);
    if files.is_empty() {
        return Err("Buma can't sign this agent out. Sign out in its own app".into());
    }
    for f in files.iter().filter(|f| f.is_file()) {
        std::fs::remove_file(f).map_err(err)?;
    }
    Ok(())
}

/// Makes an account the agent's active one: new sessions of the agent start on it.
#[tauri::command]
pub fn account_use(app: AppHandle, usage: State<'_, crate::usage::UsageCache>, agent_id: AgentId, id: String) -> CmdResult<()> {
    let data = app.path().app_data_dir().map_err(err)?;
    *usage.0.lock().map_err(err)? = None;
    crate::accounts::set_active(&data, &agent_key(agent_id), &id).map_err(err)
}

/// Signs in to one account of an agent in the browser: Claude with `claude auth login`, the others with
/// their ACP sign-in, each pointed at that account's folder.
#[tauri::command]
pub async fn account_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
    pending: State<'_, ClaudeSignIn>,
    agent_id: AgentId,
    id: String,
) -> CmdResult<()> {
    let data = app.path().app_data_dir().map_err(err)?;
    let dir = crate::accounts::dir(&data, agent_id, &id);
    if agent_id == AgentId::Claude {
        use crate::claude_account::{sign_in, SignInEnd, SIGN_IN_TIMEOUT};
        let dir = dir.ok_or("No folder for this account")?;
        std::fs::create_dir_all(&dir).map_err(err)?;
        let claude = claude_program()?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        if let Some(old) = pending.0.lock().map_err(err)?.replace(tx) {
            let _ = old.send(());
        }
        let emitter = app.clone();
        return match sign_in(&claude, &dir, SIGN_IN_TIMEOUT, rx, move |url| {
            let _ = emitter.emit(CLAUDE_SIGN_IN_URL_EVENT, url);
        })
        .await
        {
            SignInEnd::Done => Ok(()),
            SignInEnd::Cancelled => Err("cancelled".into()),
            SignInEnd::TimedOut => Err("Signing in took too long. Try again".into()),
            SignInEnd::Failed(why) => Err(why),
        };
    }
    let (command, launch_env) = agent_launch(&app, agent_id).await?;
    let cwd = app.path().app_cache_dir().map_err(err)?.join("model-probe");
    std::fs::create_dir_all(&cwd).map_err(err)?;
    let probe = format!("sign-in-{}", agent_key(agent_id));
    let mut options = session_options(agent_id, None, false);
    options.env.extend(launch_env);
    if let Some(d) = dir.as_deref() {
        options.env.extend(crate::accounts::env_for(agent_id, d));
    }
    options.authenticate = Some(String::new());
    let result = state.acp.start_with(&probe, &command, &cwd, Arc::new(QuietSink), options).await;
    let _ = state.acp.stop(&probe).await;
    result.map_err(err)
}

/// Signs in to an agent the way it signs in (Add connection in Settings › Agents › Provider): its ACP
/// `authenticate` with the browser sign-in method, which opens the OAuth page (ChatGPT, Google…) and
/// returns once the user is done. Claude signs in through `claude_account` instead.
#[tauri::command]
pub async fn agent_sign_in(app: AppHandle, state: State<'_, AppState>, agent_id: AgentId, method: Option<String>) -> CmdResult<()> {
    let (command, launch_env) = agent_launch(&app, agent_id).await?;
    let cwd = app.path().app_cache_dir().map_err(err)?.join("model-probe");
    std::fs::create_dir_all(&cwd).map_err(err)?;
    let probe = format!("sign-in-{}", agent_key(agent_id));
    let mut options = session_options(agent_id, None, false);
    options.env.extend(claude_env(&app, agent_id)?);
    options.env.extend(launch_env);
    options.authenticate = Some(method.unwrap_or_default());
    let result = state.acp.start_with(&probe, &command, &cwd, Arc::new(QuietSink), options).await;
    let _ = state.acp.stop(&probe).await;
    result.map_err(err)
}

#[tauri::command]
pub async fn agent_models(app: AppHandle, state: State<'_, AppState>, agent_id: AgentId) -> CmdResult<Option<AgentModels>> {
    let (command, launch_env) = agent_launch(&app, agent_id).await?;
    let cwd = app.path().app_cache_dir().map_err(err)?.join("model-probe");
    std::fs::create_dir_all(&cwd).map_err(err)?;
    let probe = format!("models-{}", agent_key(agent_id));
    let mut options = session_options(agent_id, None, false);
    options.env.extend(claude_env(&app, agent_id)?);
    options.env.extend(launch_env);
    state.acp.start_with(&probe, &command, &cwd, Arc::new(QuietSink), options).await.map_err(err)?;
    let models = state.acp.models(&probe).ok().flatten();
    let _ = state.acp.stop(&probe).await;
    Ok(models.map(|m| AgentModels { current: m.current, options: m.options }))
}

/// The install chat never runs in auto mode (installs need the user's approval); other chats follow
/// the chat's Auto toggle.
fn wants_auto(chat_id: &str, requested: bool) -> bool {
    chat_id != "setup" && requested
}

/// Claude without the plugin has no skills unless the first prompt carries them.
fn needs_skills_text(agent: AgentId, plugin: Option<&Path>) -> bool {
    agent == AgentId::Claude && plugin.is_none()
}

/// How much of a mentioned project's AGENTS.md goes into the prompt.
const BRIEF_LIMIT: usize = 8 * 1024;

/// `<folder>/AGENTS.md`, cut to `BRIEF_LIMIT` bytes on a character boundary.
pub fn read_brief(folder: &Path) -> Option<String> {
    let text = std::fs::read_to_string(folder.join("AGENTS.md")).ok()?;
    Some(truncate_brief(&text))
}

fn truncate_brief(text: &str) -> String {
    if text.len() <= BRIEF_LIMIT {
        return text.to_string();
    }
    let mut end = BRIEF_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[AGENTS.md cut at 8 KB]", &text[..end])
}

/// Turns chat parts into what the agent sees. Tool parts are skipped. A mentioned
/// project's AGENTS.md (from `brief`) is inlined, since a new chat's agent runs
/// outside that project's folder.
pub fn build_prompt(
    parts: &[MessagePart],
    project: impl Fn(&str) -> Option<Project>,
    brief: impl Fn(&Path) -> Option<String>,
) -> Vec<PromptPart> {
    let mut out = Vec::new();
    for part in parts {
        match part {
            MessagePart::Text { text } => out.push(PromptPart::Text(text.clone())),
            MessagePart::Mention { project_id, title } => {
                out.push(PromptPart::Text(match project(project_id) {
                    Some(p) => {
                        let head = format!(
                            "Context: project \"{}\". Its Buma id is {}. Its files are in {}.",
                            p.title, p.id, p.folder
                        );
                        match brief(Path::new(&p.folder)) {
                            Some(b) if !b.trim().is_empty() => {
                                format!("{head}\nIts AGENTS.md:\n\n{}", b.trim_end())
                            }
                            _ => head,
                        }
                    }
                    None => format!(
                        "Context: project \"{title}\" (no longer on this computer)."
                    ),
                }));
            }
            MessagePart::File { path, name, size, .. } => {
                let rel = Path::new(path)
                    .file_name()
                    .map(|f| format!("attachments/{}", f.to_string_lossy()))
                    .unwrap_or_else(|| name.clone());
                let inline = is_image_name(name) && *size <= MAX_IMAGE_BLOCK;
                let size = human_size(*size);
                if inline {
                    out.push(PromptPart::Image { path: PathBuf::from(path) });
                    out.push(PromptPart::Text(format!("Attached image: {rel} ({name}, {size})")));
                } else {
                    out.push(PromptPart::Text(format!("Attached file: {rel} ({name}, {size})")));
                }
            }
            MessagePart::Tool { .. } | MessagePart::Thought { .. } | MessagePart::A2ui { .. } => {}
            MessagePart::A2uiAction { summary, action } => {
                out.push(PromptPart::Text(format!("{summary}\n\n```a2ui-action\n{action}\n```")));
            }
        }
    }
    out
}

pub const MAX_ATTACHMENT: u64 = 50 * 1024 * 1024;
/// Larger images go to the agent as the "Attached file" line: agents refuse big inline images.
pub const MAX_IMAGE_BLOCK: u64 = 5 * 1024 * 1024;

/// Mime type from the file extension; unknown ones are generic binary.
fn mime_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// Images the agent gets as an image block (the types ACP's `image_block` sends). A gif is a file.
fn is_image_name(name: &str) -> bool {
    matches!(mime_for(name), "image/png" | "image/jpeg" | "image/webp")
}

fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

/// Copies `source` into `<cwd>/attachments/`, under a name that is not taken yet.
pub fn copy_attachment(cwd: &Path, source: &Path, max: u64) -> CmdResult<MessagePart> {
    let meta = std::fs::metadata(source).map_err(|e| format!("Can't read that file: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file".into());
    }
    if meta.len() > max {
        return Err("That file is larger than 50 MB".into());
    }
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| safe_segment(n))
        .ok_or("That file has no usable name")?;
    let dir = cwd.join("attachments");
    if !projects::ensure_inside(cwd, &dir) {
        return Err("The agent can only read files inside this chat's folder".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (file_name[..i].to_string(), file_name[i..].to_string()),
        _ => (file_name.clone(), String::new()),
    };
    let mut name = file_name;
    let mut n = 1;
    loop {
        let dest = dir.join(&name);
        if !projects::ensure_inside(cwd, &dest) {
            return Err("The agent can only read files inside this chat's folder".into());
        }
        // create_new keeps two attachments from racing for the same name.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                let mut input = std::fs::File::open(source)
                    .map_err(|e| format!("Can't read that file: {e}"))?;
                if let Err(e) = std::io::copy(&mut input, &mut out) {
                    drop(out);
                    let _ = std::fs::remove_file(&dest);
                    return Err(format!("Can't copy that file: {e}"));
                }
                return Ok(MessagePart::File {
                    path: dest.to_string_lossy().into_owned(),
                    mime: mime_for(&name).into(),
                    name,
                    size: meta.len(),
                    modified_at: None,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1;
                name = format!("{stem}-{n}{ext}");
            }
            Err(e) => return Err(format!("Can't copy that file: {e}")),
        }
    }
}

/// Attached files must live inside the chat's own folder.
pub fn check_file_parts(cwd: &Path, parts: &[MessagePart]) -> CmdResult<()> {
    for part in parts {
        if let MessagePart::File { path, .. } = part {
            if !projects::ensure_inside(cwd, Path::new(path)) {
                return Err("That file is outside this chat's folder".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn attach_file(
    state: State<'_, AppState>,
    chat_id: String,
    source_path: String,
) -> CmdResult<MessagePart> {
    let folder = project_folder_for_chat(&state, &chat_id)?;
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    copy_attachment(&cwd, Path::new(&source_path), MAX_ATTACHMENT)
}

#[tauri::command]
pub async fn agent_prompt(
    state: State<'_, AppState>,
    chat_id: String,
    parts: Vec<MessagePart>,
) -> CmdResult<()> {
    if parts.iter().any(|p| matches!(p, MessagePart::File { .. })) {
        let folder = project_folder_for_chat(&state, &chat_id)?;
        let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
        check_file_parts(&cwd, &parts)?;
    }
    let prompt = build_prompt(&parts, |id| state.db.get_project(id).ok().flatten(), read_brief);
    state.acp.prompt(&chat_id, prompt).await.map_err(err)
}

/// Turns auto mode on or off for the chat's running agent. The setup chat can't.
#[tauri::command]
pub async fn agent_set_auto(
    state: State<'_, AppState>,
    chat_id: String,
    on: bool,
) -> CmdResult<()> {
    let on = wants_auto(&chat_id, on);
    state.acp.set_auto(&chat_id, on).await.map(|_| ()).map_err(err)
}

/// The chat's permission mode: `ask`, `acceptEdits`, `plan`, `auto` or `bypass`.
#[tauri::command]
pub async fn agent_set_mode(state: State<'_, AppState>, chat_id: String, mode: String) -> CmdResult<()> {
    state.acp.set_permission_mode(&chat_id, &mode).await.map_err(err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModes {
    available: Vec<String>,
    current: Option<String>,
}

/// The modes the chat's running agent offers (empty for an agent without modes).
#[tauri::command]
pub fn agent_modes(state: State<'_, AppState>, chat_id: String) -> CmdResult<AgentModes> {
    let (available, current) = state.acp.modes(&chat_id).map_err(err)?;
    Ok(AgentModes { available, current })
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    state.acp.cancel(&chat_id).await.map_err(err)
}

/// Stops the agent process of this chat. Stopping a chat with no agent is fine.
#[tauri::command]
pub async fn agent_stop(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    let _ = state.acp.stop(&chat_id).await;
    Ok(())
}

/// The user's answer to an agent's question: `{action: "accept", content}`, `{action: "decline"}`
/// or `{action: "cancel"}`.
#[tauri::command]
pub fn agent_respond_question(state: State<'_, AppState>, request_id: String, response: serde_json::Value) -> CmdResult<()> {
    state.acp.respond_question(&request_id, response).map_err(err)
}

#[tauri::command]
pub fn agent_respond_permission(
    state: State<'_, AppState>,
    request_id: String,
    option_id: Option<String>,
) -> CmdResult<()> {
    state.acp.respond_permission(&request_id, option_id).map_err(err)
}

fn project_folder(state: &AppState, project_id: &str) -> CmdResult<PathBuf> {
    state
        .db
        .get_project(project_id)
        .map_err(err)?
        .map(|p| PathBuf::from(p.folder))
        .ok_or_else(|| "That project no longer exists".to_string())
}

// ---- project files (the workspace) ----

/// One folder of a project, `dir` relative to the project folder ("" is the top).
#[tauri::command]
pub async fn project_files(state: State<'_, AppState>, project_id: String, dir: String) -> CmdResult<Vec<crate::files::FileEntry>> {
    let root = project_folder(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || crate::files::list_dir(&root, &dir)).await.map_err(err)?
}

/// A project's files whose name contains `query`.
#[tauri::command]
pub async fn find_project_files(state: State<'_, AppState>, project_id: String, query: String) -> CmdResult<Vec<crate::files::FileEntry>> {
    let root = project_folder(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || crate::files::find(&root, &query)).await.map_err(err)?
}

/// Opens a project's folder in the file manager. The path is found here, so the webview can't ask to
/// open any other folder.
#[tauri::command]
pub async fn open_project_folder(app: AppHandle, state: State<'_, AppState>, project_id: String) -> CmdResult<()> {
    let folder = project_folder(&state, &project_id)?;
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(folder.to_string_lossy(), None::<&str>).map_err(err)
}

/// One project file to show: its text, or what kind of file it is.
#[tauri::command]
pub async fn read_project_file(state: State<'_, AppState>, project_id: String, path: String) -> CmdResult<crate::files::FileContent> {
    let root = project_folder(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || crate::files::read(&root, &path)).await.map_err(err)?
}

// ---- Your API (the `custom` agent: opencode with the user's provider, see api_engine) ----

/// Where the provider's key is kept: the keychain like the sign-in token (a file only when there is
/// no keychain); dev builds use a 0600 file for the reason given at `auth_manager`.
pub struct ApiKeys(pub Arc<dyn crate::auth::TokenStore>);

impl ApiKeys {
    pub fn new(data_dir: &Path) -> Self {
        let store: Arc<dyn crate::auth::TokenStore> = if cfg!(debug_assertions) {
            Arc::new(FileStore::new(data_dir.join("api-key-dev.json")))
        } else {
            Arc::new(SecureStore::new(KeyringStore, FileStore::new(data_dir.join("api-key.json"))))
        };
        Self(store)
    }

    /// The keychain can block or ask, so it runs off the async threads.
    async fn get_account(&self, account: &'static str) -> CmdResult<Option<String>> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.get(account)).await.map_err(err)?.map_err(err)
    }

    async fn set_account(&self, account: &'static str, key: String) -> CmdResult<()> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.set(account, &key)).await.map_err(err)?.map_err(err)
    }

    async fn delete_account(&self, account: &'static str) -> CmdResult<()> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.delete(account)).await.map_err(err)?.map_err(err)
    }

    async fn get(&self) -> CmdResult<Option<String>> {
        self.get_account(crate::api_engine::KEY_ACCOUNT).await
    }

    async fn set(&self, key: String) -> CmdResult<()> {
        self.set_account(crate::api_engine::KEY_ACCOUNT, key).await
    }

    async fn delete(&self) -> CmdResult<()> {
        self.delete_account(crate::api_engine::KEY_ACCOUNT).await
    }
}

// ---- Azure DevOps sign-in (see devops): required before the app opens ----

async fn devops_saved(keys: &ApiKeys) -> CmdResult<Option<crate::devops::Saved>> {
    Ok(keys.get_account(crate::devops::ACCOUNT).await?.and_then(|raw| serde_json::from_str(&raw).ok()))
}

/// Who is signed in to Azure DevOps, from the keychain (no network: it works offline).
#[tauri::command]
pub async fn devops_status(keys: State<'_, ApiKeys>) -> CmdResult<crate::devops::DevopsStatus> {
    let profile = devops_saved(&keys).await?.map(|s| s.profile);
    Ok(crate::devops::DevopsStatus { signed_in: profile.is_some(), profile })
}

/// Checks the token against the organization, then saves both. The token stays in Rust.
#[tauri::command]
pub async fn devops_sign_in(keys: State<'_, ApiKeys>, org: String, pat: String) -> CmdResult<crate::devops::DevopsStatus> {
    let org = crate::devops::normalize_org(&org).ok_or("Enter your Azure DevOps organization, like buma or https://dev.azure.com/buma")?;
    let pat = pat.trim().to_string();
    if pat.is_empty() {
        return Err("Paste your personal access token".into());
    }
    let client = crate::auth::http_client()?;
    let profile = crate::devops::verify(&client, "https://dev.azure.com", &org, &pat).await?;
    let saved = crate::devops::Saved { method: crate::devops::Method::Pat, pat, profile: profile.clone() };
    keys.set_account(crate::devops::ACCOUNT, serde_json::to_string(&saved).map_err(err)?).await?;
    Ok(crate::devops::DevopsStatus { signed_in: true, profile: Some(profile) })
}

/// Sign in with Microsoft: the Azure CLI opens Microsoft's sign-in in the browser, then the account is
/// checked against the organization. Nothing secret is saved; the Azure CLI keeps the sign-in.
#[tauri::command]
pub async fn devops_microsoft_sign_in(keys: State<'_, ApiKeys>, org: String) -> CmdResult<crate::devops::DevopsStatus> {
    let org = crate::devops::normalize_org(&org).ok_or("Enter your Azure DevOps organization, like buma or https://dev.azure.com/buma")?;
    let az = tauri::async_runtime::spawn_blocking(|| {
        system::refresh_shell_path();
        system::Exec::which(&RealExec, "az")
    })
    .await
    .map_err(err)?
    .ok_or("Signing in with Microsoft needs the Azure CLI. Install it (Check your setup lists it), or use a personal access token.")?;
    let token = crate::devops::az_sign_in(&az).await?;
    let client = crate::auth::http_client()?;
    let profile = crate::devops::verify_bearer(&client, "https://dev.azure.com", &org, &token).await?;
    let saved = crate::devops::Saved { method: crate::devops::Method::AzureCli, pat: String::new(), profile: profile.clone() };
    keys.set_account(crate::devops::ACCOUNT, serde_json::to_string(&saved).map_err(err)?).await?;
    Ok(crate::devops::DevopsStatus { signed_in: true, profile: Some(profile) })
}

#[tauri::command]
pub async fn devops_sign_out(keys: State<'_, ApiKeys>) -> CmdResult<crate::devops::DevopsStatus> {
    keys.delete_account(crate::devops::ACCOUNT).await?;
    Ok(crate::devops::DevopsStatus { signed_in: false, profile: None })
}

// ---- Your API engine download and checks ----

/// One engine download at a time.
#[derive(Default)]
pub struct EngineInstall(pub tokio::sync::Mutex<()>);

/// The download's progress, `{ done, total }` in bytes.
pub const ENGINE_PROGRESS_EVENT: &str = "engine://progress";

fn api_client(timeout: std::time::Duration) -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(err)
}

/// What Your API has: the provider, whether a key is saved and whether the engine is downloaded.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    provider: Option<crate::api_engine::ApiProvider>,
    has_key: bool,
    engine_installed: bool,
}

#[tauri::command]
pub async fn api_status(app: AppHandle, state: State<'_, AppState>, keys: State<'_, ApiKeys>) -> CmdResult<ApiStatus> {
    let data = app.path().app_data_dir().map_err(err)?;
    Ok(ApiStatus {
        provider: state.db.get_settings(&state.home).api_provider,
        has_key: keys.get().await.ok().flatten().is_some_and(|k| !k.is_empty()),
        engine_installed: crate::api_engine::installed_engine(&data).is_some(),
    })
}

/// Lists the models at `base_url`, which checks the key too. No `key`: the saved one.
#[tauri::command]
pub async fn api_check(keys: State<'_, ApiKeys>, base_url: String, key: Option<String>) -> CmdResult<crate::api_engine::ApiCheck> {
    let base = crate::api_engine::clean_base_url(&base_url).ok_or("Type an address that starts with https:// or http://")?;
    let key = match key {
        Some(k) => k,
        None => keys.get().await?.unwrap_or_default(),
    };
    let client = api_client(std::time::Duration::from_secs(20))?;
    Ok(crate::api_engine::check(&client, &base, &key).await)
}

/// One real one-token call with `model`, before saving: proves the key, the balance and the model.
/// No `key`: the saved one.
#[tauri::command]
pub async fn api_try(keys: State<'_, ApiKeys>, base_url: String, key: Option<String>, model: String) -> CmdResult<crate::api_engine::ApiCheck> {
    let base = crate::api_engine::clean_base_url(&base_url).ok_or("Type an address that starts with https:// or http://")?;
    let key = match key {
        Some(k) => k,
        None => keys.get().await?.unwrap_or_default(),
    };
    let client = api_client(std::time::Duration::from_secs(60))?;
    Ok(crate::api_engine::try_model(&client, &base, &key, model.trim()).await)
}

/// Whether something answers at `base_url` (a local 9router).
#[tauri::command]
pub async fn api_reachable(base_url: String) -> CmdResult<bool> {
    let Some(base) = crate::api_engine::clean_base_url(&base_url) else { return Ok(false) };
    let client = api_client(std::time::Duration::from_millis(1500))?;
    Ok(crate::api_engine::reachable(&client, &base).await)
}

/// Saves the provider (and the key, when given) and makes Your API the default agent.
#[tauri::command]
pub async fn api_save(
    state: State<'_, AppState>,
    keys: State<'_, ApiKeys>,
    usage: State<'_, crate::usage::UsageCache>,
    provider: crate::api_engine::ApiProvider,
    key: Option<String>,
) -> CmdResult<Settings> {
    let base_url = crate::api_engine::clean_base_url(&provider.base_url).ok_or("Type an address that starts with https:// or http://")?;
    let model = provider.model.trim().to_string();
    if model.is_empty() {
        return Err("Pick a model".into());
    }
    if let Some(key) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        keys.set(key).await?;
    }
    let mut models: Vec<String> = provider.models.iter().map(|m| m.trim().to_string()).filter(|m| !m.is_empty()).collect();
    models.sort();
    models.dedup();
    let provider = crate::api_engine::ApiProvider { provider: provider.provider, base_url, model, models };
    *usage.0.lock().map_err(err)? = None;
    // The model picked here is the one to use: forget a pick from the chat's model menu.
    let mut agent_models = state.db.get_settings(&state.home).agent_models;
    agent_models.remove("custom");
    state
        .db
        .update_settings(serde_json::json!({ "apiProvider": provider, "defaultAgent": "custom", "agentModels": agent_models }))
        .map_err(err)
}

/// Forgets the provider and its key. The default agent goes back to Claude Code when it was Your API.
#[tauri::command]
pub async fn api_clear(state: State<'_, AppState>, keys: State<'_, ApiKeys>) -> CmdResult<Settings> {
    keys.delete().await?;
    let mut patch = serde_json::json!({ "apiProvider": null });
    if state.db.get_settings(&state.home).default_agent == AgentId::Custom {
        patch["defaultAgent"] = serde_json::json!("claude");
    }
    state.db.update_settings(patch).map_err(err)
}

/// Downloads the engine unless it is there, sending `engine://progress` while it does.
#[tauri::command]
pub async fn engine_install(app: AppHandle, lock: State<'_, EngineInstall>) -> CmdResult<()> {
    let _one = lock.0.lock().await;
    let data = app.path().app_data_dir().map_err(err)?;
    // Large file, slow connections: no overall timeout, only a connect one.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(err)?;
    let emitter = app.clone();
    let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
    let progress = std::sync::Mutex::new(move |done: u64, total: Option<u64>| {
        let end = total.is_some_and(|t| done >= t);
        if end || last.elapsed() >= std::time::Duration::from_millis(150) {
            last = std::time::Instant::now();
            let _ = emitter.emit(ENGINE_PROGRESS_EVENT, serde_json::json!({ "done": done, "total": total }));
        }
    });
    crate::api_engine::install_engine(&client, &data, |d, t| {
        if let Ok(mut f) = progress.lock() {
            f(d, t)
        }
    })
    .await?;
    Ok(())
}

/// The command and environment that start Your API: the engine with the saved provider and key.
async fn api_agent(app: &AppHandle) -> CmdResult<(Vec<String>, Vec<(String, String)>)> {
    let data = app.path().app_data_dir().map_err(err)?;
    let engine = crate::api_engine::installed_engine(&data).ok_or("Your API isn't set up yet. Open Settings › Agents › Your API")?;
    let state = app.state::<AppState>();
    let provider = state.db.get_settings(&state.home).api_provider.ok_or("Your API isn't set up yet. Open Settings › Agents › Your API")?;
    let key = app.state::<ApiKeys>().get().await?.filter(|k| !k.is_empty()).ok_or("Your API key is missing. Open Settings › Agents › Your API")?;
    // The provider's list today (models come and go); the saved one when it can't be read.
    let mut provider = provider;
    let fresh = crate::api_engine::check(&api_client(std::time::Duration::from_secs(8))?, &provider.base_url, &key).await;
    if fresh.ok {
        provider.models = fresh.models;
    }
    let config_dir = crate::api_engine::engine_config_dir(&data);
    std::fs::create_dir_all(&config_dir).map_err(err)?;
    let data_dir = crate::api_engine::engine_data_dir(&data);
    std::fs::create_dir_all(&data_dir).map_err(err)?;
    let config_file = crate::api_engine::write_config(&crate::api_engine::engine_root(&data), &provider).map_err(err)?;
    let command = vec![engine.to_string_lossy().into_owned(), "acp".into()];
    Ok((command, crate::api_engine::session_env(&config_file, &key, &config_dir, &data_dir)))
}

/// The command that starts `agent_id` on this computer, plus any environment of its own.
async fn agent_launch(app: &AppHandle, agent_id: AgentId) -> CmdResult<(Vec<String>, Vec<(String, String)>)> {
    if agent_id == AgentId::Custom {
        return api_agent(app).await;
    }
    let mut command = system::acp_command(agent_id).ok_or("Pick an agent first")?;
    let program = command[0].clone();
    let found = system::agent_program(&RealExec, agent_id).ok_or_else(|| format!("Can't find {program} on this computer"))?;
    command[0] = found.to_string_lossy().into_owned();
    Ok((command, Vec::new()))
}

/// Your API as a row of the agent list: ready once the engine, the provider and the key are there.
async fn api_agent_info(app: &AppHandle) -> AgentInfo {
    let data = app.path().app_data_dir().ok();
    let engine = data.as_deref().and_then(crate::api_engine::installed_engine).is_some();
    let provider = app.try_state::<AppState>().and_then(|s| s.db.get_settings(&s.home).api_provider);
    let key = match app.try_state::<ApiKeys>() {
        Some(k) => k.get().await.ok().flatten().is_some_and(|k| !k.is_empty()),
        None => false,
    };
    AgentInfo {
        id: AgentId::Custom,
        name: "Your API".into(),
        installed: engine && provider.is_some() && key,
        version: provider.map(|p| p.model),
        acp_command: Vec::new(),
        recommended: false,
        signed_in: key,
        account: None,
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn chat_kind_names_what_the_chat_is_for() {
        assert_eq!(chat_kind("setup", false), "setup");
        assert_eq!(chat_kind("abc", true), "project");
        assert_eq!(chat_kind("abc", false), "chat");
    }

    #[test]
    fn locale_is_trimmed_and_blank_is_none() {
        assert_eq!(super::clean_locale(Some(" id-ID ".into())), Some("id-ID".into()));
        assert_eq!(super::clean_locale(Some("  ".into())), None);
        assert_eq!(super::clean_locale(None), None);
        for unknown in ["C", "POSIX", "C.UTF-8", "POSIX.UTF-8", " C "] {
            assert_eq!(super::clean_locale(Some(unknown.into())), None, "{unknown}");
        }
        assert_eq!(super::clean_locale(Some("ca-ES".into())), Some("ca-ES".into()));
        assert_eq!(super::clean_locale(Some("Czech".into())), Some("Czech".into()));
    }

    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.insert_project(&Project {
            id: "p".into(),
            title: "P".into(),
            slug: "p".into(),
            folder: "/w/p".into(),
            status: ProjectStatus::Building,
            created_at: "t".into(),
            updated_at: "t".into(),
        })
        .unwrap();
        db
    }

    #[test]
    fn a_draft_whose_brief_cant_be_written_leaves_no_folder() {
        let db = seeded();
        let tmp = tempfile::tempdir().unwrap();
        let input = NewProject { title: "Jalur Rempah".into() };
        let err = new_project_with(&db, tmp.path(), input, |_| Err(std::io::Error::other("disk full"))).unwrap_err();
        assert!(err.contains("brief"), "{err}");
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 0);
        assert_eq!(db.list_projects().unwrap().len(), 1);
    }

    #[test]
    fn system_locale_never_panics_and_is_none_or_text() {
        assert!(super::system_locale().is_none_or(|l| !l.is_empty()));
    }

    use super::*;

    #[test]
    fn session_options_for_claude_load_the_plugin() {
        let plugin = PathBuf::from("/res/agent-plugin");
        let o = session_options(AgentId::Claude, Some(&plugin), true);
        assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
        let meta = o.meta.unwrap();
        let path = meta["claudeCode"]["options"]["plugins"][0]["path"].as_str().unwrap();
        assert_eq!(PathBuf::from(path), plugin);
        assert_eq!(meta["claudeCode"]["options"]["plugins"][0]["type"], "local");
        assert_eq!(meta["systemPrompt"]["append"], BUMA_APPEND);
    }

    #[test]
    fn session_options_for_other_agents_only_set_env() {
        for id in [AgentId::Opencode, AgentId::Codex, AgentId::Gemini] {
            let o = session_options(id, Some(Path::new("/x")), true);
            assert!(o.meta.is_none());
            assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
        }
    }

    #[test]
    fn the_users_skills_load_as_a_second_plugin() {
        let mut o = session_options(AgentId::Claude, Some(Path::new("/res/agent-plugin")), true);
        add_plugin(&mut o, Path::new("/data/user-skills"));
        let plugins = &o.meta.unwrap()["claudeCode"]["options"]["plugins"];
        assert_eq!(plugins[1]["path"], "/data/user-skills");
        assert_eq!(plugins[1]["type"], "local");

        let mut alone = session_options(AgentId::Claude, None, true);
        add_plugin(&mut alone, Path::new("/data/user-skills"));
        assert_eq!(alone.meta.unwrap()["claudeCode"]["options"]["plugins"][0]["path"], "/data/user-skills");

        let mut internal = session_options(AgentId::Claude, None, false);
        add_plugin(&mut internal, Path::new("/data/user-skills"));
        assert!(internal.meta.is_none());
    }

    #[test]
    fn claude_without_a_plugin_folder_still_gets_the_append() {
        let o = session_options(AgentId::Claude, None, true);
        let meta = o.meta.unwrap();
        assert!(meta["claudeCode"].is_null());
        assert_eq!(meta["systemPrompt"]["append"], BUMA_APPEND);
    }

    #[test]
    fn plugin_dir_is_the_repo_copy_in_debug_builds_else_the_bundled_one() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("agent-plugin").join(".claude-plugin");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("plugin.json"), "{}").unwrap();
        let expected = if cfg!(debug_assertions) { dev_plugin_dir() } else { Some(tmp.path().join("agent-plugin")) };
        assert_eq!(plugin_dir(Some(tmp.path())), expected);
    }

    #[test]
    fn the_system_prompt_asks_with_the_question_tool_not_a2ui() {
        assert!(BUMA_APPEND.contains("AskUserQuestion"));
        assert!(!BUMA_APPEND.to_lowercase().contains("a2ui"));
    }

    #[test]
    fn dev_plugin_folder_exists_in_the_repo() {
        // Only debug builds look in the repo; a release build must use its bundled copy.
        assert_eq!(dev_plugin_dir().is_some(), cfg!(debug_assertions));
    }

    #[test]
    fn internal_sessions_get_no_meta() {
        assert!(!wants_skills("setup"));
        assert!(wants_skills("c1"));
    }

    #[test]
    fn auto_mode_rules() {
        assert!(!wants_auto("setup", true));
        assert!(wants_auto("c1", true));
        assert!(!wants_auto("c1", false));
    }

    #[test]
    fn internal_sessions_get_no_meta_options() {
        let o = session_options(AgentId::Claude, Some(Path::new("/p")), false);
        assert!(o.meta.is_none());
        assert_eq!(o.env, vec![("BSPACE_SDLC_APP".to_string(), "1".to_string())]);
    }

    #[test]
    fn claude_without_the_plugin_gets_the_skills_as_text() {
        assert!(needs_skills_text(AgentId::Claude, None));
        assert!(!needs_skills_text(AgentId::Claude, Some(Path::new("/p"))));
        // Other agents get them as text anyway; the app decides that itself.
        assert!(!needs_skills_text(AgentId::Codex, None));
    }

    #[test]
    fn cwd_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path();
        let setup = resolve_cwd(w, "setup", None).unwrap();
        assert!(setup.ends_with(".buma/setup") || setup.ends_with(r".buma\setup"));
        assert!(setup.is_dir());
        let chat = resolve_cwd(w, "c1", None).unwrap();
        assert_eq!(chat, w.join(".buma").join("chats").join("c1"));
        let proj = w.join("my-feature");
        std::fs::create_dir(&proj).unwrap();
        assert_eq!(resolve_cwd(w, "c2", Some(&proj)).unwrap(), proj);
    }

    #[test]
    fn project_chats_keep_their_folder_after_the_working_folder_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let old_project = tmp.path().join("old-work").join("promo");
        std::fs::create_dir_all(&old_project).unwrap();
        let new_working = tmp.path().join("new-work");
        assert_eq!(resolve_cwd(&new_working, "c", Some(&old_project)).unwrap(), old_project);
        // A project folder that is gone is an error, not silently recreated.
        let gone = tmp.path().join("gone");
        assert!(resolve_cwd(&new_working, "c", Some(&gone)).is_err());
        assert!(!gone.exists());
    }

    #[test]
    fn cwd_rejects_escapes() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("work");
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir(&outside).unwrap();
        assert!(resolve_cwd(&w, "../x", None).is_err());
        assert!(resolve_cwd(&w, "a/../../x", None).is_err());
        let _ = outside;
    }

    #[test]
    fn asset_folders_are_working_plus_existing_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open_in_memory().unwrap();
        let kept = tmp.path().join("old").join("kept");
        std::fs::create_dir_all(&kept).unwrap();
        let mk = |id: &str, folder: &Path| Project {
            id: id.into(),
            title: id.into(),
            slug: id.into(),
            folder: folder.to_string_lossy().into_owned(),
            status: ProjectStatus::Draft,
            created_at: String::new(),
            updated_at: String::new(),
        };
        db.insert_project(&mk("a", &kept)).unwrap();
        db.insert_project(&mk("b", &tmp.path().join("missing"))).unwrap();
        let working = tmp.path().join("work");
        assert_eq!(
            asset_folders(&db, &working.to_string_lossy()),
            vec![working.clone(), kept]
        );
    }

    #[test]
    fn lookup_chat_finds_project_chats() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(Some("p1"), AgentId::Gemini, "Intro").unwrap();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        // The unfiltered list only has chats without a project, so lookups must go by id.
        assert!(!db.list_chats(None).unwrap().contains(&chat));
        assert_eq!(lookup_chat(&db, &chat.id).unwrap(), Some(chat));
        assert_eq!(lookup_chat(&db, &loose.id).unwrap(), Some(loose));
        assert_eq!(lookup_chat(&db, "missing").unwrap(), None);
    }

    #[test]
    fn brief_is_read_and_cut_at_8_kb() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_brief(tmp.path()), None);
        std::fs::write(tmp.path().join("AGENTS.md"), "# Hi\n").unwrap();
        assert_eq!(read_brief(tmp.path()).as_deref(), Some("# Hi\n"));
        // 3-byte characters straddle the limit: the cut stays on a boundary.
        let long = "é€".repeat(3000);
        std::fs::write(tmp.path().join("AGENTS.md"), &long).unwrap();
        let cut = read_brief(tmp.path()).unwrap();
        let body = cut.strip_suffix("\n[AGENTS.md cut at 8 KB]").unwrap();
        assert!(body.len() <= BRIEF_LIMIT && body.len() > BRIEF_LIMIT - 4);
        assert!(long.starts_with(body));
    }

    #[test]
    fn a2ui_action_becomes_summary_and_fenced_json() {
        let parts = vec![
            MessagePart::A2ui { surface_id: "s1".into(), messages: vec![serde_json::json!({"version":"v0.9"})] },
            MessagePart::A2uiAction {
                summary: "Picked: Kenapa rupiah melemah?".into(),
                action: serde_json::json!({"version":"v0.9","action":{"name":"pick"}}),
            },
        ];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![PromptPart::Text(
                "Picked: Kenapa rupiah melemah?\n\n```a2ui-action\n{\"action\":{\"name\":\"pick\"},\"version\":\"v0.9\"}\n```".into()
            )]
        );
    }

    #[test]
    fn missing_mention_has_no_empty_folder() {
        let parts = vec![MessagePart::Mention { project_id: "x".into(), title: "Gone".into() }];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![PromptPart::Text(
                "Context: project \"Gone\" (no longer on this computer).".into()
            )]
        );
    }

    #[test]
    fn prompt_conversion() {
        let project = Project {
            id: "p1".into(),
            title: "Launch".into(),
            slug: "launch".into(),
            folder: "/w/launch".into(),
            status: ProjectStatus::Draft,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let parts = vec![
            MessagePart::Text { text: "hi".into() },
            MessagePart::Mention { project_id: "p1".into(), title: "old".into() },
            MessagePart::Tool {
                tool_call_id: "t".into(),
                title: "x".into(),
                status: ToolCallStatus::Done,
                tool_kind: None,
                path: None,
            },
            MessagePart::Thought { text: "hmm".into() },
        ];
        let out = build_prompt(
            &parts,
            |id| (id == "p1").then(|| project.clone()),
            |f| (f == Path::new("/w/launch")).then(|| "# Launch\n- Kind: promo\n".to_string()),
        );
        assert_eq!(
            out,
            vec![
                PromptPart::Text("hi".into()),
                PromptPart::Text(
                    "Context: project \"Launch\". Its Buma id is p1. Its files are in /w/launch.\nIts AGENTS.md:\n\n# Launch\n- Kind: promo"
                        .into()
                ),
            ]
        );
    }

    #[test]
    fn attach_copies_into_attachments_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("notes.pdf");
        std::fs::write(&src, b"hello").unwrap();
        let part = copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        let dest = cwd.join("attachments").join("notes.pdf");
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(
            part,
            MessagePart::File {
                path: dest.to_string_lossy().into_owned(),
                name: "notes.pdf".into(),
                mime: "application/pdf".into(),
                size: 5,
                modified_at: None,
            }
        );
    }

    #[test]
    fn attach_names_collisions_uniquely() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("a.png");
        std::fs::write(&src, b"1").unwrap();
        copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        std::fs::write(&src, b"22").unwrap();
        let MessagePart::File { name, path, mime, .. } =
            copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap()
        else {
            panic!("not a file part")
        };
        assert_eq!(name, "a-2.png");
        assert_eq!(mime, "image/png");
        assert_eq!(std::fs::read(path).unwrap(), b"22");
        assert_eq!(std::fs::read(cwd.join("attachments").join("a.png")).unwrap(), b"1");
    }

    #[test]
    fn attach_rejects_big_files_and_non_files() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("big.bin");
        std::fs::write(&src, vec![0u8; 11]).unwrap();
        let e = copy_attachment(&cwd, &src, 10).unwrap_err();
        assert_eq!(e, "That file is larger than 50 MB");
        assert!(copy_attachment(&cwd, tmp.path(), 10).is_err());
        assert!(copy_attachment(&cwd, &tmp.path().join("missing"), 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn attach_rejects_a_destination_outside_the_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cwd.join("attachments")).unwrap();
        let src = tmp.path().join("a.txt");
        std::fs::write(&src, b"x").unwrap();
        assert!(copy_attachment(&cwd, &src, MAX_ATTACHMENT).is_err());
        assert!(!outside.join("a.txt").exists());
    }

    #[test]
    fn file_parts_become_images_or_text() {
        let parts = vec![
            MessagePart::File {
                path: "/w/c/attachments/shot.PNG".into(),
                name: "shot.PNG".into(),
                mime: "image/png".into(),
                size: 10,
                modified_at: None,
            },
            MessagePart::File {
                path: "/w/c/attachments/brief.pdf".into(),
                name: "brief.pdf".into(),
                mime: "application/pdf".into(),
                size: 2048,
                modified_at: None,
            },
        ];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![
                PromptPart::Image { path: PathBuf::from("/w/c/attachments/shot.PNG") },
                PromptPart::Text("Attached image: attachments/shot.PNG (shot.PNG, 10 B)".into()),
                PromptPart::Text(
                    "Attached file: attachments/brief.pdf (brief.pdf, 2.0 KB)".into()
                ),
            ]
        );
    }

    #[test]
    fn gifs_and_big_images_are_sent_as_file_lines() {
        let file = |name: &str, size: u64| MessagePart::File {
            path: format!("/w/c/attachments/{name}"),
            name: name.into(),
            mime: mime_for(name).into(),
            size,
            modified_at: None,
        };
        let parts = vec![
            file("loop.gif", 10),
            file("big.jpg", MAX_IMAGE_BLOCK + 1),
            file("edge.webp", MAX_IMAGE_BLOCK),
        ];
        let out = build_prompt(&parts, |_| None, |_| None);
        assert_eq!(out[0], PromptPart::Text("Attached file: attachments/loop.gif (loop.gif, 10 B)".into()));
        assert_eq!(out[1], PromptPart::Text("Attached file: attachments/big.jpg (big.jpg, 5.0 MB)".into()));
        assert_eq!(out[2], PromptPart::Image { path: PathBuf::from("/w/c/attachments/edge.webp") });
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn file_parts_must_be_inside_the_chat_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let file = |p: PathBuf| MessagePart::File {
            path: p.to_string_lossy().into_owned(),
            name: "x".into(),
            mime: "text/plain".into(),
            size: 1,
            modified_at: None,
        };
        assert!(check_file_parts(&cwd, &[file(cwd.join("attachments").join("x"))]).is_ok());
        assert!(check_file_parts(&cwd, &[file(tmp.path().join("secret"))]).is_err());
    }
}

// ---- chat trace ----

/// A chat's turns, model calls and tool calls with their timings and tokens. Claude Code's session
/// files hold them; a chat with another agent has no trace.
#[tauri::command]
pub async fn get_chat_trace(app: AppHandle, state: State<'_, AppState>, chat_id: String) -> CmdResult<crate::trace::ChatTrace> {
    let Some(chat) = lookup_chat(&state.db, &chat_id)? else { return Ok(Default::default()) };
    if chat.agent_id != AgentId::Claude {
        return Ok(Default::default());
    }
    let project = chat.project_id.as_deref().map(|id| state.db.get_project(id)).transpose().map_err(err)?.flatten();
    let folder = project.as_ref().map(|p| PathBuf::from(&p.folder));
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    let tool_ids: std::collections::HashSet<String> = state
        .db
        .list_messages(&chat_id)
        .map_err(err)?
        .into_iter()
        .flat_map(|m| m.parts)
        .filter_map(|p| match p {
            MessagePart::Tool { tool_call_id, .. } => Some(tool_call_id),
            _ => None,
        })
        .collect();
    // A project's folder can hold other chats' sessions, so only its tool calls can tell them apart.
    if folder.is_some() && tool_ids.is_empty() {
        return Ok(crate::trace::ChatTrace { supported: true, ..Default::default() });
    }
    // Buma's own Claude folder, then `~/.claude` for chats from before Buma had one.
    let configs = vec![claude_config_dir(&app)?, state.home.join(".claude")];
    tauri::async_runtime::spawn_blocking(move || crate::trace::chat_trace(&configs, &cwd, &tool_ids)).await.map_err(err)
}

// ---- agent usage ----

/// Every model and version an agent can run, for Settings › Agents › Provider: Claude from Anthropic's
/// list (with the Claude sign-in), opencode from `opencode models`; empty for agents that only report
/// theirs through ACP (`agent_models`).
#[tauri::command]
pub async fn agent_model_catalog(app: AppHandle, state: State<'_, AppState>, agent_id: AgentId) -> CmdResult<Vec<crate::types::ModelChoice>> {
    match agent_id {
        AgentId::Claude => {
            let claude = claude_config_dir(&app)?;
            let token = tauri::async_runtime::spawn_blocking(move || crate::usage::read_claude_token(&RealExec, &claude)).await.map_err(err)?;
            match token {
                Some(t) => crate::model_catalog::fetch_anthropic(&t).await,
                None => Ok(Vec::new()),
            }
        }
        AgentId::Codex => {
            // The active account's Codex home: an extra account's folder, else ~/.codex.
            let data = app.path().app_data_dir().map_err(err)?;
            let id = crate::accounts::active(&crate::accounts::load(&data), AgentId::Codex, "codex");
            let home = crate::accounts::dir(&data, AgentId::Codex, &id).unwrap_or_else(|| state.home.join(".codex"));
            Ok(std::fs::read_to_string(home.join("models_cache.json")).map(|b| crate::model_catalog::from_codex_cache(&b)).unwrap_or_default())
        }
        AgentId::Opencode => tauri::async_runtime::spawn_blocking(|| {
            crate::system::Exec::run(&RealExec, "opencode", &["models"]).map(|out| crate::model_catalog::from_opencode(&out)).unwrap_or_default()
        })
        .await
        .map_err(err),
        _ => Ok(Vec::new()),
    }
}

/// Settings › Agents › Usage: the agents' turns and failovers of the last `days` days (all when None).
#[tauri::command]
pub async fn agent_activity(app: AppHandle, days: Option<u32>) -> CmdResult<Vec<serde_json::Value>> {
    let path = app.path().app_data_dir().map_err(err)?.join("agent-usage.jsonl");
    let since = days.map(|d| chrono::Utc::now() - chrono::Duration::days(i64::from(d)));
    tauri::async_runtime::spawn_blocking(move || crate::activity::read(&path, since)).await.map_err(err)
}

/// Records that a chat moved to the next agent (failover), for the Usage screen.
#[tauri::command]
pub async fn agent_failover_record(app: AppHandle, chat_id: String, from: String, to: String, reason: String) -> CmdResult<()> {
    let path = app.path().app_data_dir().map_err(err)?.join("agent-usage.jsonl");
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    crate::activity::append(&path, &crate::activity::failover_line(&chat_id, &from, &to, &reason, &at)).map_err(err)
}

#[tauri::command]
pub async fn get_agent_usage(
    app: AppHandle,
    state: State<'_, AppState>,
    cache: State<'_, crate::usage::UsageCache>,
    force: bool,
) -> CmdResult<Vec<AgentUsage>> {
    if !force {
        if let Some((at, v)) = cache.0.lock().map_err(err)?.as_ref() {
            if at.elapsed() < crate::usage::CACHE_TTL {
                return Ok(v.clone());
            }
        }
    }
    let data = app.path().app_data_dir().map_err(err)?;
    let acc = crate::accounts::load(&data);
    let agents = tauri::async_runtime::spawn_blocking(|| system::detect_agents(&RealExec)).await.map_err(err)?;
    let now = chrono::Utc::now();
    let mut out = Vec::new();
    for a in agents.iter().filter(|a| a.installed) {
        // Every account of the agent has its own numbers: the default one first, then the extra ones.
        let ids: Vec<String> = std::iter::once(crate::accounts::DEFAULT.to_string())
            .chain(acc.extra.iter().filter(|e| e.agent == a.id).map(|e| e.id.clone()))
            .collect();
        if a.id == AgentId::Opencode {
            for id in ids {
                let dir = crate::accounts::dir(&data, a.id, &id);
                let xdg = match &dir {
                    Some(d) => Some(d.to_string_lossy().into_owned()),
                    None => std::env::var("XDG_DATA_HOME").ok(),
                };
                let db = crate::usage::opencode_db(&state.home, xdg.as_deref());
                if id != crate::accounts::DEFAULT && !db.is_file() {
                    continue;
                }
                let mut usage = tauri::async_runtime::spawn_blocking(move || crate::usage::opencode_usage(&db, now)).await.map_err(err)?;
                usage.account_id = Some(id);
                usage.account = match dir.as_deref() {
                    Some(d) => system::account_in(a.id, d),
                    None => system::agent_account(a.id, &state.home),
                };
                out.push(usage);
            }
            continue;
        }
        if a.id == AgentId::Codex {
            for id in ids {
                let home = match crate::accounts::dir(&data, a.id, &id) {
                    Some(d) => d,
                    None => std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| state.home.join(".codex")),
                };
                let creds = crate::usage::read_codex_token(&home);
                if creds.is_none() && id != crate::accounts::DEFAULT {
                    continue;
                }
                let mut usage = match &creds {
                    None => {
                        let mut u = crate::usage::unavailable(a.id, &a.name, now);
                        u.status = UsageStatus::SignedOut;
                        u.message = Some("Sign in to Codex to see usage".into());
                        u
                    }
                    Some((t, acct)) => crate::usage::fetch_codex_usage(t, acct).await.unwrap_or_else(|m| {
                        let mut u = crate::usage::unavailable(a.id, &a.name, now);
                        u.status = UsageStatus::Error;
                        u.message = Some(m);
                        u
                    }),
                };
                usage.account = match crate::accounts::dir(&data, a.id, &id) {
                    Some(d) => system::account_in(a.id, &d),
                    None => system::agent_account(a.id, &state.home),
                };
                usage.account_id = Some(id);
                out.push(usage);
            }
            continue;
        }
        if a.id == AgentId::Cursor {
            let home = state.home.clone();
            let session = tauri::async_runtime::spawn_blocking(move || crate::usage::read_cursor_session(&RealExec, &home)).await.map_err(err)?;
            let mut usage = match &session {
                None => {
                    let mut u = crate::usage::unavailable(a.id, &a.name, now);
                    u.status = UsageStatus::SignedOut;
                    u.message = Some("Sign in to Cursor to see usage".into());
                    u
                }
                Some((user, token)) => crate::usage::fetch_cursor_usage(user, token).await.unwrap_or_else(|m| {
                    let mut u = crate::usage::unavailable(a.id, &a.name, now);
                    u.status = UsageStatus::Error;
                    u.message = Some(m);
                    u
                }),
            };
            usage.account_id = Some(crate::accounts::DEFAULT.to_string());
            usage.account = std::fs::read_to_string(state.home.join(".cursor/cli-config.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.pointer("/authInfo/email").and_then(|e| e.as_str()).map(str::to_string));
            out.push(usage);
            continue;
        }
        if a.id != AgentId::Claude {
            out.push(crate::usage::unavailable(a.id, &a.name, now));
            continue;
        }
        for id in ids {
            let Some(dir) = crate::accounts::dir(&data, a.id, &id) else { continue };
            let d = dir.clone();
            let token = tauri::async_runtime::spawn_blocking(move || crate::usage::read_claude_token(&RealExec, &d)).await.map_err(err)?;
            // An extra account that never signed in has nothing to show.
            if token.is_none() && id != crate::accounts::DEFAULT {
                continue;
            }
            let mut usage = match &token {
                None => crate::usage::usage_from_response(401, "", now),
                Some(t) => match crate::usage::fetch_claude_usage(t).await {
                    Ok(u) => u,
                    Err(m) => {
                        let mut u = crate::usage::usage_from_response(0, "", now);
                        u.message = Some(m);
                        u
                    }
                },
            };
            usage.account = match (token.is_some(), claude_program()) {
                (true, Ok(claude)) => crate::claude_account::status(&claude, &dir).await.email,
                _ => None,
            };
            usage.account_id = Some(id);
            out.push(usage);
        }
    }
    // Failures aren't cached, so the next poll retries.
    if out.iter().all(|u| u.status != UsageStatus::Error) {
        *cache.0.lock().map_err(err)? = Some((std::time::Instant::now(), out.clone()));
    }
    Ok(out)
}
