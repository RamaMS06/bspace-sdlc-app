//! SQLite storage for settings, projects, chats and jobs: one `Db` over one connection, its schema
//! and migrations here, and one `impl Db` block per aggregate in the submodules.

mod chats;
mod jobs;
mod projects;
mod settings;

use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::Connection;
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

    #[cfg(test)]
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

    /// Adds `archived_at` to chats and jobs in databases created before the archive.
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
}

#[cfg(test)]
pub(crate) mod testing {
    use crate::infra::db::Db;
    use crate::types::{Project, ProjectStatus};

    pub(crate) fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    pub(crate) fn project(id: &str, updated: &str) -> Project {
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

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::testing::*;
    use crate::types::*;
    use serde_json::json;

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

}
