//! Every model (and every version of it) an agent can run, for the "+ Model" menu in Settings ›
//! Agents › Provider. Claude: Anthropic's model list, read with the Claude sign-in. opencode: its own
//! `opencode models`. Other agents report theirs through ACP (`agent_models`).

use serde_json::Value;

use crate::types::ModelChoice;

pub const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=1000";

/// Anthropic's `/v1/models` answer as choices: id and display name, newest first as Anthropic sends them.
pub fn from_anthropic(body: &str) -> Vec<ModelChoice> {
    let Ok(v) = serde_json::from_str::<Value>(body) else { return Vec::new() };
    v.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let name = m.get("display_name").and_then(Value::as_str).unwrap_or(&id).to_string();
            Some(ModelChoice { value: id, name, description: None })
        })
        .collect()
}

/// Codex's own list of the models its signed-in account can use (`models_cache.json` in its home,
/// fetched by Codex for that identity): the ones it lists (`visibility: list`), in its order.
/// A ChatGPT account and an API key get different lists, so this is what the account can really run.
pub fn from_codex_cache(body: &str) -> Vec<ModelChoice> {
    let Ok(v) = serde_json::from_str::<Value>(body) else { return Vec::new() };
    let mut models: Vec<&Value> = v
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| m.get("visibility").and_then(Value::as_str).unwrap_or("list") == "list")
        .collect();
    models.sort_by_key(|m| m.get("priority").and_then(Value::as_i64).unwrap_or(i64::MAX));
    models
        .into_iter()
        .filter_map(|m| {
            let slug = m.get("slug")?.as_str()?.to_string();
            let name = m.get("display_name").and_then(Value::as_str).unwrap_or(&slug).to_string();
            let description = m.get("description").and_then(Value::as_str).map(str::to_string);
            Some(ModelChoice { value: slug, name, description })
        })
        .collect()
}

/// `opencode models` prints one `provider/model` per line.
pub fn from_opencode(out: &str) -> Vec<ModelChoice> {
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && l.contains('/') && !l.contains(' '))
        .map(|l| ModelChoice { value: l.to_string(), name: l.to_string(), description: None })
        .collect()
}

/// Anthropic's model list with the Claude sign-in (the same OAuth token the usage meter uses).
pub async fn fetch_anthropic(token: &str) -> Result<Vec<ModelChoice>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("bspace-sdlc-app/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(ANTHROPIC_MODELS_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|_| "Couldn't reach Anthropic to list models".to_string())?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Anthropic answered {status} for the model list"));
    }
    Ok(from_anthropic(&body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_anthropic_models_with_names() {
        let body = r#"{"data":[{"id":"claude-opus-5-5","display_name":"Claude Opus 5.5","type":"model"},{"id":"claude-sonnet-5-5"}],"has_more":false}"#;
        let list = from_anthropic(body);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].value, "claude-opus-5-5");
        assert_eq!(list[0].name, "Claude Opus 5.5");
        assert_eq!(list[1].name, "claude-sonnet-5-5");
        assert!(from_anthropic("not json").is_empty());
    }

    #[test]
    fn reads_the_codex_accounts_own_models_in_its_order() {
        let body = r#"{"identity":"x","models":[
            {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","priority":3},
            {"slug":"codex-auto-review","display_name":"Codex Auto Review","visibility":"hide","priority":10},
            {"slug":"gpt-6.1-sol","display_name":"GPT-6.1-Sol","visibility":"list","priority":1}
        ]}"#;
        let list = from_codex_cache(body);
        assert_eq!(list.iter().map(|m| m.value.as_str()).collect::<Vec<_>>(), ["gpt-6.1-sol", "gpt-6-astra"]);
        assert_eq!(list[0].name, "GPT-6.1-Sol");
        assert!(from_codex_cache("nope").is_empty());
    }

    #[test]
    fn reads_opencode_models() {
        let out = "anthropic/claude-sonnet-5-5\nopenai/gpt-5.5\n\nsome log line here\n";
        let list = from_opencode(out);
        assert_eq!(list.iter().map(|m| m.value.as_str()).collect::<Vec<_>>(), ["anthropic/claude-sonnet-5-5", "openai/gpt-5.5"]);
    }
}
