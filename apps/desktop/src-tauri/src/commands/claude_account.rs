//! Claude in Buma: who is signed in, and signing in and out (see `domain::claude_account`).

use super::{app_data_dir, CmdResult};
use crate::app::events::CLAUDE_SIGN_IN_URL;
use crate::app::state::{ClaudeSignIn, UsageCache};
use crate::domain::accounts::claude_config_dir;
use crate::domain::claude_account::{self, ClaudeAccount};
use tauri::{AppHandle, Emitter, State};

/// Who is signed in to Claude in Buma.
#[tauri::command]
pub(crate) async fn claude_account(app: AppHandle) -> CmdResult<ClaudeAccount> {
    let dir = claude_config_dir(&app_data_dir(&app)?)?;
    let Ok(claude) = claude_account::program() else { return Ok(Default::default()) };
    Ok(claude_account::status(&claude, &dir).await)
}

/// Signs in to Claude for Buma: Claude Code opens the browser and the user signs in there.
/// Resolves with the account once they're done; an error when cancelled, timed out or refused.
#[tauri::command]
pub(crate) async fn claude_sign_in(app: AppHandle, pending: State<'_, ClaudeSignIn>, usage: State<'_, UsageCache>) -> CmdResult<ClaudeAccount> {
    let dir = claude_config_dir(&app_data_dir(&app)?)?;
    let claude = claude_account::program()?;
    let emitter = app.clone();
    let end = claude_account::sign_in_cancellable(&claude, &dir, &pending.0, move |url| {
        let _ = emitter.emit(CLAUDE_SIGN_IN_URL, url);
    })
    .await;
    usage.clear()?;
    end?;
    let account = claude_account::status(&claude, &dir).await;
    if account.signed_in {
        Ok(account)
    } else {
        Err("Claude didn't finish signing in. Try again".into())
    }
}

/// Stops a sign-in that is waiting for the browser.
#[tauri::command]
pub(crate) fn claude_sign_in_cancel(pending: State<'_, ClaudeSignIn>) -> CmdResult<()> {
    if let Some(tx) = pending.0.lock().map_err(super::err)?.take() {
        let _ = tx.send(());
    }
    Ok(())
}

/// Signs out of Claude in Buma. Running Claude chats keep going until they end.
#[tauri::command]
pub(crate) async fn claude_sign_out(app: AppHandle, usage: State<'_, UsageCache>) -> CmdResult<ClaudeAccount> {
    let dir = claude_config_dir(&app_data_dir(&app)?)?;
    let claude = claude_account::program()?;
    usage.clear()?;
    Ok(claude_account::sign_out(&claude, &dir).await)
}
