//! Agent usage: how much of the plan's rolling limits an agent has used.
//! Claude Code reports its plan limits; opencode has none, so its own database gives what it
//! spent instead. The Claude OAuth token is read, used for one request
//! and dropped: it is never logged, stored or sent to the UI.

use crate::system::Exec;
use crate::types::*;
use chrono::{DateTime, Utc};
use std::path::Path;

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

use serde_json::Value;

fn token_from_json(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json.trim()).ok()?;
    let t = v.get("claudeAiOauth")?.get("accessToken")?.as_str()?.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// The OAuth token of Buma's Claude sign-in (`claude_config`, see `claude_account`): the macOS
/// Keychain item Claude Code keeps for that folder, else its `.credentials.json` (Linux, Windows).
/// The caller must never log or return it.
pub fn read_claude_token(exec: &dyn Exec, claude_config: &Path) -> Option<String> {
    if cfg!(target_os = "macos") {
        let service = crate::claude_account::keychain_service(&claude_config.to_string_lossy());
        let out = exec.run("security", &["find-generic-password", "-s", &service, "-w"]);
        if let Some(t) = out.as_deref().and_then(token_from_json) {
            return Some(t);
        }
    }
    let file = std::fs::read_to_string(claude_config.join(".credentials.json")).ok()?;
    token_from_json(&file)
}

fn percent(w: &Value) -> Option<f64> {
    ["utilization", "used_percentage", "percent"]
        .iter()
        .find_map(|k| w.get(*k).and_then(Value::as_f64))
        .map(|p| p.clamp(0.0, 100.0))
}

/// ISO strings are normalised to UTC; numbers are epoch seconds (or milliseconds).
fn resets_at(w: &Value) -> Option<String> {
    let dt = match w.get("resets_at")? {
        Value::String(s) => DateTime::parse_from_rfc3339(s).ok()?.with_timezone(&Utc),
        Value::Number(n) => {
            let n = n.as_f64()?;
            let secs = if n > 1e11 { n / 1000.0 } else { n };
            DateTime::from_timestamp(secs as i64, 0)?
        }
        _ => return None,
    };
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn window(w: &Value) -> Option<UsageWindow> {
    Some(UsageWindow { used_percent: percent(w)?, resets_at: resets_at(w) })
}

fn model_weekly(v: &Value) -> Option<ModelUsage> {
    if let Some(limits) = v.get("limits").and_then(Value::as_array) {
        for l in limits {
            if l.get("kind").and_then(Value::as_str) != Some("weekly_scoped") {
                continue;
            }
            if l.get("is_active").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let name = l.pointer("/scope/model/display_name").and_then(Value::as_str);
            if let (Some(name), Some(w)) = (name, window(l)) {
                return Some(ModelUsage { label: name.to_string(), window: w });
            }
        }
    }
    ["seven_day_fable", "fable_weekly", "fable_seven_day"]
        .iter()
        .find_map(|k| v.get(*k).and_then(window))
        .map(|w| ModelUsage { label: "Fable".into(), window: w })
}

fn stamp(now: DateTime<Utc>) -> String {
    now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn with_status(status: UsageStatus, message: &str, now: DateTime<Utc>) -> AgentUsage {
    AgentUsage {
        agent_id: AgentId::Claude,
        status,
        session: None,
        weekly: None,
        model_weekly: None,
        updated_at: stamp(now),
        message: Some(message.to_string()),
        spend: None,
        account_id: None,
        account: None,
    }
}

pub fn parse_claude_usage(json: &str, now: DateTime<Utc>) -> AgentUsage {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return with_status(UsageStatus::Error, "Couldn't read the usage response", now);
    };
    AgentUsage {
        agent_id: AgentId::Claude,
        status: UsageStatus::Ok,
        session: v.get("five_hour").and_then(window),
        weekly: v.get("seven_day").and_then(window),
        model_weekly: model_weekly(&v),
        updated_at: stamp(now),
        message: None,
        spend: None,
        account_id: None,
        account: None,
    }
}

/// Maps an HTTP status and body to a usage result.
pub fn usage_from_response(status: u16, body: &str, now: DateTime<Utc>) -> AgentUsage {
    match status {
        200..=299 => parse_claude_usage(body, now),
        401 | 403 => with_status(UsageStatus::SignedOut, "Sign in to Claude Code to see usage", now),
        429 => with_status(UsageStatus::Error, "Usage is busy, try again in a minute", now),
        _ => with_status(UsageStatus::Error, "Couldn't load usage", now),
    }
}

/// One GET to the usage endpoint. Errors never include the token.
pub async fn fetch_claude_usage(token: &str) -> Result<AgentUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Couldn't start the usage request".to_string())?;
    let res = client
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|_| "Couldn't reach Anthropic to load usage".to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Ok(usage_from_response(status, &body, Utc::now()))
}

