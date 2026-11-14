//! SQLite storage for settings, projects, chats and jobs.

use crate::types::*;
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug)]
pub struct DbError(pub String);

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError(e.to_string())
    }
}
impl From<serde_json::Error> for DbError {
    fn from(e: serde_json::Error) -> Self {
        DbError(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

// `projects.kind`, `format` and `language` are left from the video app: databases made by it require
// them (NOT NULL), so every insert writes fixed values and nothing reads them. Its other tables
// (styles, autopilots, autopilot_slots) and columns are no longer read or written.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, folder TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'explainer', format TEXT NOT NULL DEFAULT '9:16', language TEXT NOT NULL DEFAULT 'id',
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, project_id TEXT, agent_id TEXT NOT NULL,
  title TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
  parts TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat_at ON messages(chat_id, created_at);
DROP INDEX IF EXISTS messages_chat;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT, chat_id TEXT,
  agent_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL, note TEXT, updated_at TEXT NOT NULL
);
";

// Column lists use camelCase aliases so rows deserialize straight into the serde types.
// A status from the video app (`rendered`, `scheduled`) reads as `building`.
const PROJECT_SELECT: &str = "SELECT id, title, slug, folder, \
    CASE status WHEN 'draft' THEN 'draft' ELSE 'building' END AS status, \
    created_at AS createdAt, updated_at AS updatedAt FROM projects";
const PROJECT_KEYS: [&str; 7] = ["id", "title", "slug", "folder", "status", "createdAt", "updatedAt"];
const CHAT_SELECT: &str = "SELECT id, project_id AS projectId, agent_id AS agentId, title, \
    created_at AS createdAt, folder FROM chats";
const JOB_SELECT: &str = "SELECT id, kind, title, project_id AS projectId, chat_id AS chatId, \
    agent_id AS agentId, status, progress, note, updated_at AS updatedAt, archived_at AS archivedAt FROM jobs";
const JOB_KEYS: [&str; 10] = ["id", "kind", "title", "projectId", "chatId", "agentId", "status", "progress", "note", "updatedAt"];

pub const DEFAULT_API_URL: &str = "https://bspace.buma.internal/api";

/// The API moved under `/api` (https://bspace.buma.internal/api). A saved address from before
/// that is rewritten on read: the old production host becomes the default, a bare local dev
/// server gets `/api`. Anything else is the user's choice and is left alone.
fn migrate_api_url(url: &str) -> Option<String> {
    let bare = url.strip_suffix('/').unwrap_or(url);
    match bare {
        "https://api.bspace.buma.internal" => Some(DEFAULT_API_URL.to_string()),
        "http://localhost:8787" | "http://127.0.0.1:8787" => Some(format!("{bare}/api")),
        _ => None,
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn sql_from_json(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().unwrap_or_default()),
        },
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

fn json_from_ref(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

/// Serializes `item` and returns its values in `keys` order, ready to bind.
fn bind_values<T: serde::Serialize>(item: &T, keys: &[&str]) -> Result<Vec<Sql>> {
    let v = serde_json::to_value(item)?;
    Ok(keys.iter().map(|k| sql_from_json(v.get(*k).unwrap_or(&Value::Null))).collect())
}

fn query_as<T: DeserializeOwned>(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(args, |row| {
        let mut obj = Map::new();
        for (i, n) in names.iter().enumerate() {
            obj.insert(n.clone(), json_from_ref(row.get_ref(i)?));
        }
        Ok(Value::Object(obj))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(serde_json::from_value(r?)?);
    }
    Ok(out)
}

fn merge_patch(target: &mut Value, patch: &Value) {
    if let (Value::Object(t), Value::Object(p)) = (target, patch) {
        for (k, v) in p {
            t.insert(k.clone(), v.clone());
        }
    }
}

pub struct Db {
    conn: Mutex<Connection>,
    home: Mutex<std::path::PathBuf>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Db> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Db> {
        conn.execute_batch(SCHEMA)?;
        Self::migrate_archive(&conn)?;
        Self::migrate_chat_folder(&conn)?;
        Ok(Db { conn: Mutex::new(conn), home: Mutex::new(Default::default()) })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---- settings ----

    fn default_settings(home: &Path) -> Value {
        json!({
            "workingFolder": home.join("Buma").to_string_lossy(),
            "defaultAgent": "claude",
            "onboarded": false,
            "apiUrl": DEFAULT_API_URL,
            "installId": "",
            "shareInstallStats": true,
            "lastPingAt": null,
            "autoMode": false,
            "uiLanguage": null,
            "backgroundMode": false,
            "openAtLogin": false,
            "agentModels": {},
        })
    }

    /// The install id, made (uuid v4) and saved the first time it's asked for.
    pub fn ensure_install_id(&self, home: &Path) -> Result<String> {
        let current = self.get_settings(home).install_id;
        if !current.is_empty() {
            return Ok(current);
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.update_settings(json!({ "installId": id }))?;
        Ok(id)
    }

    fn settings_value(&self, home: &Path) -> Result<Value> {
        let mut v = Self::default_settings(home);
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (k, raw) = row?;
            if let (Ok(val), Some(obj)) = (serde_json::from_str::<Value>(&raw), v.as_object_mut()) {
                obj.insert(k, val);
            }
        }
        if let Some(new) = v.get("apiUrl").and_then(Value::as_str).and_then(migrate_api_url) {
            v["apiUrl"] = Value::String(new);
        }
        Ok(v)
    }

    /// Stored values over defaults; a stored value that no longer parses falls back to defaults.
    pub fn get_settings(&self, home: &Path) -> Settings {
        *self.home.lock().unwrap_or_else(|e| e.into_inner()) = home.to_path_buf();
        self.settings_value(home)
            .and_then(|v| Ok(serde_json::from_value(v)?))
            .unwrap_or_else(|_| {
                serde_json::from_value(Self::default_settings(home)).expect("valid defaults")
            })
    }

    /// Merges `patch` over the current settings, validates, and persists only the patched
    /// keys, so unset keys (like the home-based working folder) keep following their defaults.
    /// The returned value uses the home from the last `get_settings` call for unset defaults.
    pub fn update_settings(&self, patch: Value) -> Result<Settings> {
        if !patch.is_object() {
            return Err(DbError("settings patch must be a JSON object".into()));
        }
        let home = self.home.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut merged = self.settings_value(&home)?;
        merge_patch(&mut merged, &patch);
        let settings: Settings = serde_json::from_value(merged)?;
        let full = serde_json::to_value(&settings)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for k in patch.as_object().into_iter().flat_map(|o| o.keys()) {
            let Some(v) = full.get(k) else { continue };
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![k, v.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(settings)
    }

    // ---- sign-in account cache ----

    /// The account last seen for a keychain account (`api:<base>`), for showing it offline.
    /// Lives in the settings table under its own key; never holds the token.
    pub fn auth_account(&self, key: &str) -> Option<Account> {
        let raw: Option<String> = self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = ?1", [format!("authAccount:{key}")], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        raw.and_then(|v| serde_json::from_str(&v).ok())
    }

    /// Saves (or with `None`, forgets) the cached account for `key`.
    pub fn set_auth_account(&self, key: &str, account: Option<&Account>) -> Result<()> {
        let k = format!("authAccount:{key}");
        match account {
            Some(a) => self.conn().execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![k, serde_json::to_string(a)?],
            )?,
            None => self.conn().execute("DELETE FROM settings WHERE key = ?1", [k])?,
        };
        Ok(())
    }

    // ---- projects ----

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let sql = format!("{PROJECT_SELECT} ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }

    pub fn insert_project(&self, p: &Project) -> Result<()> {
        let vals = bind_values(p, &PROJECT_KEYS)?;
        self.conn().execute(
            "INSERT INTO projects (id, title, slug, folder, status, created_at, updated_at, kind, format, language) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,'explainer','9:16','id')",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let sql = format!("{PROJECT_SELECT} WHERE id = ?1");
        Ok(query_as::<Project>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    /// Shallow-merges `patch` over the stored project. `id` cannot change; `updatedAt`
    /// is bumped unless the patch sets it.
    pub fn update_project(&self, id: &str, patch: Value) -> Result<Project> {
        if let Some(new_id) = patch.get("id") {
            if new_id != &json!(id) {
                return Err(DbError("project id cannot be changed".into()));
            }
        }
        let current = self
            .get_project(id)?
            .ok_or_else(|| DbError(format!("project not found: {id}")))?;
        let mut merged = serde_json::to_value(&current)?;
        if patch.get("updatedAt").is_none() {
            merged["updatedAt"] = json!(now());
        }
        merge_patch(&mut merged, &patch);
        let updated: Project = serde_json::from_value(merged)?;
        let mut vals = bind_values(&updated, &PROJECT_KEYS)?;
        let id_val = vals.remove(0);
        vals.push(id_val);
        self.conn().execute(
            "UPDATE projects SET title=?1, slug=?2, folder=?3, status=?4, created_at=?5, updated_at=?6 WHERE id=?7",
            params_from_iter(vals),
        )?;
        Ok(updated)
    }

    /// Moves a project along draft → building. Without `reset` it never goes back, and a project
    /// already there is returned as it is, unwritten. `updatedAt` never changes.
    pub fn set_project_status(&self, id: &str, status: ProjectStatus, reset: bool) -> Result<Project> {
        let rank = |s: ProjectStatus| match s {
            ProjectStatus::Draft => 0,
            ProjectStatus::Building => 1,
        };
        let current = self
            .get_project(id)?
            .ok_or_else(|| DbError(format!("project not found: {id}")))?;
        let moves = if reset { current.status != status } else { rank(status) > rank(current.status) };
        if !moves {
            return Ok(current);
        }
        // Not an edit: `updatedAt` (the "recent" order and "x ago") stays as it was.
        self.update_project(id, json!({ "status": status, "updatedAt": current.updated_at }))
    }

    // ---- chats and messages ----

    pub fn create_chat(&self, project_id: Option<&str>, agent: AgentId, title: &str) -> Result<Chat> {
        let chat = Chat {
            id: new_id(),
            project_id: project_id.map(str::to_string),
            agent_id: agent,
            title: title.to_string(),
            created_at: now(),
            folder: None,
        };
        let vals = bind_values(&chat, &["id", "projectId", "agentId", "title", "createdAt"])?;
        self.conn().execute(
            "INSERT INTO chats (id, project_id, agent_id, title, created_at) VALUES (?1,?2,?3,?4,?5)",
            params_from_iter(vals),
        )?;
        Ok(chat)
    }

    /// `Some(id)` lists that project's chats; `None` lists chats not tied to a project.
    pub fn list_chats(&self, project_id: Option<&str>) -> Result<Vec<Chat>> {
        let conn = self.conn();
        match project_id {
            Some(p) => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id = ?1 ORDER BY created_at DESC, rowid DESC"),
                &[&p],
            ),
            None => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id IS NULL ORDER BY created_at DESC, rowid DESC"),
                &[],
            ),
        }
    }

    /// Chats, project or not, newest activity first; a project once (its most active chat), at most
    /// `limit` entries. Chats of a deleted project are left out.
    pub fn list_recent_chats(&self, limit: Option<u32>) -> Result<Vec<RecentChat>> {
        let limit = limit.map_or(-1, i64::from);
        query_as(
            &self.conn(),
            "WITH active AS ( \
               SELECT c.id, c.project_id, c.agent_id, c.title, c.created_at, c.rowid AS rid, p.title AS project_title, \
                 COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id), c.created_at) AS active_at \
               FROM chats c LEFT JOIN projects p ON p.id = c.project_id \
               WHERE (c.project_id IS NULL OR p.id IS NOT NULL) AND c.archived_at IS NULL \
             ), ranked AS ( \
               SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(project_id, id) ORDER BY active_at DESC, rid DESC) AS n \
               FROM active \
             ) \
             SELECT id, project_id AS projectId, agent_id AS agentId, title, created_at AS createdAt, \
               project_title AS projectTitle, active_at AS activeAt \
             FROM ranked WHERE n = 1 ORDER BY active_at DESC, rid DESC LIMIT ?1",
            &[&limit],
        )
    }

    /// Archived threads, most recently archived first: a project once, like Recent.
    pub fn list_archived_chats(&self) -> Result<Vec<RecentChat>> {
        query_as(
            &self.conn(),
            "WITH arch AS ( \
               SELECT c.id, c.project_id, c.agent_id, c.title, c.created_at, c.archived_at, c.rowid AS rid, \
                 p.title AS project_title, \
                 COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id), c.created_at) AS active_at \
               FROM chats c LEFT JOIN projects p ON p.id = c.project_id \
               WHERE (c.project_id IS NULL OR p.id IS NOT NULL) AND c.archived_at IS NOT NULL \
             ), ranked AS ( \
               SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(project_id, id) ORDER BY active_at DESC, rid DESC) AS n \
               FROM arch \
             ) \
             SELECT id, project_id AS projectId, agent_id AS agentId, title, created_at AS createdAt, \
               project_title AS projectTitle, active_at AS activeAt, archived_at AS archivedAt \
             FROM ranked WHERE n = 1 ORDER BY archived_at DESC, rid DESC",
            &[],
        )
    }

    /// Archives or restores a whole thread: every chat of the chat's project, or the chat alone.
    pub fn set_thread_archived(&self, chat_id: &str, archived: bool) -> Result<()> {
        let stamp: Option<String> = archived.then(now);
        self.conn().execute(
            "UPDATE chats SET archived_at = ?2 \
             WHERE COALESCE(project_id, id) = (SELECT COALESCE(project_id, id) FROM chats WHERE id = ?1)",
            rusqlite::params![chat_id, stamp],
        )?;
        Ok(())
    }

    /// Archives or restores board cards. A working card is never archived: it is still going.
    pub fn set_jobs_archived(&self, ids: &[String], archived: bool) -> Result<()> {
        let stamp: Option<String> = archived.then(now);
        let conn = self.conn();
        let tx = conn.unchecked_transaction()?;
        for id in ids {
            tx.execute(
                "UPDATE jobs SET archived_at = ?2 WHERE id = ?1 AND (?2 IS NULL OR status <> 'working')",
                rusqlite::params![id, stamp],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Deletes everything archived for good: archived chats with their messages, and archived cards.
    /// Projects and their folders stay. Returns (chats, cards) removed.
    pub fn purge_archive(&self) -> Result<(usize, usize)> {
        let conn = self.conn();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE archived_at IS NOT NULL)", [])?;
        let chats = tx.execute("DELETE FROM chats WHERE archived_at IS NOT NULL", [])?;
        let cards = tx.execute("DELETE FROM jobs WHERE archived_at IS NOT NULL AND status <> 'working'", [])?;
        tx.commit()?;
        Ok((chats, cards))
    }

    /// Points a chat at another agent. `None` when the chat doesn't exist.
    pub fn set_chat_agent(&self, chat_id: &str, agent: AgentId) -> Result<Option<Chat>> {
        let v = serde_json::to_value(agent)?;
        self.conn().execute(
            "UPDATE chats SET agent_id = ?1 WHERE id = ?2",
            rusqlite::params![v.as_str().unwrap_or_default(), chat_id],
        )?;
        self.get_chat(chat_id)
    }

    /// Attaches a folder to a chat, or detaches it (`None`).
    pub fn set_chat_folder(&self, id: &str, folder: Option<&str>) -> Result<Option<Chat>> {
        self.conn().execute("UPDATE chats SET folder = ?1 WHERE id = ?2", rusqlite::params![folder, id])?;
        self.get_chat(id)
    }

    /// Moves a chat into a project (a feature started from a chat that began without one).
    pub fn set_chat_project(&self, id: &str, project_id: &str) -> Result<Option<Chat>> {
        self.conn().execute("UPDATE chats SET project_id = ?1 WHERE id = ?2", rusqlite::params![project_id, id])?;
        self.get_chat(id)
    }

    pub fn get_chat(&self, id: &str) -> Result<Option<Chat>> {
        let sql = format!("{CHAT_SELECT} WHERE id = ?1");
        Ok(query_as::<Chat>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    pub fn add_message(
        &self,
        chat_id: &str,
        role: MessageRole,
        parts: &[MessagePart],
    ) -> Result<ChatMessage> {
        let msg = ChatMessage {
            id: new_id(),
            chat_id: chat_id.to_string(),
            role,
            parts: parts.to_vec(),
            created_at: now(),
        };
        let role_s = serde_json::to_value(role)?;
        self.conn().execute(
            "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                msg.id,
                msg.chat_id,
                role_s.as_str().unwrap_or_default(),
                serde_json::to_string(&msg.parts)?,
                msg.created_at
            ],
        )?;
        // Writing in an archived thread brings it back to Recent.
        if role == MessageRole::User {
            self.set_thread_archived(chat_id, false)?;
        }
        Ok(msg)
    }

    pub fn list_messages(&self, chat_id: &str) -> Result<Vec<ChatMessage>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, chat_id AS chatId, role, parts, created_at AS createdAt \
             FROM messages WHERE chat_id = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([chat_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "chatId": r.get::<_, String>(1)?,
                "role": r.get::<_, String>(2)?,
                "parts": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, String>(4)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let mut v = row?;
            // A part this version no longer knows (a video app's frame or style mention) is left out,
            // so an old chat still opens.
            let parts: Vec<Value> = serde_json::from_str(v["parts"].as_str().unwrap_or("[]"))?;
            let known: Vec<MessagePart> = parts.into_iter().filter_map(|p| serde_json::from_value(p).ok()).collect();
            v["parts"] = serde_json::to_value(known)?;
            out.push(serde_json::from_value(v)?);
        }
        Ok(out)
    }

    /// Adds `archived_at` to chats and jobs in databases created before the archive.
    /// Adds `chats.folder` (a folder attached to a chat) to databases created before it.
    fn migrate_chat_folder(conn: &Connection) -> Result<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(chats)")?;
        let have = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        if !have.iter().any(|c| c == "folder") {
            conn.execute_batch("ALTER TABLE chats ADD COLUMN folder TEXT")?;
        }
        Ok(())
    }

    fn migrate_archive(conn: &Connection) -> Result<()> {
        for table in ["chats", "jobs"] {
            let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
            let have = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(stmt);
            if !have.iter().any(|c| c == "archived_at") {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN archived_at TEXT"))?;
            }
        }
        Ok(())
    }

    // ---- jobs ----

    pub fn upsert_job(&self, j: &Job) -> Result<()> {
        let vals = bind_values(j, &JOB_KEYS)?;
        self.conn().execute(
            "INSERT INTO jobs (id, kind, title, project_id, chat_id, agent_id, status, progress, note, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, \
             title=excluded.title, project_id=excluded.project_id, chat_id=excluded.chat_id, \
             agent_id=excluded.agent_id, status=excluded.status, progress=excluded.progress, \
             note=excluded.note, updated_at=excluded.updated_at, \
             archived_at=CASE WHEN jobs.status = excluded.status THEN jobs.archived_at ELSE NULL END",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    /// Marks jobs still `working` as failed with `note`: their agent died with the app.
    /// Returns how many changed.
    pub fn fail_stale_jobs(&self, note: &str) -> Result<usize> {
        Ok(self.conn().execute(
            // A permission request (needs-you, no note) died with its session too; a build turn that
            // stopped waiting for an answer (needs-you with its note) still waits for the user.
            "UPDATE jobs SET status = 'failed', note = ?1, updated_at = ?2 \
             WHERE status = 'working' OR (status = 'needs-you' AND note IS NULL)",
            rusqlite::params![note, now()],
        )?)
    }

    /// Removes a job from the board. A job that is working is never deleted (the board may be
    /// stale), and deleting a job that isn't there is fine.
    pub fn delete_job(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM jobs WHERE id = ?1 AND status <> 'working'", [id])?;
        Ok(())
    }

    /// Build cards only: the video app's other cards (renders, style studies) are left out.
    pub fn list_jobs(&self) -> Result<Vec<Job>> {
        let sql = format!("{JOB_SELECT} WHERE kind = 'build' ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }

}

#[cfg(test)]
mod tests {

    #[test]
    fn a_chat_keeps_the_folder_attached_to_it() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(None, AgentId::Claude, "Talk").unwrap();
        assert_eq!(chat.folder, None);
        let attached = db.set_chat_folder(&chat.id, Some("/w/app")).unwrap().unwrap();
        assert_eq!(attached.folder.as_deref(), Some("/w/app"));
        assert_eq!(db.get_chat(&chat.id).unwrap().unwrap().folder.as_deref(), Some("/w/app"));
        assert_eq!(db.set_chat_folder(&chat.id, None).unwrap().unwrap().folder, None);
        assert_eq!(db.set_chat_project(&chat.id, "p1").unwrap().unwrap().project_id.as_deref(), Some("p1"));
    }
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn auth_account_cache_is_per_api_and_stays_out_of_settings() {
        let db = db();
        let home = PathBuf::from("/home/u");
        let a = Account {
            id: "acc_1".into(),
            email: Some("a@b.c".into()),
            name: Some("Ana".into()),
            plan: "pro".into(),
            features: vec![],
            credits: 310,
        };
        assert_eq!(db.auth_account("api:https://bspace.buma.internal/api"), None);
        db.set_auth_account("api:https://bspace.buma.internal/api", Some(&a)).unwrap();
        assert_eq!(db.auth_account("api:https://bspace.buma.internal/api"), Some(a.clone()));
        assert_eq!(db.auth_account("api:http://localhost:8787/api"), None);
        let before = db.get_settings(&home);
        db.update_settings(json!({ "autoMode": true })).unwrap();
        assert_eq!(db.get_settings(&home).api_url, before.api_url, "settings still parse");
        assert!(!serde_json::to_string(&db.get_settings(&home)).unwrap().contains("a@b.c"));
        db.set_auth_account("api:https://bspace.buma.internal/api", None).unwrap();
        assert_eq!(db.auth_account("api:https://bspace.buma.internal/api"), None);
    }

    fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn project(id: &str, updated: &str) -> Project {
        Project {
            id: id.into(),
            title: format!("Title {id}"),
            slug: id.into(),
            folder: format!("/w/{id}"),
            status: ProjectStatus::Draft,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: updated.into(),
        }
    }

    #[test]
    fn old_api_addresses_are_migrated_on_read() {
        let home = PathBuf::from("/home/u");
        for (stored, want) in [
            ("https://api.bspace.buma.internal", DEFAULT_API_URL),
            ("https://api.bspace.buma.internal/", DEFAULT_API_URL),
            ("http://localhost:8787", "http://localhost:8787/api"),
            ("http://localhost:8787/", "http://localhost:8787/api"),
            ("http://127.0.0.1:8787", "http://127.0.0.1:8787/api"),
            ("http://127.0.0.1:8787/", "http://127.0.0.1:8787/api"),
            // Anything else is left alone.
            ("http://localhost:8787/api", "http://localhost:8787/api"),
            ("http://localhost:8787/v2", "http://localhost:8787/v2"),
            ("https://api.bspace.buma.internal/v1", "https://api.bspace.buma.internal/v1"),
            ("http://localhost:8790", "http://localhost:8790"),
            ("https://mine.test", "https://mine.test"),
        ] {
            let db = db();
            db.conn()
                .execute("INSERT INTO settings (key, value) VALUES ('apiUrl', ?1)", [json!(stored).to_string()])
                .unwrap();
            assert_eq!(db.get_settings(&home).api_url, want, "{stored}");
            assert_eq!(db.get_settings(&home).api_url, want, "idempotent: {stored}");
            // A later save of another key keeps the migrated address.
            assert_eq!(db.update_settings(json!({"autoMode": true})).unwrap().api_url, want, "{stored}");
        }
    }

    #[test]
    fn settings_defaults_and_update() {
        let db = db();
        let home = PathBuf::from("/home/u");
        let s = db.get_settings(&home);
        assert_eq!(s.working_folder, home.join("Buma").to_string_lossy());
        assert_eq!(s.default_agent, AgentId::Claude);
        assert!(!s.onboarded && !s.auto_mode);
        assert_eq!(s.api_url, "https://bspace.buma.internal/api");
        assert_eq!(s.ui_language, None);
        assert!(!s.background_mode && !s.open_at_login);
        let b = db.update_settings(json!({"backgroundMode": true, "openAtLogin": true})).unwrap();
        assert!(b.background_mode && b.open_at_login);
        assert!(db.get_settings(&home).background_mode);
        db.update_settings(json!({"backgroundMode": false, "openAtLogin": false})).unwrap();
        let l = db.update_settings(json!({"uiLanguage": "id"})).unwrap();
        assert_eq!(l.ui_language, Some(UiLanguage::Id));
        assert_eq!(db.get_settings(&home).ui_language, Some(UiLanguage::Id));

        let u = db.update_settings(json!({"autoMode": true, "onboarded": true, "defaultAgent": "gemini"})).unwrap();
        assert!(u.auto_mode);
        let again = db.get_settings(&home);
        assert_eq!(again, u);
        assert!(again.onboarded);
        assert_eq!(again.default_agent, AgentId::Gemini);
        assert_eq!(again.working_folder, home.join("Buma").to_string_lossy());
        assert!(db.update_settings(json!({"autoMode": "fast"})).is_err());
        assert!(db.update_settings(json!([1])).is_err());
        assert!(db.update_settings(json!("x")).is_err());
        assert!(db.get_settings(&home).auto_mode);
    }

    #[test]
    fn update_settings_before_get_keeps_home_default() {
        let db = db();
        db.update_settings(json!({"autoMode": true})).unwrap();
        let home = PathBuf::from("/home/u");
        let s = db.get_settings(&home);
        assert!(s.auto_mode);
        assert_eq!(s.working_folder, home.join("Buma").to_string_lossy());
        let other = PathBuf::from("/home/v");
        assert_eq!(db.get_settings(&other).working_folder, other.join("Buma").to_string_lossy());
    }

    #[test]
    fn project_insert_list_update() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        db.insert_project(&project("b", "2026-02-01T00:00:00Z")).unwrap();
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(db.get_project("zzz").unwrap(), None);

        let up = db
            .update_project("a", json!({"title": "New", "status": "building"}))
            .unwrap();
        assert_eq!(up.title, "New");
        assert_eq!(up.status, ProjectStatus::Building);
        assert_eq!(db.get_project("a").unwrap().unwrap(), up);
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["a", "b"]);

        assert!(db.update_project("a", json!({"id": "other"})).is_err());
        assert!(db.update_project("a", json!({"status": "bogus"})).is_err());
        assert!(db.update_project("missing", json!({"title": "x"})).is_err());
        assert_eq!(db.get_project("a").unwrap().unwrap().title, "New");
    }

    #[test]
    fn project_status_only_moves_forward_unless_reset() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let b = db.set_project_status("a", ProjectStatus::Building, false).unwrap();
        assert_eq!(b.status, ProjectStatus::Building);
        // A status move is not an edit: the project keeps its place in "recent" lists.
        assert_eq!(b.updated_at, "2026-01-01T00:00:00Z");
        assert_eq!(db.get_project("a").unwrap().unwrap().updated_at, "2026-01-01T00:00:00Z");
        // The same status again changes nothing, not even the time.
        let again = db.set_project_status("a", ProjectStatus::Building, false).unwrap();
        assert_eq!(again, b);
        // Never backwards on its own.
        assert_eq!(db.set_project_status("a", ProjectStatus::Draft, false).unwrap().status, ProjectStatus::Building);
        // An explicit reset may.
        assert_eq!(db.set_project_status("a", ProjectStatus::Draft, true).unwrap().status, ProjectStatus::Draft);
        assert_eq!(db.get_project("a").unwrap().unwrap().status, ProjectStatus::Draft);
        assert_eq!(db.get_project("a").unwrap().unwrap().updated_at, "2026-01-01T00:00:00Z");
        assert!(db.set_project_status("missing", ProjectStatus::Building, false).is_err());
    }

    #[test]
    fn set_chat_agent_persists_and_misses_unknown_chats() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(Some("a"), AgentId::Claude, "Fix intro").unwrap();
        let updated = db.set_chat_agent(&chat.id, AgentId::Codex).unwrap().unwrap();
        assert_eq!(updated.agent_id, AgentId::Codex);
        assert_eq!(updated.title, "Fix intro");
        assert_eq!(db.get_chat(&chat.id).unwrap().unwrap().agent_id, AgentId::Codex);
        assert_eq!(db.set_chat_agent("nope", AgentId::Gemini).unwrap(), None);
    }

    #[test]
    fn an_archived_thread_leaves_recent_until_restored_or_written_in() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let first = db.create_chat(Some("a"), AgentId::Claude, "First").unwrap();
        let second = db.create_chat(Some("a"), AgentId::Claude, "Second").unwrap();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        // Archiving one chat of a project archives the whole thread.
        db.set_thread_archived(&first.id, true).unwrap();
        let ids = |v: Vec<RecentChat>| v.into_iter().map(|c| c.id).collect::<Vec<_>>();
        assert_eq!(ids(db.list_recent_chats(None).unwrap()), vec![loose.id.clone()]);
        let archived = db.list_archived_chats().unwrap();
        assert_eq!(archived.len(), 1, "a project shows once");
        assert_eq!(archived[0].project_id.as_deref(), Some("a"));
        assert!(archived[0].archived_at.is_some());
        db.set_thread_archived(&second.id, false).unwrap();
        assert_eq!(db.list_recent_chats(None).unwrap().len(), 2);
        assert!(db.list_archived_chats().unwrap().is_empty());
        // The user writing in an archived thread brings it back; the agent writing does not.
        db.set_thread_archived(&loose.id, true).unwrap();
        db.add_message(&loose.id, MessageRole::Agent, &[]).unwrap();
        assert_eq!(db.list_archived_chats().unwrap().len(), 1);
        db.add_message(&loose.id, MessageRole::User, &[]).unwrap();
        assert!(db.list_archived_chats().unwrap().is_empty());
    }

    #[test]
    fn purging_the_archive_deletes_archived_chats_and_cards_only() {
        let db = db();
        let gone = db.create_chat(None, AgentId::Claude, "Gone").unwrap();
        let kept = db.create_chat(None, AgentId::Claude, "Kept").unwrap();
        db.add_message(&gone.id, MessageRole::User, &[]).unwrap();
        db.add_message(&kept.id, MessageRole::User, &[]).unwrap();
        db.set_thread_archived(&gone.id, true).unwrap();
        let job = |id: &str, status: JobStatus| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status,
            progress: None,
            note: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
            archived_at: None,
        };
        db.upsert_job(&job("done", JobStatus::Done)).unwrap();
        db.upsert_job(&job("busy", JobStatus::Working)).unwrap();
        db.upsert_job(&job("other", JobStatus::Done)).unwrap();
        db.set_jobs_archived(&["done".into(), "busy".into()], true).unwrap();
        let archived = |id: &str| db.list_jobs().unwrap().into_iter().find(|j| j.id == id).unwrap().archived_at.is_some();
        assert!(archived("done"));
        assert!(!archived("busy"), "a working card is never archived");
        // Rewriting a card with the same status keeps it archived; a new status brings it back.
        db.upsert_job(&job("done", JobStatus::Done)).unwrap();
        assert!(archived("done"));
        db.upsert_job(&job("other", JobStatus::Done)).unwrap();
        db.set_jobs_archived(&["other".into()], true).unwrap();
        db.upsert_job(&job("other", JobStatus::Working)).unwrap();
        assert!(!archived("other"));

        assert_eq!(db.purge_archive().unwrap(), (1, 1));
        assert!(db.get_chat(&gone.id).unwrap().is_none());
        assert!(db.list_messages(&gone.id).unwrap().is_empty());
        assert_eq!(db.list_messages(&kept.id).unwrap().len(), 1);
        let left: Vec<String> = db.list_jobs().unwrap().into_iter().map(|j| j.id).collect();
        assert!(!left.contains(&"done".to_string()) && left.contains(&"busy".to_string()));
    }

    #[test]
    fn recent_chats_newest_activity_first_with_project_titles() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let video = db.create_chat(Some("a"), AgentId::Claude, "Feature chat").unwrap();
        let loose = db.create_chat(None, AgentId::Codex, "Loose").unwrap();
        let quiet = db.create_chat(None, AgentId::Claude, "Quiet").unwrap();
        // A chat of a deleted project has nowhere to go: it is left out.
        let orphan = db.create_chat(Some("gone"), AgentId::Claude, "Orphan").unwrap();
        let conn = db.conn();
        conn.execute("UPDATE chats SET created_at = '2026-01-01T00:00:00Z'", []).unwrap();
        for (chat, at) in [(&video, "2026-01-02T00:00:00Z"), (&loose, "2026-01-03T00:00:00Z"), (&orphan, "2026-01-09T00:00:00Z")] {
            conn.execute(
                "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?1, ?2, 'user', '[]', ?3)",
                rusqlite::params![format!("m-{}", chat.id), chat.id, at],
            )
            .unwrap();
        }
        drop(conn);

        let recent = db.list_recent_chats(None).unwrap();
        let ids: Vec<&str> = recent.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec![loose.id.as_str(), video.id.as_str(), quiet.id.as_str()]);
        assert_eq!(recent[0].project_title, None);
        assert_eq!(recent[0].active_at, "2026-01-03T00:00:00Z");
        assert_eq!(recent[1].project_title.as_deref(), Some("Title a"));
        assert_eq!(recent[1].project_id.as_deref(), Some("a"));
        // No messages yet: the chat counts from when it was made.
        assert_eq!(recent[2].active_at, "2026-01-01T00:00:00Z");
        assert_eq!(recent[2].title, "Quiet");

        let top = db.list_recent_chats(Some(1)).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].id, loose.id);
    }

    #[test]
    fn messages_have_a_chat_and_time_index_that_survives_reopening() {
        let db = db();
        let names = |db: &Db| -> Vec<String> {
            let conn = db.conn();
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages' ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        assert!(names(&db).contains(&"messages_chat_at".to_string()));
        // Running the schema again (every start) changes nothing.
        db.conn().execute_batch(SCHEMA).unwrap();
        assert_eq!(names(&db).iter().filter(|n| n.as_str() == "messages_chat_at").count(), 1);
        let conn = db.conn();
        let plan: String = conn
            .query_row(
                "EXPLAIN QUERY PLAN SELECT MAX(created_at) FROM messages WHERE chat_id = 'x'",
                [],
                |r| r.get(3),
            )
            .unwrap();
        assert!(plan.contains("messages_chat_at"), "{plan}");
    }

    #[test]
    fn recent_chats_count_a_project_once_before_the_limit() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let busy: Vec<Chat> = (0..5).map(|i| db.create_chat(Some("a"), AgentId::Claude, &format!("A{i}")).unwrap()).collect();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        let conn = db.conn();
        conn.execute("UPDATE chats SET created_at = '2026-01-01T00:00:00Z'", []).unwrap();
        conn.execute("UPDATE chats SET created_at = '2026-01-02T00:00:00Z' WHERE id = ?1", [&busy[2].id]).unwrap();
        conn.execute("UPDATE chats SET created_at = '2026-01-03T00:00:00Z' WHERE project_id = 'a' AND id != ?1", [&busy[2].id])
            .unwrap();
        drop(conn);
        let recent = db.list_recent_chats(Some(2)).unwrap();
        let ids: Vec<&str> = recent.iter().map(|c| c.id.as_str()).collect();
        // The project's most active chat stands for it; the limit counts distinct entries.
        assert_eq!(ids.len(), 2);
        assert_eq!(recent[0].project_id.as_deref(), Some("a"));
        assert_ne!(recent[0].id, busy[2].id);
        assert_eq!(ids[1], loose.id.as_str());
    }

    #[test]
    fn chat_and_messages_round_trip() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let chat = db.create_chat(Some("a"), AgentId::Claude, "Fix intro").unwrap();
        let global = db.create_chat(None, AgentId::Codex, "General").unwrap();
        assert_eq!(db.list_chats(Some("a")).unwrap(), vec![chat.clone()]);
        assert_eq!(db.list_chats(None).unwrap(), vec![global]);
        assert_eq!(db.get_chat(&chat.id).unwrap(), Some(chat.clone()));
        assert_eq!(db.get_chat("nope").unwrap(), None);

        let file = MessagePart::File { path: "/w/a/brief.pdf".into(), name: "brief.pdf".into(), mime: "application/pdf".into(), size: 3, modified_at: None };
        let m1 = db.add_message(&chat.id, MessageRole::User, &[MessagePart::Text { text: "look".into() }, file.clone()]).unwrap();
        let m2 = db.add_message(&chat.id, MessageRole::Agent, &[MessagePart::Text { text: "ok".into() }]).unwrap();
        let got = db.list_messages(&chat.id).unwrap();
        assert_eq!(got, vec![m1, m2]);
        assert_eq!(got[0].parts[1], file);
    }

    #[test]
    fn an_old_chat_with_video_app_parts_still_opens() {
        let db = db();
        let chat = db.create_chat(None, AgentId::Claude, "Old").unwrap();
        db.conn()
            .execute(
                "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES ('m', ?1, 'user', ?2, 't')",
                rusqlite::params![
                    chat.id,
                    r#"[{"type":"text","text":"look"},{"type":"frame","projectId":"p","frame":1,"timeSec":0,"imagePath":"/x.png","marks":[]},{"type":"style-mention","styleId":"s","name":"S"}]"#
                ],
            )
            .unwrap();
        let got = db.list_messages(&chat.id).unwrap();
        assert_eq!(got[0].parts, vec![MessagePart::Text { text: "look".into() }]);
    }

    #[test]
    fn jobs_upsert_and_list() {
        let db = db();
        let mut j = Job {
            id: "j1".into(),
            kind: JobKind::Build,
            title: "Build".into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status: JobStatus::Queued,
            progress: None,
            note: None,
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&j).unwrap();
        j.status = JobStatus::Working;
        j.progress = Some(0.5);
        j.updated_at = "2026-01-02T00:00:00Z".into();
        db.upsert_job(&j).unwrap();
        assert_eq!(db.list_jobs().unwrap(), vec![j.clone()]);
    }

    #[test]
    fn a_video_app_database_still_opens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("buma.db");
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, \
                 project_id TEXT, chat_id TEXT, agent_id TEXT NOT NULL, status TEXT NOT NULL, \
                 progress REAL, note TEXT, source_url TEXT, updated_at TEXT NOT NULL, render_baseline_at TEXT);
                 INSERT INTO jobs VALUES ('old','study-style','Study',NULL,NULL,'claude','failed',NULL,'n','u','t',NULL);
                 INSERT INTO jobs VALUES ('b','build','Build',NULL,NULL,'claude','done',NULL,NULL,NULL,'t',NULL);
                 CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, \
                 folder TEXT NOT NULL, kind TEXT NOT NULL, format TEXT NOT NULL, language TEXT NOT NULL, \
                 status TEXT NOT NULL, style_id TEXT, scheduled_at TEXT, duration_sec REAL, \
                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                 INSERT INTO projects VALUES ('old','T','t','/w/t','promo','9:16','id','rendered',NULL,'2026-11-05T09:00:00Z',NULL,'c','u');",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        // Only build cards show; a style study card from the video app is left out.
        let jobs: Vec<String> = db.list_jobs().unwrap().into_iter().map(|j| j.id).collect();
        assert_eq!(jobs, ["b"]);
        // A rendered video reads as a feature being built; a new feature still saves next to it.
        assert_eq!(db.get_project("old").unwrap().unwrap().status, ProjectStatus::Building);
        db.insert_project(&project("new", "2026-01-01T00:00:00Z")).unwrap();
        assert_eq!(db.list_projects().unwrap().len(), 2);
        assert_eq!(db.update_project("new", json!({"title": "N"})).unwrap().title, "N");
        drop(db);
        assert_eq!(Db::open(&path).unwrap().list_projects().unwrap().len(), 2);
    }

    #[test]
    fn delete_job_removes_only_that_job() {
        let db = db();
        let job = |id: &str| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status: JobStatus::Failed,
            progress: None,
            note: None,
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&job("a")).unwrap();
        db.upsert_job(&job("b")).unwrap();
        let mut working = job("w");
        working.status = JobStatus::Working;
        db.upsert_job(&working).unwrap();
        db.delete_job("a").unwrap();
        db.delete_job("missing").unwrap();
        // A job that is working again (stale board) is never deleted.
        db.delete_job("w").unwrap();
        let ids: Vec<_> = db.list_jobs().unwrap().into_iter().map(|j| j.id).collect();
        assert!(ids.contains(&"w".to_string()) && ids.contains(&"b".to_string()) && !ids.contains(&"a".to_string()));
    }

    #[test]
    fn stale_working_jobs_fail_on_start() {
        let db = db();
        let job = |id: &str, status: JobStatus| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status,
            progress: None,
            note: None,
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&job("w", JobStatus::Working)).unwrap();
        db.upsert_job(&job("d", JobStatus::Done)).unwrap();
        db.upsert_job(&job("p", JobStatus::NeedsYou)).unwrap();
        let mut stopped = job("s", JobStatus::NeedsYou);
        stopped.note = Some("Waiting for your answer".into());
        db.upsert_job(&stopped).unwrap();
        assert_eq!(db.fail_stale_jobs("closed").unwrap(), 2);
        let after = db.list_jobs().unwrap();
        assert_eq!(after.iter().find(|j| j.id == "p").unwrap().status, JobStatus::Failed);
        assert_eq!(after.iter().find(|j| j.id == "s").unwrap().status, JobStatus::NeedsYou);
        let jobs = db.list_jobs().unwrap();
        let w = jobs.iter().find(|j| j.id == "w").unwrap();
        assert_eq!((w.status, w.note.as_deref()), (JobStatus::Failed, Some("closed")));
        assert_eq!(jobs.iter().find(|j| j.id == "d").unwrap().status, JobStatus::Done);
    }
}
