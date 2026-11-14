//! Sharing a feature with other people. A feature is its folder (intent/, sdlc/, specs/, the brief…), and
//! its workflow progress is read from those files, so sharing the folder shares the progress. The folder
//! goes to its own Azure DevOps Git repo, and inviting someone gives them access to that repo only:
//!
//! - a **viewer** can read it (the app opens it read-only), a **contributor** can also push to it;
//! - the access is Azure DevOps' own permission on the repo, so it holds whatever app is used;
//! - what was shared and who was invited is kept in the folder (`.bspace/share.json`), so it travels with it.
//!
//! The Azure DevOps address is a seam (`Hosts`): tests point it at a local server.

use crate::infra::exec;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Azure DevOps' security namespace for Git repositories.
pub const GIT_NAMESPACE: &str = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";
/// Git permission bits: read; and what a contributor adds (push, branches, tags, notes, pull requests).
pub const READ: u64 = 2;
pub const CONTRIBUTE: u64 = READ | 4 | 16 | 32 | 64 | 16384;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Contributor,
}

impl Role {
    pub fn bits(self) -> u64 {
        match self {
            Role::Viewer => READ,
            Role::Contributor => CONTRIBUTE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub email: String,
    pub role: Role,
    pub at: String,
    /// The person's identity in Azure DevOps (what the permission was given to).
    pub descriptor: String,
}

/// What a shared feature is: where it lives and who was invited. Kept in the feature's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub org: String,
    pub project: String,
    pub project_id: String,
    pub repo_id: String,
    pub repo_name: String,
    pub web_url: String,
    pub remote_url: String,
    #[serde(default)]
    pub invites: Vec<Invite>,
}

pub fn info_path(folder: &Path) -> PathBuf {
    folder.join(".bspace").join("share.json")
}

pub fn load(folder: &Path) -> Option<ShareInfo> {
    serde_json::from_str(&std::fs::read_to_string(info_path(folder)).ok()?).ok()
}

pub fn save(folder: &Path, info: &ShareInfo) -> Result<(), String> {
    let path = info_path(folder);
    std::fs::create_dir_all(path.parent().unwrap_or(folder)).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_string_pretty(info).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// The three Azure DevOps hosts the calls go to (organization, identities, licenses).
#[derive(Debug, Clone)]
pub struct Hosts {
    pub dev: String,
    pub vssps: String,
    pub aex: String,
}

impl Hosts {
    pub fn real() -> Self {
        Self { dev: "https://dev.azure.com".into(), vssps: "https://vssps.dev.azure.com".into(), aex: "https://vsaex.dev.azure.com".into() }
    }
    /// All three at one address, for tests.
    pub fn at(base: &str) -> Self {
        let b = base.trim_end_matches('/').to_string();
        Self { dev: b.clone(), vssps: b.clone(), aex: b }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub remote_url: String,
    pub web_url: String,
}

/// A signed-in call to Azure DevOps for one organization.
pub struct Azure {
    http: reqwest::Client,
    hosts: Hosts,
    org: String,
    /// The whole `Authorization` header value (Basic for a PAT, Bearer for a Microsoft sign-in).
    auth: String,
}

const DENIED: &str = "Azure DevOps didn't allow that. You need permission to create repositories and manage who can read them in this project.";

fn message_of(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body).ok()?.get("message")?.as_str().map(|m| m.trim().to_string()).filter(|m| !m.is_empty())
}

impl Azure {
    pub fn new(hosts: Hosts, org: &str, auth: String) -> Result<Self, String> {
        Ok(Self { http: crate::infra::http::no_redirect_client()?, hosts, org: org.to_string(), auth })
    }

    pub fn authorization(&self) -> &str {
        &self.auth
    }

    async fn call(&self, method: reqwest::Method, url: &str, body: Option<Value>) -> Result<(u16, String), String> {
        let mut req = self.http.request(method, url).header("Authorization", &self.auth).header("Accept", "application/json");
        if let Some(b) = body {
            req = req.header("Content-Type", "application/json").body(b.to_string());
        }
        let res = req.send().await.map_err(|_| "Can't reach Azure DevOps. Check your internet connection and try again.".to_string())?;
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        Ok((status, text))
    }

    /// Ok(body) for a 2xx; otherwise the reason in words.
    fn ok(status: u16, body: String) -> Result<String, String> {
        match status {
            200..=299 => Ok(body),
            401 | 403 => Err(DENIED.to_string()),
            s => Err(message_of(&body).unwrap_or_else(|| format!("Azure DevOps answered {s}"))),
        }
    }

    /// The organization's projects, for picking where a feature's repo goes.
    pub async fn projects(&self) -> Result<Vec<AzProject>, String> {
        let url = format!("{}/{}/_apis/projects?api-version=7.1&$top=200", self.hosts.dev, self.org);
        let (s, b) = self.call(reqwest::Method::GET, &url, None).await?;
        let v: Value = serde_json::from_str(&Self::ok(s, b)?).map_err(|_| "Azure DevOps sent something unexpected".to_string())?;
        Ok(v["value"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| Some(AzProject { id: p["id"].as_str()?.to_string(), name: p["name"].as_str()?.to_string() }))
            .collect())
    }

    fn repo_of(v: &Value) -> Option<Repo> {
        Some(Repo {
            id: v["id"].as_str()?.to_string(),
            name: v["name"].as_str()?.to_string(),
            remote_url: v["remoteUrl"].as_str()?.to_string(),
            web_url: v["webUrl"].as_str().unwrap_or_default().to_string(),
        })
    }

    /// The repo called `name` in the project: made when it isn't there yet.
    pub async fn ensure_repo(&self, project_id: &str, name: &str) -> Result<Repo, String> {
        let base = format!("{}/{}/{}/_apis/git/repositories", self.hosts.dev, self.org, project_id);
        let (s, b) = self.call(reqwest::Method::POST, &format!("{base}?api-version=7.1"), Some(json!({ "name": name }))).await?;
        let body = if s == 409 {
            // It exists already (a feature shared before): use it.
            let (s2, b2) = self.call(reqwest::Method::GET, &format!("{base}/{name}?api-version=7.1"), None).await?;
            Self::ok(s2, b2)?
        } else {
            Self::ok(s, b)?
        };
        let v: Value = serde_json::from_str(&body).map_err(|_| "Azure DevOps sent something unexpected".to_string())?;
        Self::repo_of(&v).ok_or_else(|| "Azure DevOps sent something unexpected".to_string())
    }

    /// Adds the person to the organization (Basic access, which can open repos), which sends them
    /// Azure DevOps' invitation email. Needs an organization admin; `Err` says why it didn't.
    pub async fn add_to_org(&self, email: &str) -> Result<(), String> {
        let url = format!("{}/{}/_apis/userentitlements?api-version=7.1-preview.3", self.hosts.aex, self.org);
        let body = json!({ "accessLevel": { "accountLicenseType": "express" }, "user": { "principalName": email, "subjectKind": "user" } });
        let (s, b) = self.call(reqwest::Method::POST, &url, Some(body)).await?;
        Self::ok(s, b).map(|_| ())
    }

    /// The person's identity (what permissions are given to), by email; None when Azure DevOps doesn't know them.
    pub async fn identity(&self, email: &str) -> Result<Option<String>, String> {
        let url = format!(
            "{}/{}/_apis/identities?searchFilter=MailAddress&filterValue={}&queryMembership=None&api-version=7.1-preview.1",
            self.hosts.vssps,
            self.org,
            urlencode(email)
        );
        let (s, b) = self.call(reqwest::Method::GET, &url, None).await?;
        let v: Value = serde_json::from_str(&Self::ok(s, b)?).map_err(|_| "Azure DevOps sent something unexpected".to_string())?;
        Ok(v["value"].as_array().and_then(|a| a.first()).and_then(|i| i["descriptor"].as_str()).map(str::to_string))
    }

    fn token(project_id: &str, repo_id: &str) -> String {
        format!("repoV2/{project_id}/{repo_id}")
    }

    /// Gives the identity `role` on the repo (and nothing more: only this repo's permission is touched).
    pub async fn grant(&self, project_id: &str, repo_id: &str, descriptor: &str, role: Role) -> Result<(), String> {
        let url = format!("{}/{}/_apis/accesscontrolentries/{}?api-version=7.1", self.hosts.dev, self.org, GIT_NAMESPACE);
        let body = json!({
            "token": Self::token(project_id, repo_id),
            "merge": true,
            "accessControlEntries": [{ "descriptor": descriptor, "allow": role.bits(), "deny": 0, "extendedInfo": {} }],
        });
        let (s, b) = self.call(reqwest::Method::POST, &url, Some(body)).await?;
        Self::ok(s, b).map(|_| ())
    }

    /// Takes the identity's permission on the repo away.
    pub async fn revoke(&self, project_id: &str, repo_id: &str, descriptor: &str) -> Result<(), String> {
        let url = format!(
            "{}/{}/_apis/accesscontrolentries/{}?token={}&descriptors={}&api-version=7.1",
            self.hosts.dev,
            self.org,
            GIT_NAMESPACE,
            urlencode(&Self::token(project_id, repo_id)),
            urlencode(descriptor)
        );
        let (s, b) = self.call(reqwest::Method::DELETE, &url, None).await?;
        Self::ok(s, b).map(|_| ())
    }
}

/// Percent-encodes everything but unreserved characters.
pub fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

// ---------------------------------------------------------------------------------------------------
// The folder, as a Git repo.
// ---------------------------------------------------------------------------------------------------

const GITIGNORE: &str = "node_modules/\nbuild/\n.dart_tool/\n.gradle/\n.DS_Store\n*.log\n.env\n.env.*\n";

/// Who the commits are by: the signed-in account.
pub struct Author {
    pub name: String,
    pub email: String,
}

async fn git(folder: &Path, args: &[&str], auth: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(folder)
        .env("PATH", exec::augmented_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(header) = auth {
        // The credential goes in the environment (not the arguments, which anyone can read in the process list).
        cmd.env("GIT_CONFIG_COUNT", "1").env("GIT_CONFIG_KEY_0", "http.extraheader").env("GIT_CONFIG_VALUE_0", format!("Authorization: {header}"));
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| "Git took too long".to_string())?
        .map_err(|e| format!("Couldn't run git: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        return Ok(text);
    }
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    // Never repeat a credential, whatever git printed.
    let clean: String = err.lines().filter(|l| !l.to_lowercase().contains("authorization")).collect::<Vec<_>>().join(" ");
    Err(format!("git {}: {}", args.first().unwrap_or(&""), clean.trim()))
}

/// Makes the folder a Git repo (when it isn't one), commits what changed and pushes it to `remote_url`
/// as the `bspace` remote, on `main`.
pub async fn push_folder(folder: &Path, remote_url: &str, auth: &str, author: &Author) -> Result<(), String> {
    if !folder.join(".git").exists() {
        git(folder, &["init", "-b", "main"], None).await?;
    }
    if !folder.join(".gitignore").exists() {
        std::fs::write(folder.join(".gitignore"), GITIGNORE).map_err(|e| e.to_string())?;
    }
    git(folder, &["add", "-A"], None).await?;
    let (name, email) = (format!("user.name={}", author.name), format!("user.email={}", author.email));
    // Nothing to commit is fine.
    let changed = !git(folder, &["status", "--porcelain"], None).await?.trim().is_empty();
    if changed {
        git(folder, &["-c", &name, "-c", &email, "commit", "-m", "Share this feature from BSpace SDLC"], None).await?;
    }
    let remotes = git(folder, &["remote"], None).await?;
    if remotes.lines().any(|r| r.trim() == "bspace") {
        git(folder, &["remote", "set-url", "bspace", remote_url], None).await?;
    } else {
        git(folder, &["remote", "add", "bspace", remote_url], None).await?;
    }
    git(folder, &["push", "-u", "bspace", "HEAD:main"], Some(auth)).await.map(|_| ())
}

// ---------------------------------------------------------------------------------------------------
// Inviting.
// ---------------------------------------------------------------------------------------------------

/// What happened besides the access itself, to say to the inviter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteResult {
    pub info: ShareInfo,
    /// Azure DevOps added the person to the organization (and so emailed them its invitation).
    pub added_to_org: bool,
    /// Why they were not added, when they were not (an organization admin has to add them).
    pub org_note: Option<String>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A repo name from the feature's title or folder name: letters, digits, dashes.
pub fn repo_name(folder: &Path, title: &str) -> String {
    let from = folder.file_name().and_then(|n| n.to_str()).filter(|n| !n.is_empty()).unwrap_or(title);
    let clean: String = from.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' }).collect();
    let clean = clean.trim_matches('-').to_string();
    if clean.is_empty() { "feature".into() } else { clean }
}

fn valid_email(email: &str) -> bool {
    let e = email.trim();
    e.len() >= 5 && e.contains('@') && !e.starts_with('@') && !e.ends_with('@') && !e.contains(' ')
}

/// Shares the feature's folder (the first time: makes its repo in `project`) and gives `email` `role` on it.
pub async fn invite(az: &Azure, org: &str, folder: &Path, title: &str, project: Option<&AzProject>, author: &Author, email: &str, role: Role) -> Result<InviteResult, String> {
    let email = email.trim().to_lowercase();
    if !valid_email(&email) {
        return Err("Enter the person's email address".into());
    }
    let mut info = match load(folder) {
        Some(i) => i,
        None => {
            let project = project.ok_or("Pick the Azure DevOps project for this feature's repo")?;
            let repo = az.ensure_repo(&project.id, &repo_name(folder, title)).await?;
            ShareInfo {
                org: org.to_string(),
                project: project.name.clone(),
                project_id: project.id.clone(),
                repo_id: repo.id,
                repo_name: repo.name,
                web_url: repo.web_url,
                remote_url: repo.remote_url,
                invites: Vec::new(),
            }
        }
    };
    save(folder, &info)?;
    push_folder(folder, &info.remote_url, az.authorization(), author).await?;

    // The person has to be in the organization first, or Azure DevOps doesn't know the email yet.
    let (added_to_org, org_note) = match az.add_to_org(&email).await {
        Ok(()) => (true, None),
        Err(e) => (false, Some(e)),
    };
    let descriptor = az.identity(&email).await?.ok_or_else(|| {
        "Azure DevOps doesn't know that email yet. Ask an organization admin to add them to the organization, then invite again.".to_string()
    })?;
    az.grant(&info.project_id, &info.repo_id, &descriptor, role).await?;

    info.invites.retain(|i| i.email != email);
    info.invites.push(Invite { email, role, at: now(), descriptor });
    save(folder, &info)?;
    // The invite list travels with the folder.
    push_folder(folder, &info.remote_url, az.authorization(), author).await?;
    Ok(InviteResult { info, added_to_org, org_note })
}

/// Takes `email`'s access to the feature away.
pub async fn revoke(az: &Azure, folder: &Path, author: &Author, email: &str) -> Result<ShareInfo, String> {
    let email = email.trim().to_lowercase();
    let mut info = load(folder).ok_or("This feature isn't shared")?;
    let invite = info.invites.iter().find(|i| i.email == email).cloned().ok_or("That person wasn't invited")?;
    az.revoke(&info.project_id, &info.repo_id, &invite.descriptor).await?;
    info.invites.retain(|i| i.email != email);
    save(folder, &info)?;
    push_folder(folder, &info.remote_url, az.authorization(), author).await?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::fake;

    fn author() -> Author {
        Author { name: "Rama".into(), email: "p-rama.msugiyanto@bukitmakmur.com".into() }
    }

    /// A bare repo on disk standing in for the Azure DevOps repo.
    fn bare() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote.git");
        let ok = std::process::Command::new("git").args(["init", "--bare", "-b", "main"]).arg(&path).output().unwrap().status.success();
        assert!(ok, "git is needed for these tests");
        let url = format!("file://{}", path.display());
        (dir, url)
    }

    fn azure_for(remote: String) -> impl Fn(&crate::test_support::Req, usize) -> (u16, String) + Send + Sync + 'static {
        move |req, _| {
            let path = req.path.split('?').next().unwrap_or("");
            match (req.method.as_str(), path) {
                ("GET", "/api/buma/_apis/projects") => (200, r#"{"value":[{"id":"p-1","name":"BUMA Bspace"},{"id":"p-2","name":"Other"}]}"#.into()),
                ("POST", "/api/buma/p-1/_apis/git/repositories") => (201, format!(r#"{{"id":"r-1","name":"attendance","remoteUrl":"{remote}","webUrl":"https://dev.azure.com/buma/x/_git/attendance"}}"#)),
                ("POST", "/api/buma/_apis/userentitlements") => (200, r#"{"isSuccess":true}"#.into()),
                ("GET", "/api/buma/_apis/identities") => {
                    if req.path.contains("nobody%40") {
                        (200, r#"{"value":[]}"#.into())
                    } else {
                        (200, r#"{"value":[{"descriptor":"aad.AAA","providerDisplayName":"Dewi"}]}"#.into())
                    }
                }
                ("POST", p) if p.starts_with("/api/buma/_apis/accesscontrolentries/") => (200, "{}".into()),
                ("DELETE", p) if p.starts_with("/api/buma/_apis/accesscontrolentries/") => (200, "true".into()),
                _ => (404, r#"{"message":"no route"}"#.into()),
            }
        }
    }

    fn folder() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("attendance");
        std::fs::create_dir_all(f.join("intent")).unwrap();
        std::fs::write(f.join("AGENTS.md"), "# Attendance\n").unwrap();
        std::fs::write(f.join("intent/intent.md"), "Status: approved\n").unwrap();
        dir
    }

    #[test]
    fn roles_are_azure_devops_git_permission_bits() {
        assert_eq!(Role::Viewer.bits(), 2);
        // Read, contribute, create branch and tag, manage notes, pull request contribute: nothing to administer or delete.
        assert_eq!(Role::Contributor.bits(), 2 | 4 | 16 | 32 | 64 | 16384);
        assert_eq!(Role::Contributor.bits() & (1 | 512 | 8192), 0);
        assert_eq!(urlencode("a b@c.d"), "a%20b%40c.d");
        assert_eq!(repo_name(Path::new("/w/attendance-hr"), "x"), "attendance-hr");
        assert_eq!(repo_name(Path::new("/"), "My feature!"), "My-feature");
    }

    #[tokio::test]
    async fn lists_projects_with_the_signed_in_account() {
        let (_g, remote) = bare();
        let f = fake(azure_for(remote)).await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let p = az.projects().await.unwrap();
        assert_eq!(p.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["BUMA Bspace", "Other"]);
        assert_eq!(f.hits("/api/buma/_apis/projects?api-version=7.1&$top=200")[0].auth.as_deref(), Some("Basic abc"));
    }

    #[tokio::test]
    async fn inviting_shares_the_folder_in_a_repo_and_gives_that_repo_only_the_role() {
        let (_g, remote) = bare();
        let f = fake(azure_for(remote.clone())).await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let dir = folder();
        let folder = dir.path().join("attendance");
        let project = AzProject { id: "p-1".into(), name: "BUMA Bspace".into() };
        let r = invite(&az, "buma", &folder, "Attendance", Some(&project), &author(), " Dewi@BukitMakmur.com ", Role::Viewer).await.unwrap();
        assert!(r.added_to_org && r.org_note.is_none());
        assert_eq!(r.info.repo_id, "r-1");
        assert_eq!(r.info.invites.len(), 1);
        assert_eq!(r.info.invites[0].email, "dewi@bukitmakmur.com");
        assert_eq!(r.info.invites[0].role, Role::Viewer);
        // The permission went on this repo's token only, as read only.
        let ace = f.hits.lock().unwrap().iter().find(|h| h.path.starts_with("/api/buma/_apis/accesscontrolentries/")).cloned().unwrap();
        let body: Value = serde_json::from_str(&ace.body).unwrap();
        assert!(ace.path.contains(GIT_NAMESPACE));
        assert_eq!(body["token"], "repoV2/p-1/r-1");
        assert_eq!(body["accessControlEntries"][0]["allow"], 2);
        assert_eq!(body["accessControlEntries"][0]["descriptor"], "aad.AAA");
        // The folder and the invite list reached the repo.
        let clone = tempfile::tempdir().unwrap();
        let ok = std::process::Command::new("git").args(["clone", &remote]).arg(clone.path().join("c")).output().unwrap().status.success();
        assert!(ok);
        assert!(clone.path().join("c/intent/intent.md").is_file());
        let shared: ShareInfo = serde_json::from_str(&std::fs::read_to_string(clone.path().join("c/.bspace/share.json")).unwrap()).unwrap();
        assert_eq!(shared.invites[0].email, "dewi@bukitmakmur.com");
        // The password never went anywhere git wrote down.
        assert!(!std::fs::read_to_string(folder.join(".git/config")).unwrap().contains("Basic abc"));
        assert_eq!(load(&folder).unwrap(), r.info);
    }

    #[tokio::test]
    async fn a_second_invite_reuses_the_repo_and_a_changed_role_replaces_the_first() {
        let (_g, remote) = bare();
        let f = fake(azure_for(remote)).await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let dir = folder();
        let folder = dir.path().join("attendance");
        let project = AzProject { id: "p-1".into(), name: "BUMA Bspace".into() };
        invite(&az, "buma", &folder, "Attendance", Some(&project), &author(), "dewi@bukitmakmur.com", Role::Viewer).await.unwrap();
        // No project needed any more: the feature is shared.
        let r = invite(&az, "buma", &folder, "Attendance", None, &author(), "dewi@bukitmakmur.com", Role::Contributor).await.unwrap();
        assert_eq!(r.info.invites.len(), 1);
        assert_eq!(r.info.invites[0].role, Role::Contributor);
        assert_eq!(f.hits.lock().unwrap().iter().filter(|h| h.method == "POST" && h.path.starts_with("/api/buma/p-1/_apis/git/repositories")).count(), 1);
    }

    #[tokio::test]
    async fn without_a_project_a_new_share_asks_for_one_and_a_bad_email_is_refused() {
        let (_g, remote) = bare();
        let f = fake(azure_for(remote)).await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let dir = folder();
        let folder = dir.path().join("attendance");
        assert!(invite(&az, "buma", &folder, "A", None, &author(), "dewi@bukitmakmur.com", Role::Viewer).await.unwrap_err().contains("Pick the Azure DevOps project"));
        let project = AzProject { id: "p-1".into(), name: "BUMA Bspace".into() };
        assert!(invite(&az, "buma", &folder, "A", Some(&project), &author(), "not an email", Role::Viewer).await.unwrap_err().contains("email"));
        assert!(load(&folder).is_none(), "nothing is shared after a refused invite");
    }

    #[tokio::test]
    async fn when_the_person_cannot_be_added_to_the_organization_it_says_so_and_still_grants_if_known() {
        let (_g, remote) = bare();
        let f = fake(move |req, n| {
            if req.path.starts_with("/api/buma/_apis/userentitlements") {
                return (403, "{}".into());
            }
            azure_for(remote.clone())(req, n)
        })
        .await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let dir = folder();
        let folder = dir.path().join("attendance");
        let project = AzProject { id: "p-1".into(), name: "BUMA Bspace".into() };
        let r = invite(&az, "buma", &folder, "A", Some(&project), &author(), "dewi@bukitmakmur.com", Role::Viewer).await.unwrap();
        assert!(!r.added_to_org);
        assert!(r.org_note.unwrap().contains("permission"));
        // An email Azure DevOps doesn't know at all can't be given anything.
        let e = invite(&az, "buma", &folder, "A", None, &author(), "nobody@bukitmakmur.com", Role::Viewer).await.unwrap_err();
        assert!(e.contains("doesn't know that email"), "{e}");
        assert_eq!(load(&folder).unwrap().invites.len(), 1);
    }

    #[tokio::test]
    async fn revoking_takes_the_permission_away_and_forgets_the_invite() {
        let (_g, remote) = bare();
        let f = fake(azure_for(remote)).await;
        let az = Azure::new(Hosts::at(&f.base), "buma", "Basic abc".into()).unwrap();
        let dir = folder();
        let folder = dir.path().join("attendance");
        let project = AzProject { id: "p-1".into(), name: "BUMA Bspace".into() };
        invite(&az, "buma", &folder, "A", Some(&project), &author(), "dewi@bukitmakmur.com", Role::Viewer).await.unwrap();
        let info = revoke(&az, &folder, &author(), "Dewi@bukitmakmur.com").await.unwrap();
        assert!(info.invites.is_empty());
        let del = f.hits.lock().unwrap().iter().find(|h| h.method == "DELETE").cloned().unwrap();
        assert!(del.path.contains("token=repoV2%2Fp-1%2Fr-1") && del.path.contains("descriptors=aad.AAA"), "{}", del.path);
        assert!(revoke(&az, &folder, &author(), "dewi@bukitmakmur.com").await.unwrap_err().contains("wasn't invited"));
    }
}
