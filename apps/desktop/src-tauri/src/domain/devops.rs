//! Azure DevOps sign-in. BUMA keeps its code, the BUMA Design System packages and buma-registry on
//! Azure DevOps, so the app requires a signed-in DevOps account before it opens.
//!
//! Two ways in, both checked against the organization (`_apis/connectionData`):
//! - Sign in with Microsoft: the Azure CLI (`az login`) opens Microsoft's sign-in page in the browser.
//!   Buma keeps no secret: it asks the Azure CLI for an Azure DevOps token whenever it needs one.
//!   (A direct OAuth sign-in needs a Microsoft Entra app registration for BUMA; until there is one the
//!   Azure CLI's sign-in is the way.)
//! - A personal access token (PAT), the same kind buma-cli's `setup` uses, kept in the OS keychain (a
//!   0600 file only when there is no keychain, or in dev builds).
//! Only the profile ever reaches the webview.
use crate::infra::token_store::ApiKeys;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// The keychain account the sign-in is saved under.
pub const ACCOUNT: &str = "azure-devops";

/// Who is signed in: shown in the app, never secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevopsProfile {
    pub org: String,
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
}

/// How the user signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Method {
    #[default]
    Pat,
    AzureCli,
}

/// What the keychain holds: the method, the token for a PAT sign-in, and the profile it was checked as.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    #[serde(default)]
    pub method: Method,
    #[serde(default)]
    pub pat: String,
    pub profile: DevopsProfile,
}

/// Azure DevOps' resource id, for an Entra token that Azure DevOps accepts.
pub const AZURE_DEVOPS_RESOURCE: &str = "499b84ac-1321-427f-aa17-267ca6975798";
/// How long the browser sign-in may take.
pub const AZ_LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

async fn run_az(az: &std::path::Path, args: &[&str], timeout: std::time::Duration) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(az);
    cmd.args(args).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| "Signing in with Microsoft took too long. Try again.".to_string())?
        .map_err(|e| format!("Couldn't run the Azure CLI: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "The Azure CLI sign-in didn't finish.".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// An Azure DevOps token from the Azure CLI's sign-in; None when nobody is signed in there.
pub async fn az_token(az: &std::path::Path) -> Option<String> {
    run_az(az, &["account", "get-access-token", "--resource", AZURE_DEVOPS_RESOURCE, "--query", "accessToken", "-o", "tsv"], std::time::Duration::from_secs(30))
        .await
        .ok()
        .filter(|t| !t.is_empty())
}

/// Signs in with Microsoft through the Azure CLI (browser), unless it is already signed in, and returns
/// an Azure DevOps token.
pub async fn az_sign_in(az: &std::path::Path) -> Result<String, String> {
    if let Some(token) = az_token(az).await {
        return Ok(token);
    }
    run_az(az, &["login", "--allow-no-subscriptions", "--only-show-errors", "-o", "none"], AZ_LOGIN_TIMEOUT).await?;
    az_token(az).await.ok_or_else(|| "Signed in, but the Azure CLI gave no Azure DevOps token. Try again.".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevopsStatus {
    pub signed_in: bool,
    /// The signed-in account is an admin (see `domain::admin`): it can edit the SDLC plugin.
    pub admin: bool,
    pub profile: Option<DevopsProfile>,
}

impl DevopsStatus {
    pub fn signed_in(profile: DevopsProfile) -> Self {
        Self { signed_in: true, admin: super::admin::is_admin(&profile), profile: Some(profile) }
    }
    pub fn signed_out() -> Self {
        Self { signed_in: false, admin: false, profile: None }
    }
}

/// `buma`, `https://dev.azure.com/buma/…` and `https://buma.visualstudio.com/…` are all the `buma`
/// organization. None for anything that isn't an organization name.
pub fn normalize_org(input: &str) -> Option<String> {
    let s = input.trim().trim_end_matches('/');
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let name = if let Some(rest) = s.strip_prefix("dev.azure.com/") {
        rest.split('/').next().unwrap_or("")
    } else if let Some((host, _)) = s.split_once(".visualstudio.com") {
        host
    } else if s.contains('/') || s.contains('.') {
        return None;
    } else {
        s
    };
    let name = name.to_lowercase();
    let valid = !name.is_empty() && name.len() <= 50 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    valid.then_some(name)
}

/// The `Authorization` header for a PAT: Basic with an empty user name.
pub fn basic_auth(pat: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!(":{pat}")))
}

/// Reads the signed-in user from a `connectionData` response. An anonymous user (a token the
/// organization didn't accept) has no account email and no display name.
pub fn parse_connection_data(org: &str, body: &str) -> Result<DevopsProfile, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|_| INVALID.to_string())?;
    let user = v.get("authenticatedUser").ok_or(INVALID)?;
    let id = user.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let display_name = user
        .get("providerDisplayName")
        .or_else(|| user.get("customDisplayName"))
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let email = user
        .pointer("/properties/Account/$value")
        .and_then(|x| x.as_str())
        .filter(|e| e.contains('@'))
        .map(str::to_string);
    let anonymous = display_name.is_empty() || display_name.eq_ignore_ascii_case("anonymous") || id.is_empty();
    if anonymous {
        return Err(INVALID.to_string());
    }
    Ok(DevopsProfile { org: org.to_string(), id, display_name, email })
}

