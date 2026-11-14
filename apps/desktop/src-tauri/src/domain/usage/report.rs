//! Settings › Agents › Usage: each installed agent's limits and spend, one entry per account.

use crate::domain::accounts;
use crate::domain::agents::detect;
use crate::infra::exec::RealExec;
use crate::types::{AgentId, AgentUsage, UsageStatus};
use std::path::{Path, PathBuf};

/// Every installed agent's usage: each account of the agent has its own numbers, the default one
/// first, then the extra ones.
pub(crate) async fn collect(data: &Path, home: &Path) -> Result<Vec<AgentUsage>, String> {
    let acc = accounts::load(data);
    let agents = tauri::async_runtime::spawn_blocking(|| detect::detect_agents(&RealExec)).await.map_err(|e| e.to_string())?;
    let now = chrono::Utc::now();
    let mut out = Vec::new();
    for a in agents.iter().filter(|a| a.installed) {
        // Every account of the agent has its own numbers: the default one first, then the extra ones.
        let ids: Vec<String> = std::iter::once(accounts::DEFAULT.to_string())
            .chain(acc.extra.iter().filter(|e| e.agent == a.id).map(|e| e.id.clone()))
            .collect();
        if a.id == AgentId::Opencode {
            for id in ids {
                let dir = accounts::dir(data, a.id, &id);
                let xdg = match &dir {
                    Some(d) => Some(d.to_string_lossy().into_owned()),
                    None => std::env::var("XDG_DATA_HOME").ok(),
                };
                let db = super::opencode_db(home, xdg.as_deref());
                if id != accounts::DEFAULT && !db.is_file() {
                    continue;
                }
                let mut usage = tauri::async_runtime::spawn_blocking(move || super::opencode_usage(&db, now)).await.map_err(|e| e.to_string())?;
                usage.account_id = Some(id);
                usage.account = match dir.as_deref() {
                    Some(d) => detect::account_in(a.id, d),
                    None => detect::agent_account(a.id, home),
                };
                out.push(usage);
            }
            continue;
        }
        if a.id == AgentId::Codex {
            for id in ids {
                let codex_home = match accounts::dir(data, a.id, &id) {
                    Some(d) => d,
                    None => std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".codex")),
                };
                let creds = super::read_codex_token(&codex_home);
                if creds.is_none() && id != accounts::DEFAULT {
                    continue;
                }
                let mut usage = match &creds {
                    None => {
                        let mut u = super::unavailable(a.id, &a.name, now);
                        u.status = UsageStatus::SignedOut;
                        u.message = Some("Sign in to Codex to see usage".into());
                        u
                    }
                    Some((t, acct)) => super::fetch_codex_usage(t, acct).await.unwrap_or_else(|m| {
                        let mut u = super::unavailable(a.id, &a.name, now);
                        u.status = UsageStatus::Error;
                        u.message = Some(m);
                        u
                    }),
                };
                usage.account = match accounts::dir(data, a.id, &id) {
                    Some(d) => detect::account_in(a.id, &d),
                    None => detect::agent_account(a.id, home),
                };
                usage.account_id = Some(id);
                out.push(usage);
            }
            continue;
        }
        if a.id == AgentId::Cursor {
            let cursor_home = home.to_path_buf();
            let session = tauri::async_runtime::spawn_blocking(move || super::read_cursor_session(&RealExec, &cursor_home)).await.map_err(|e| e.to_string())?;
            let mut usage = match &session {
                None => {
                    let mut u = super::unavailable(a.id, &a.name, now);
                    u.status = UsageStatus::SignedOut;
                    u.message = Some("Sign in to Cursor to see usage".into());
                    u
                }
                Some((user, token)) => super::fetch_cursor_usage(user, token).await.unwrap_or_else(|m| {
                    let mut u = super::unavailable(a.id, &a.name, now);
                    u.status = UsageStatus::Error;
                    u.message = Some(m);
                    u
                }),
            };
            usage.account_id = Some(accounts::DEFAULT.to_string());
            usage.account = std::fs::read_to_string(home.join(".cursor/cli-config.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.pointer("/authInfo/email").and_then(|e| e.as_str()).map(str::to_string));
            out.push(usage);
            continue;
        }
        if a.id != AgentId::Claude {
            out.push(super::unavailable(a.id, &a.name, now));
            continue;
        }
        for id in ids {
            let Some(dir) = accounts::dir(data, a.id, &id) else { continue };
            let d = dir.clone();
            let token = tauri::async_runtime::spawn_blocking(move || super::read_claude_token(&RealExec, &d)).await.map_err(|e| e.to_string())?;
            // An extra account that never signed in has nothing to show.
            if token.is_none() && id != accounts::DEFAULT {
                continue;
            }
            let mut usage = match &token {
                None => super::usage_from_response(401, "", now),
                Some(t) => match super::fetch_claude_usage(t).await {
                    Ok(u) => u,
                    Err(m) => {
                        let mut u = super::usage_from_response(0, "", now);
                        u.message = Some(m);
                        u
                    }
                },
            };
            usage.account = match (token.is_some(), crate::domain::claude_account::program()) {
                (true, Ok(claude)) => crate::domain::claude_account::status(&claude, &dir).await.email,
                _ => None,
            };
            usage.account_id = Some(id);
            out.push(usage);
        }
    }
    Ok(out)
}