pub const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

/// The ChatGPT sign-in Codex keeps in `<codex home>/auth.json`: its access token and account id.
/// Used for one request and dropped; the caller must never log or return them.
pub fn read_codex_token(codex_home: &Path) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(codex_home.join("auth.json")).ok()?).ok()?;
    let t = v.get("tokens")?;
    let token = t.get("access_token")?.as_str()?.trim();
    let id = t.get("account_id").and_then(Value::as_str).unwrap_or("");
    (!token.is_empty()).then(|| (token.to_string(), id.to_string()))
}

fn codex_window(w: &Value) -> Option<UsageWindow> {
    let used = w.get("used_percent").and_then(Value::as_f64)?.clamp(0.0, 100.0);
    let resets = w.get("reset_at").and_then(Value::as_i64).and_then(|s| DateTime::from_timestamp(s, 0)).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    Some(UsageWindow { used_percent: used, resets_at: resets })
}

/// Codex's plan limits (5 hour and weekly windows) from the ChatGPT usage endpoint.
pub fn parse_codex_usage(json: &str, now: DateTime<Utc>) -> AgentUsage {
    let mut u = with_status(UsageStatus::Error, "Couldn't read Codex usage", now);
    u.agent_id = AgentId::Codex;
    let Ok(v) = serde_json::from_str::<Value>(json) else { return u };
    let Some(rl) = v.get("rate_limit") else { return u };
    u.status = UsageStatus::Ok;
    u.message = None;
    u.session = rl.get("primary_window").and_then(codex_window);
    u.weekly = rl.get("secondary_window").and_then(codex_window);
    u
}

/// One GET to the ChatGPT usage endpoint. Errors never include the token.
pub async fn fetch_codex_usage(token: &str, account_id: &str) -> Result<AgentUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Couldn't start the usage request".to_string())?;
    let mut req = client.get(CODEX_USAGE_URL).bearer_auth(token);
    if !account_id.is_empty() {
        req = req.header("chatgpt-account-id", account_id);
    }
    let res = req.send().await.map_err(|_| "Couldn't reach ChatGPT to load usage".to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    let now = Utc::now();
    let mut u = match status {
        200..=299 => parse_codex_usage(&body, now),
        401 | 403 => with_status(UsageStatus::SignedOut, "Sign in to Codex to see usage", now),
        429 => with_status(UsageStatus::Error, "Usage is busy, try again in a minute", now),
        _ => with_status(UsageStatus::Error, "Couldn't load usage", now),
    };
    u.agent_id = AgentId::Codex;
    Ok(u)
}

/// Where the Cursor editor keeps its state (its sign-in among it).
pub fn cursor_state_db(home: &Path) -> std::path::PathBuf {
    let base = if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
    } else if cfg!(windows) {
        std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(|_| home.join("AppData/Roaming"))
    } else {
        home.join(".config")
    };
    base.join("Cursor/User/globalStorage/state.vscdb")
}

