//! The Buma API address: the stored setting, an env override, and endpoints under it.

/// `BUMA_API_URL` (when set and non-empty) wins over the stored `apiUrl`; never stored and
/// used as given (no /api migration), e.g. `BUMA_API_URL=http://localhost:8787/api`.
pub(crate) fn effective_api_url(settings: &crate::types::Settings) -> String {
    resolve_api_url(std::env::var("BUMA_API_URL").ok(), settings)
}

/// `BUMA_API_URL`, when it is set and not blank.
pub(crate) fn env_override() -> Option<String> {
    clean_override(std::env::var("BUMA_API_URL").ok())
}

fn clean_override(env: Option<String>) -> Option<String> {
    env.map(|e| e.trim().to_string()).filter(|e| !e.is_empty())
}

fn resolve_api_url(env: Option<String>, settings: &crate::types::Settings) -> String {
    clean_override(env).unwrap_or_else(|| settings.api_url.clone())
}

/// `path` (e.g. `/v1/me`) under the API base. The base may carry a path
/// (`https://bspace.buma.internal/api`); it is kept, minus one trailing slash.
pub(crate) fn endpoint(api_url: &str, path: &str) -> String {
    let base = api_url.trim();
    format!("{}{}", base.strip_suffix('/').unwrap_or(base), path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::Db;

    #[test]
    fn endpoint_keeps_the_base_path() {
        for base in ["https://bspace.buma.internal/api", "https://bspace.buma.internal/api/", " https://bspace.buma.internal/api "] {
            assert_eq!(endpoint(base, "/v1/me"), "https://bspace.buma.internal/api/v1/me", "{base:?}");
        }
        assert_eq!(endpoint("http://localhost:8787/api", "/v1/auth/token"), "http://localhost:8787/api/v1/auth/token");
        assert_eq!(endpoint("https://edge.test", "/v1/me"), "https://edge.test/v1/me");
    }

    #[test]
    fn env_overrides_api_url_without_storing_it() {
        let db = Db::open_in_memory().unwrap();
        let home = std::path::PathBuf::from("/home/u");
        let mut s = db.get_settings(&home);
        assert_eq!(resolve_api_url(None, &s), "https://bspace.buma.internal/api");
        assert_eq!(resolve_api_url(Some("  ".into()), &s), "https://bspace.buma.internal/api");
        assert_eq!(resolve_api_url(Some("http://localhost:8787".into()), &s), "http://localhost:8787");
        assert_eq!(db.get_settings(&home).api_url, "https://bspace.buma.internal/api", "not stored");
        s = db.update_settings(serde_json::json!({"apiUrl": "https://mine.test"})).unwrap();
        assert_eq!(resolve_api_url(None, &s), "https://mine.test");
        assert_eq!(resolve_api_url(Some("http://x".into()), &s), "http://x");
        assert_eq!(db.get_settings(&home).api_url, "https://mine.test");
    }

    #[test]
    fn old_db_without_api_url_key_gets_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO settings VALUES ('fps','60');",
            )
            .unwrap();
        }
        let s = Db::open(&path).unwrap().get_settings(std::path::Path::new("/h"));
        assert_eq!(s.api_url.as_str(), "https://bspace.buma.internal/api");
    }
}
