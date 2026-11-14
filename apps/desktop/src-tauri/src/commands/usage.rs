//! Usage: the agents' limits and spend, their turns and failovers, and the Buma account's AI credits.

use super::{app_data_dir, err, CmdResult};
use crate::app::state::{AppState, UsageCache};
use crate::domain::auth::Auth;
use crate::domain::{activity, usage};
use crate::infra::cloud::{self, CloudError};
use crate::types::{AgentUsage, UsageStatus};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Every installed agent's usage, per account. Reused for five minutes unless `force`.
#[tauri::command]
pub(crate) async fn get_agent_usage(
    app: AppHandle,
    state: State<'_, AppState>,
    cache: State<'_, UsageCache>,
    force: bool,
) -> CmdResult<Vec<AgentUsage>> {
    if !force {
        if let Some((at, v)) = cache.0.lock().map_err(err)?.as_ref() {
            if at.elapsed() < UsageCache::TTL {
                return Ok(v.clone());
            }
        }
    }
    let out = usage::report::collect(&app_data_dir(&app)?, &state.home).await?;
    // Failures aren't cached, so the next poll retries.
    if out.iter().all(|u| u.status != UsageStatus::Error) {
        *cache.0.lock().map_err(err)? = Some((std::time::Instant::now(), out.clone()));
    }
    Ok(out)
}

/// Settings › Agents › Usage: the agents' turns and failovers of the last `days` days (all when None).
#[tauri::command]
pub(crate) async fn agent_activity(app: AppHandle, days: Option<u32>) -> CmdResult<Vec<serde_json::Value>> {
    let path = app_data_dir(&app)?.join("agent-usage.jsonl");
    let since = days.map(|d| chrono::Utc::now() - chrono::Duration::days(i64::from(d)));
    tauri::async_runtime::spawn_blocking(move || activity::read(&path, since)).await.map_err(err)
}

/// Records that a chat moved to the next agent (failover), for the Usage screen.
#[tauri::command]
pub(crate) async fn agent_failover_record(app: AppHandle, chat_id: String, from: String, to: String, reason: String) -> CmdResult<()> {
    let path = app_data_dir(&app)?.join("agent-usage.jsonl");
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    activity::append(&path, &activity::failover_line(&chat_id, &from, &to, &reason, &at)).map_err(err)
}

/// AI credits left in this cycle (`GET /v1/usage`). Errors are `cloud:<code>`, the kebab-case
/// `CloudError` the UI knows.
#[tauri::command]
pub(crate) async fn cloud_usage(state: State<'_, AppState>, auth: State<'_, Arc<Auth>>) -> CmdResult<serde_json::Value> {
    let auth = auth.inner().clone();
    let base = state.api_base();
    let Some(token) = auth.token(&base).await else { return Err(cloud_err(CloudError::SignedOut)) };
    let r = cloud::get(auth.client(), &base, &token, "/v1/usage").await;
    if let Err(e) = &r {
        eprintln!("[cloud] usage: {}", e.code());
        // A 401 means the token is gone at the API: let the sign-in state find out (it clears it).
        if *e == CloudError::SignedOut {
            tauri::async_runtime::spawn(async move { auth.refresh(&base).await });
        }
    }
    r.map_err(cloud_err)
}

fn cloud_err(e: CloudError) -> String {
    format!("cloud:{}", e.code())
}