/// The Cursor editor's access token, from its state database (read only).
fn cursor_token_from_db(db: &Path) -> Option<String> {
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let t: String = conn.query_row("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], |r| r.get(0)).ok()?;
    let t = t.trim().trim_matches('"').to_string();
    (!t.is_empty()).then_some(t)
}

/// Cursor's sign-in: the editor's token (its state database), else the one the CLI keeps in the macOS
/// Keychain, with the user id inside it. The caller must never log or return it.
pub fn read_cursor_session(exec: &dyn Exec, home: &Path) -> Option<(String, String)> {
    use base64::Engine;
    let token = cursor_token_from_db(&cursor_state_db(home)).or_else(|| {
        if !cfg!(target_os = "macos") {
            return None;
        }
        exec.run("security", &["find-generic-password", "-s", "cursor-access-token", "-w"]).map(|t| t.trim().to_string())
    })?;
    let claims = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(claims.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let user = v.get("sub")?.as_str()?.rsplit('|').next()?.to_string();
    (!token.is_empty() && !user.is_empty()).then_some((user, token))
}

/// Cursor's plan usage for the billing month, from `usage-summary`: the share of the included usage used.
pub fn parse_cursor_usage(json: &str, now: DateTime<Utc>) -> AgentUsage {
    let mut u = with_status(UsageStatus::Error, "Couldn't read Cursor usage", now);
    u.agent_id = AgentId::Cursor;
    let Ok(v) = serde_json::from_str::<Value>(json) else { return u };
    let Some(pct) = v.pointer("/individualUsage/plan/totalPercentUsed").and_then(Value::as_f64) else { return u };
    let resets = v
        .get("billingCycleEnd")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    u.status = UsageStatus::Ok;
    u.message = None;
    u.model_weekly = Some(ModelUsage { label: "Month".into(), window: UsageWindow { used_percent: pct.clamp(0.0, 100.0), resets_at: resets } });
    u
}

/// One GET to Cursor's usage summary. Errors never include the token.
pub async fn fetch_cursor_usage(user: &str, token: &str) -> Result<AgentUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Couldn't start the usage request".to_string())?;
    let cookie = format!("WorkosCursorSessionToken={user}%3A%3A{token}");
    let res = client
        .get("https://cursor.com/api/usage-summary")
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|_| "Couldn't reach Cursor to load usage".to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    let now = Utc::now();
    Ok(match status {
        200..=299 => parse_cursor_usage(&body, now),
        401 | 403 => {
            let mut u = with_status(UsageStatus::SignedOut, "Sign in to Cursor to see usage", now);
            u.agent_id = AgentId::Cursor;
            u
        }
        _ => {
            let mut u = with_status(UsageStatus::Error, "Couldn't load usage", now);
            u.agent_id = AgentId::Cursor;
            u
        }
    })
}

/// Last results, reused for five minutes unless the UI forces a refresh.
#[derive(Default)]
pub struct UsageCache(pub std::sync::Mutex<Option<(std::time::Instant, Vec<AgentUsage>)>>);

pub const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

pub fn unavailable(id: AgentId, name: &str, now: DateTime<Utc>) -> AgentUsage {
    AgentUsage {
        agent_id: id,
        status: UsageStatus::Unavailable,
        session: None,
        weekly: None,
        model_weekly: None,
        updated_at: stamp(now),
        message: Some(format!("Usage isn't available for {name} yet")),
        spend: None,
        account_id: None,
        account: None,
    }
}

/// opencode's own database (`$XDG_DATA_HOME/opencode/opencode.db`, else `~/.local/share/...`).
pub fn opencode_db(home: &Path, xdg_data_home: Option<&str>) -> std::path::PathBuf {
    let base = xdg_data_home.filter(|d| !d.is_empty()).map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".local").join("share"));
    base.join("opencode").join("opencode.db")
}

/// What opencode used since `day_start` and `week_start` (Unix ms), summed from the assistant
/// messages it records with their tokens and cost. Opened read-only; None when there is no
/// database or it isn't the shape this expects (an older opencode kept JSON files).
pub fn opencode_spend(db: &Path, day_start_ms: i64, week_start_ms: i64) -> Option<SpendSummary> {
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.busy_timeout(std::time::Duration::from_millis(500)).ok()?;
    let sum = |since: i64| -> Option<Spend> {
        conn.query_row(
            "SELECT COUNT(*), \
               COALESCE(SUM(COALESCE(json_extract(data,'$.tokens.input'),0) + COALESCE(json_extract(data,'$.tokens.output'),0) \
                 + COALESCE(json_extract(data,'$.tokens.reasoning'),0)), 0), \
               COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0)), 0.0) \
             FROM message WHERE time_created >= ?1 AND json_extract(data,'$.role') = 'assistant'",
            [since],
            |r| Ok(Spend { replies: r.get::<_, i64>(0)? as u64, tokens: r.get::<_, i64>(1)?.max(0) as u64, cost_usd: r.get(2)? }),
        )
        .ok()
    };
    Some(SpendSummary { today: sum(day_start_ms)?, week: sum(week_start_ms)? })
}