const INVALID: &str = "Azure DevOps didn't accept that token for this organization. Check the organization name and that the token hasn't expired.";

/// Checks `pat` against `org` and returns who it belongs to. `base` is `https://dev.azure.com` (tests
/// point it at a local server).
pub async fn verify(client: &reqwest::Client, base: &str, org: &str, pat: &str) -> Result<DevopsProfile, String> {
    verify_with(client, base, org, &basic_auth(pat)).await
}

/// Like `verify`, with a Microsoft Entra token from the Azure CLI.
pub async fn verify_bearer(client: &reqwest::Client, base: &str, org: &str, token: &str) -> Result<DevopsProfile, String> {
    verify_with(client, base, org, &format!("Bearer {token}")).await
}

async fn verify_with(client: &reqwest::Client, base: &str, org: &str, authorization: &str) -> Result<DevopsProfile, String> {
    let url = format!("{}/{}/_apis/connectionData?api-version=7.1-preview", base.trim_end_matches('/'), org);
    let res = client
        .get(&url)
        .header("Authorization", authorization)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "Can't reach Azure DevOps. Check your internet connection and try again.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        return Err(format!("There is no Azure DevOps organization named \"{org}\"."));
    }
    // A rejected token gets 401, or 203 with the sign-in page.
    if !status.is_success() || status.as_u16() == 203 {
        return Err(INVALID.to_string());
    }
    let body = res.text().await.map_err(|_| INVALID.to_string())?;
    parse_connection_data(org, &body)
}

// ---- the signed-in state, kept with the other secrets (`ApiKeys`) ----

const ORG_HINT: &str = "Enter your Azure DevOps organization, like buma or https://dev.azure.com/buma";

async fn saved(keys: &ApiKeys) -> Result<Option<Saved>, String> {
    Ok(keys.get_account(ACCOUNT).await?.and_then(|raw| serde_json::from_str(&raw).ok()))
}

async fn save(keys: &ApiKeys, saved: &Saved) -> Result<DevopsStatus, String> {
    keys.set_account(ACCOUNT, serde_json::to_string(saved).map_err(|e| e.to_string())?).await?;
    Ok(DevopsStatus::signed_in(saved.profile.clone()))
}

/// The signed-in profile and the `Authorization` header to call Azure DevOps with (a PAT is Basic; a
/// Microsoft sign-in asks the Azure CLI for a fresh token). The secret never leaves Rust.
pub(crate) async fn authorization(keys: &ApiKeys) -> Result<(DevopsProfile, String), String> {
    let saved = saved(keys).await?.ok_or("Sign in to Azure DevOps first")?;
    let header = match saved.method {
        Method::Pat => basic_auth(&saved.pat),
        Method::AzureCli => {
            let az = tauri::async_runtime::spawn_blocking(|| {
                crate::infra::exec::refresh_shell_path();
                crate::infra::exec::Exec::which(&crate::infra::exec::RealExec, "az")
            })
            .await
            .map_err(|e| e.to_string())?
            .ok_or("The Azure CLI isn't installed, so the Microsoft sign-in can't be used. Sign in again with a personal access token.")?;
            let token = az_token(&az).await.ok_or("Your Microsoft sign-in expired. Sign in to Azure DevOps again.")?;
            format!("Bearer {token}")
        }
    };
    Ok((saved.profile, header))
}

/// Who is signed in, from the keychain (no network: it works offline).
pub(crate) async fn status(keys: &ApiKeys) -> Result<DevopsStatus, String> {
    Ok(saved(keys).await?.map(|s| DevopsStatus::signed_in(s.profile)).unwrap_or_else(DevopsStatus::signed_out))
}

/// Checks the token against the organization, then saves both. The token stays in Rust.
pub(crate) async fn sign_in_with_pat(keys: &ApiKeys, org: &str, pat: &str) -> Result<DevopsStatus, String> {
    let org = normalize_org(org).ok_or(ORG_HINT)?;
    let pat = pat.trim().to_string();
    if pat.is_empty() {
        return Err("Paste your personal access token".into());
    }
    let client = crate::infra::http::no_redirect_client()?;
    let profile = verify(&client, "https://dev.azure.com", &org, &pat).await?;
    save(keys, &Saved { method: Method::Pat, pat, profile }).await
}

