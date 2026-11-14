//! Settings and the sign-in account cache (both in the `settings` table).

use super::{merge_patch, Db, DbError, Result};
use crate::types::*;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::path::Path;

pub(crate) const DEFAULT_API_URL: &str = "https://bspace.buma.internal/api";

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

impl Db {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::testing::*;
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


}
