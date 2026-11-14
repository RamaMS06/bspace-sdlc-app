//! Installs an agent's CLI for Add connection: npm for most, Cursor's own installer script.

use crate::infra::exec::{augmented_path, Exec, RealExec};
use crate::types::AgentId;

/// The npm package that installs each agent's CLI (Add connection's Install). Claude and Codex run
/// through `npx` and need none; Antigravity and Cursor have their own installers.
pub(crate) fn agent_npm_package(agent: AgentId) -> Option<&'static str> {
    match agent {
        AgentId::Claude => Some("@anthropic-ai/claude-code"),
        AgentId::Codex => Some("@openai/codex"),
        AgentId::Gemini => Some("@google/gemini-cli"),
        AgentId::Opencode => Some("opencode-ai"),
        _ => None,
    }
}

/// Installs an agent's CLI with npm (`npm install -g`). The error is the installer's last lines.
pub(crate) async fn install(agent_id: AgentId) -> Result<(), String> {
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
        let out = cmd.env("PATH", augmented_path()).output().await.map_err(|e| format!("Couldn't run the installer: {e}"))?;
        return finished(out);
    }
    let pkg = agent_npm_package(agent_id).ok_or("This agent has its own installer")?;
    let out = tokio::process::Command::new(RealExec.which("npm").unwrap_or_else(|| "npm".into()))
        .args(["install", "-g", pkg])
        .env("PATH", augmented_path())
        .output()
        .await
        .map_err(|e| format!("Couldn't run npm: {e}"))?;
    finished(out)
}

/// Ok when the installer succeeded, else its last six lines of stderr.
fn finished(out: std::process::Output) -> Result<(), String> {
    if out.status.success() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = text.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    Err(tail.join("\n"))
}