/// Sign in with Microsoft: the Azure CLI opens Microsoft's sign-in in the browser, then the account is
/// checked against the organization. Nothing secret is saved; the Azure CLI keeps the sign-in.
pub(crate) async fn sign_in_with_microsoft(keys: &ApiKeys, org: &str) -> Result<DevopsStatus, String> {
    let org = normalize_org(org).ok_or(ORG_HINT)?;
    let az = tauri::async_runtime::spawn_blocking(|| {
        crate::infra::exec::refresh_shell_path();
        crate::infra::exec::Exec::which(&crate::infra::exec::RealExec, "az")
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or("Signing in with Microsoft needs the Azure CLI. Install it (Check your setup lists it), or use a personal access token.")?;
    let token = az_sign_in(&az).await?;
    let client = crate::infra::http::no_redirect_client()?;
    let profile = verify_bearer(&client, "https://dev.azure.com", &org, &token).await?;
    save(keys, &Saved { method: Method::AzureCli, pat: String::new(), profile }).await
}

pub(crate) async fn sign_out(keys: &ApiKeys) -> Result<DevopsStatus, String> {
    keys.delete_account(ACCOUNT).await?;
    Ok(DevopsStatus::signed_out())
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_status_says_whether_the_account_is_an_admin() {
        let profile = |email: Option<&str>| DevopsProfile { org: "buma".into(), id: "u".into(), display_name: "R".into(), email: email.map(str::to_string) };
        assert!(DevopsStatus::signed_in(profile(Some("p-rama.msugiyanto@bukitmakmur.com"))).admin);
        assert!(!DevopsStatus::signed_in(profile(Some("someone@bukitmakmur.com"))).admin);
        assert!(!DevopsStatus::signed_in(profile(None)).admin);
        let out = DevopsStatus::signed_out();
        assert!(!out.signed_in && !out.admin && out.profile.is_none());
        // The flag reaches the webview as `admin`.
        assert_eq!(serde_json::to_value(DevopsStatus::signed_in(profile(Some("p-rama.msugiyanto@bukitmakmur.com")))).unwrap()["admin"], true);
    }

    use super::*;

    #[test]
    fn organization_names_and_urls() {
        assert_eq!(normalize_org("buma").as_deref(), Some("buma"));
        assert_eq!(normalize_org(" BUMA ").as_deref(), Some("buma"));
        assert_eq!(normalize_org("https://dev.azure.com/buma/").as_deref(), Some("buma"));
        assert_eq!(normalize_org("https://dev.azure.com/buma/BUMA%20-%20Bspace/_git/x").as_deref(), Some("buma"));
        assert_eq!(normalize_org("https://buma.visualstudio.com/BUMA%20-%20Bspace%20Design%20System").as_deref(), Some("buma"));
        assert_eq!(normalize_org("my-org-2").as_deref(), Some("my-org-2"));
        assert_eq!(normalize_org(""), None);
        assert_eq!(normalize_org("evil.com"), None);
        assert_eq!(normalize_org("a b"), None);
    }

    #[test]
    fn an_older_saved_sign_in_is_a_pat() {
        let s: Saved = serde_json::from_str(r#"{"pat":"x","profile":{"org":"buma","id":"u","displayName":"R","email":null}}"#).unwrap();
        assert_eq!(s.method, Method::Pat);
        let az: Saved = serde_json::from_str(r#"{"method":"azure-cli","profile":{"org":"buma","id":"u","displayName":"R","email":null}}"#).unwrap();
        assert_eq!(az.method, Method::AzureCli);
        assert!(az.pat.is_empty());
    }

    #[test]
    fn basic_auth_has_an_empty_user() {
        assert_eq!(basic_auth("abc"), format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(":abc")));
    }

    #[test]
    fn reads_the_signed_in_user() {
        let body = r#"{"authenticatedUser":{"id":"u-1","providerDisplayName":"Rama Sugiyanto","properties":{"Account":{"$type":"System.String","$value":"rama@buma.co.id"}}}}"#;
        let p = parse_connection_data("buma", body).unwrap();
        assert_eq!(p, DevopsProfile { org: "buma".into(), id: "u-1".into(), display_name: "Rama Sugiyanto".into(), email: Some("rama@buma.co.id".into()) });
    }

    #[test]
    fn an_anonymous_user_is_not_signed_in() {
        let body = r#"{"authenticatedUser":{"id":"aad3b435-0000","providerDisplayName":"Anonymous","properties":{}}}"#;
        assert!(parse_connection_data("buma", body).is_err());
        assert!(parse_connection_data("buma", "<html>sign in</html>").is_err());
        assert!(parse_connection_data("buma", "{}").is_err());
    }

    #[tokio::test]
    async fn verify_against_a_local_server() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let good = basic_auth("good");
        std::thread::spawn(move || {
            for stream in listener.incoming().take(3) {
                let mut s = stream.unwrap();
                let mut buf = [0u8; 4096];
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let (code, body) = if req.contains("/nope/") {
                    ("404 Not Found", String::new())
                } else if req.contains(&good) {
                    ("200 OK", r#"{"authenticatedUser":{"id":"u-1","providerDisplayName":"Rama","properties":{}}}"#.to_string())
                } else {
                    ("401 Unauthorized", String::new())
                };
                let _ = write!(s, "HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        let client = reqwest::Client::new();
        assert_eq!(verify(&client, &base, "buma", "good").await.unwrap().display_name, "Rama");
        assert!(verify(&client, &base, "buma", "bad").await.unwrap_err().contains("didn't accept"));
        assert!(verify(&client, &base, "nope", "good").await.unwrap_err().contains("no Azure DevOps organization"));
    }
}