/// opencode's usage: its spend when its database can be read, else "not available".
pub fn opencode_usage(db: &Path, now: DateTime<Utc>) -> AgentUsage {
    use chrono::{Local, TimeZone};
    let local = now.with_timezone(&Local);
    let midnight = local.date_naive().and_hms_opt(0, 0, 0).and_then(|t| Local.from_local_datetime(&t).earliest());
    let day_start = midnight.map_or(now.timestamp_millis() - 86_400_000, |m| m.timestamp_millis());
    let week_start = day_start - 6 * 86_400_000;
    match opencode_spend(db, day_start, week_start) {
        Some(spend) => AgentUsage {
            agent_id: AgentId::Opencode,
            status: UsageStatus::Ok,
            session: None,
            weekly: None,
            model_weekly: None,
            updated_at: stamp(now),
            message: None,
            spend: Some(spend),
            account_id: None,
            account: None,
        },
        None => unavailable(AgentId::Opencode, "OpenCode", now),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 4, 10, 0, 0).unwrap()
    }

    struct Fake(Option<String>);
    impl Exec for Fake {
        fn run(&self, _p: &str, _a: &[&str]) -> Option<String> {
            self.0.clone()
        }
        fn which(&self, _p: &str) -> Option<std::path::PathBuf> {
            None
        }
    }

    const FULL: &str = r#"{
      "five_hour": {"utilization": 33.0, "resets_at": "2026-11-04T11:41:00Z"},
      "seven_day": {"utilization": 48, "resets_at": "2026-11-07T23:00:00.000000+00:00"},
      "limits": [
        {"kind": "weekly_scoped", "percent": 26, "resets_at": "2026-11-08T00:00:00Z", "is_active": true,
         "scope": {"model": {"display_name": "Fable"}}},
        {"kind": "weekly_scoped", "percent": 90, "resets_at": "2026-11-08T00:00:00Z", "is_active": false,
         "scope": {"model": {"display_name": "Old"}}}
      ]
    }"#;

    #[test]
    fn parses_cursor_month() {
        let j = r#"{"billingCycleEnd":"2026-11-28T02:57:43.000Z","individualUsage":{"plan":{"totalPercentUsed":7.996}}}"#;
        let u = parse_cursor_usage(j, now());
        assert_eq!((u.agent_id, u.status), (AgentId::Cursor, UsageStatus::Ok));
        let m = u.model_weekly.unwrap();
        assert_eq!(m.window.used_percent, 7.996);
        assert!(m.window.resets_at.unwrap().starts_with("2026-11-28"));
        assert_eq!(parse_cursor_usage("{}", now()).status, UsageStatus::Error);
    }

    #[test]
    fn parses_codex_windows() {
        let j = r#"{"rate_limit":{"primary_window":{"used_percent":12,"reset_at":1794678100},"secondary_window":{"used_percent":2.5,"reset_at":1794992996}}}"#;
        let u = parse_codex_usage(j, now());
        assert_eq!((u.agent_id, u.status), (AgentId::Codex, UsageStatus::Ok));
        assert_eq!(u.session.unwrap().used_percent, 12.0);
        assert_eq!(u.weekly.unwrap().used_percent, 2.5);
        assert_eq!(parse_codex_usage("{}", now()).status, UsageStatus::Error);
    }

    #[test]
    fn parses_windows_and_scoped_model() {
        let u = parse_claude_usage(FULL, now());
        assert_eq!(u.status, UsageStatus::Ok);
        assert_eq!(u.agent_id, AgentId::Claude);
        let s = u.session.unwrap();
        assert_eq!(s.used_percent, 33.0);
        assert_eq!(s.resets_at.as_deref(), Some("2026-11-04T11:41:00Z"));
        assert_eq!(u.weekly.unwrap().used_percent, 48.0);
        let m = u.model_weekly.unwrap();
        assert_eq!(m.label, "Fable");
        assert_eq!(m.window.used_percent, 26.0);
        assert_eq!(u.updated_at, "2026-11-04T10:00:00Z");
    }

    #[test]
    fn epoch_resets_and_used_percentage() {
        let j = r#"{"five_hour": {"used_percentage": 12.5, "resets_at": 1793790000},
                    "seven_day": {"utilization": 1, "resets_at": 1793790000000}}"#;
        let u = parse_claude_usage(j, now());
        let s = u.session.unwrap();
        assert_eq!(s.used_percent, 12.5);
        assert_eq!(s.resets_at.as_deref(), Some("2026-11-04T11:00:00Z"));
        assert_eq!(u.weekly.unwrap().resets_at.as_deref(), Some("2026-11-04T11:00:00Z"));
        assert!(u.model_weekly.is_none());
    }

    #[test]
    fn fable_fallback_keys() {
        for key in ["seven_day_fable", "fable_weekly", "fable_seven_day"] {
            let j = format!(r#"{{"{key}": {{"utilization": 26, "resets_at": null}}}}"#);
            let m = parse_claude_usage(&j, now()).model_weekly.unwrap();
            assert_eq!(m.label, "Fable");
            assert_eq!(m.window.used_percent, 26.0);
            assert_eq!(m.window.resets_at, None);
        }
    }

    #[test]
    fn clamps_percent_and_rejects_garbage() {
        let j = r#"{"five_hour": {"utilization": 140}}"#;
        assert_eq!(parse_claude_usage(j, now()).session.unwrap().used_percent, 100.0);
        let u = parse_claude_usage("not json", now());
        assert_eq!(u.status, UsageStatus::Error);
    }

    #[test]
    fn http_statuses() {
        assert_eq!(usage_from_response(200, FULL, now()).status, UsageStatus::Ok);
        for code in [401, 403] {
            assert_eq!(usage_from_response(code, "", now()).status, UsageStatus::SignedOut);
        }
        let busy = usage_from_response(429, "", now());
        assert_eq!(busy.status, UsageStatus::Error);
        assert_eq!(busy.message.as_deref(), Some("Usage is busy, try again in a minute"));
        assert_eq!(usage_from_response(500, "", now()).status, UsageStatus::Error);
    }

    #[test]
    fn unavailable_message() {
        let u = unavailable(AgentId::Gemini, "Gemini CLI", now());
        assert_eq!(u.status, UsageStatus::Unavailable);
        assert_eq!(u.message.as_deref(), Some("Usage isn't available for Gemini CLI yet"));
    }

    #[test]
    fn token_from_credentials_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".credentials.json"),
            r#"{"claudeAiOauth": {"accessToken": "tok-file"}}"#,
        )
        .unwrap();
        assert_eq!(read_claude_token(&Fake(None), dir.path()).as_deref(), Some("tok-file"));
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_claude_token(&Fake(None), empty.path()), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn token_from_keychain_on_macos() {
        let dir = tempfile::tempdir().unwrap();
        let ex = Fake(Some("{\"claudeAiOauth\":{\"accessToken\":\"tok-kc\"}}\n".into()));
        assert_eq!(read_claude_token(&ex, dir.path()).as_deref(), Some("tok-kc"));
    }

    #[test]
    fn opencode_spend_sums_assistant_messages_by_period() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("opencode.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, \
             time_updated integer NOT NULL, data text NOT NULL);",
        )
        .unwrap();
        let add = |id: &str, at: i64, data: &str| {
            conn.execute("INSERT INTO message VALUES (?1,'s',?2,?2,?3)", rusqlite::params![id, at, data]).unwrap();
        };
        let reply = r#"{"role":"assistant","cost":0.25,"tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":9000}}}"#;
        add("today", 2_000, reply);
        add("week", 1_500, reply);
        add("old", 100, reply);
        add("user", 2_000, r#"{"role":"user"}"#);
        add("free", 2_500, r#"{"role":"assistant","cost":0,"tokens":{"input":10,"output":1}}"#);
        drop(conn);
        let s = opencode_spend(&db, 1_900, 1_000).unwrap();
        assert_eq!(s.today, Spend { replies: 2, tokens: 125 + 11, cost_usd: 0.25 });
        assert_eq!(s.week, Spend { replies: 3, tokens: 250 + 11, cost_usd: 0.5 });
        assert!(opencode_spend(&dir.path().join("missing.db"), 0, 0).is_none());
        let u = opencode_usage(&db, Utc::now());
        assert_eq!((u.agent_id, u.status), (AgentId::Opencode, UsageStatus::Ok));
        assert_eq!(opencode_usage(&dir.path().join("missing.db"), Utc::now()).status, UsageStatus::Unavailable);
    }

    #[test]
    fn opencode_db_follows_xdg_data_home() {
        let home = Path::new("/home/u");
        assert_eq!(opencode_db(home, None), Path::new("/home/u/.local/share/opencode/opencode.db"));
        assert_eq!(opencode_db(home, Some("/data")), Path::new("/data/opencode/opencode.db"));
        assert_eq!(opencode_db(home, Some("")), Path::new("/home/u/.local/share/opencode/opencode.db"));
    }
}
