//! Keeps the SDLC plugin in step with `main` of BUMA's own repo (`bspace-sdlc-skills` on Azure DevOps): the
//! version there is the latest one. The app reads the plugin's `plugin.json` on `main` (a small call, with
//! the signed-in Azure DevOps account), says when it is higher than the version in use, and on a click
//! downloads that folder and installs it like an installed plugin of the same name (which replaces the
//! bundled one). Anyone signed in can sync: the source is fixed, so it is not an arbitrary install.

use crate::domain::plugins;
use crate::domain::share::urlencode;
use serde::Serialize;
use std::cmp::Ordering;
use std::path::Path;

/// The plugin that is kept in step.
pub const PLUGIN_NAME: &str = "bspace-sdlc-skills";
const PROJECT: &str = "BUMA - Bspace Design System";
const REPO: &str = "bspace-sdlc-skills";
const BRANCH: &str = "main";
const PLUGIN_PATH: &str = "/plugins/bspace-sdlc-skills";
/// The largest download accepted.
const MAX_ZIP: usize = 60 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Source {
    /// `https://dev.azure.com`, or a local address in tests.
    pub base: String,
    pub org: String,
}

impl Source {
    pub fn company(org: &str) -> Self {
        Self { base: "https://dev.azure.com".into(), org: org.to_string() }
    }

    fn items(&self, query: &str) -> String {
        format!(
            "{}/{}/{}/_apis/git/repositories/{}/items?{}&versionDescriptor.version={}&versionDescriptor.versionType=branch&api-version=7.1",
            self.base.trim_end_matches('/'),
            self.org,
            urlencode(PROJECT),
            REPO,
            query,
            BRANCH
        )
    }
}

/// What `main` has: the plugin's version and the commit it is at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// The version in use on this computer.
    pub current: Option<String>,
    /// The version on `main`.
    pub latest: Option<String>,
    pub commit: String,
    /// `main` is ahead of what is in use.
    pub newer: bool,
}

/// `1.0.9` against `1.0.10`: numbers part by part; a pre-release is below its release; none is lowest.
pub fn compare_versions(a: Option<&str>, b: Option<&str>) -> Ordering {
    let (Some(a), Some(b)) = (a, b) else { return a.is_some().cmp(&b.is_some()) };
    let parse = |v: &str| {
        let v = v.trim_start_matches(['v', 'V']);
        let (main, pre) = v.split_once('-').map_or((v, None), |(m, p)| (m, Some(p)));
        (main.split('.').map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>(), pre.map(str::to_string))
    };
    let ((x, xp), (y, yp)) = (parse(a), parse(b));
    for i in 0..x.len().max(y.len()) {
        match x.get(i).unwrap_or(&0).cmp(y.get(i).unwrap_or(&0)) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    match (xp, yp) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(p), Some(q)) => p.cmp(&q),
    }
}

async fn get(client: &reqwest::Client, url: &str, auth: &str, accept: &str) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .header("Authorization", auth)
        .header("Accept", accept)
        .send()
        .await
        .map_err(|_| "Can't reach Azure DevOps. Check your internet connection and try again.".to_string())?;
    let status = res.status().as_u16();
    let bytes = res.bytes().await.map_err(|_| "The download was cut off".to_string())?;
    match status {
        200..=299 => Ok(bytes.to_vec()),
        401 | 403 => Err("Azure DevOps didn't allow reading the plugin repo. Check that you can open it in Azure DevOps.".into()),
        404 => Err("The plugin repo or its main branch wasn't found in your Azure DevOps organization.".into()),
        s => Err(format!("Azure DevOps answered {s}")),
    }
}

/// The version `main` has, and the commit it is at.
pub async fn latest(src: &Source, auth: &str) -> Result<(Option<String>, String), String> {
    let client = crate::infra::http::no_redirect_client()?;
    let url = src.items(&format!("path={}/.claude-plugin/plugin.json&includeContent=true", urlencode(PLUGIN_PATH).replace("%2F", "/")));
    let body = get(&client, &url, auth, "application/json").await?;
    let item: serde_json::Value = serde_json::from_slice(&body).map_err(|_| "Azure DevOps sent something unexpected".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(item["content"].as_str().unwrap_or("")).map_err(|_| "The plugin on main has no readable plugin.json".to_string())?;
    if manifest["name"].as_str() != Some(PLUGIN_NAME) {
        return Err("The plugin on main isn't bspace-sdlc-skills".into());
    }
    Ok((manifest["version"].as_str().map(str::to_string), item["commitId"].as_str().unwrap_or_default().to_string()))
}

/// The version in use: an installed copy of the plugin, else the bundled one.
pub fn in_use(root: &Path, bundled: Option<&Path>) -> Option<String> {
    plugins::list(root, bundled).into_iter().find(|p| p.name == PLUGIN_NAME && !p.replaced).and_then(|p| p.version)
}

pub async fn check(src: &Source, auth: &str, current: Option<String>) -> Result<SyncStatus, String> {
    let (latest, commit) = latest(src, auth).await?;
    let newer = compare_versions(latest.as_deref(), current.as_deref()) == Ordering::Greater;
    Ok(SyncStatus { current, latest, commit, newer })
}

/// Installs the plugin from a downloaded zip of its folder, if it is the plugin and `expect` is its version.
pub fn install_zip(root: &Path, zip: &[u8], expect: Option<&str>) -> Result<(), String> {
    std::fs::create_dir_all(root.join(".staging")).map_err(|e| e.to_string())?;
    let tmp = root.join(".staging").join(format!("sync-{}.zip", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, zip).map_err(|e| e.to_string())?;
    let staged = plugins::stage_zip(root, &tmp.to_string_lossy());
    let _ = std::fs::remove_file(&tmp);
    let staged = staged?;
    let ok = staged.plugins.iter().any(|p| p.name == PLUGIN_NAME && p.version.as_deref() == expect);
    if !ok || staged.plugins.len() != 1 {
        let _ = plugins::discard(root, &staged.id);
        return Err("What was downloaded isn't the plugin version that main announced. Try again in a minute.".into());
    }
    plugins::commit(root, &staged.id).map(|_| ())
}

/// Downloads `main`'s plugin folder and installs it when it is ahead of what is in use.
pub async fn apply(src: &Source, auth: &str, root: &Path, bundled: Option<&Path>) -> Result<SyncStatus, String> {
    let status = check(src, auth, in_use(root, bundled)).await?;
    if !status.newer {
        return Ok(status);
    }
    let client = crate::infra::http::no_redirect_client()?;
    let url = src.items(&format!("scopePath={}&recursionLevel=full&download=true&%24format=zip", urlencode(PLUGIN_PATH).replace("%2F", "/")));
    let zip = get(&client, &url, auth, "application/zip").await?;
    if zip.len() > MAX_ZIP {
        return Err("The plugin download is too big".into());
    }
    let (root, expect) = (root.to_path_buf(), status.latest.clone());
    tokio::task::spawn_blocking(move || install_zip(&root, &zip, expect.as_deref())).await.map_err(|e| e.to_string())??;
    Ok(SyncStatus { current: status.latest.clone(), newer: false, ..status })
}

#[cfg(test)]
mod real {
    use super::*;

    /// Against the real company repo, read only, into a temp folder:
    /// `BUMA_AZ_TOKEN=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv) cargo test real_sync -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "needs an Azure DevOps token in BUMA_AZ_TOKEN"]
    async fn real_sync() {
        let auth = format!("Bearer {}", std::env::var("BUMA_AZ_TOKEN").expect("BUMA_AZ_TOKEN"));
        let src = Source::company("buma");
        let (version, commit) = latest(&src, &auth).await.unwrap();
        println!("main has {version:?} at {commit}");
        let dir = tempfile::tempdir().unwrap();
        let root = plugins::root(dir.path()).unwrap();
        // Pretend an older version is in use: it should be offered, downloaded and installed.
        let status = check(&src, &auth, Some("0.0.1".into())).await.unwrap();
        assert!(status.newer);
        let done = apply(&src, &auth, &root, None).await.unwrap();
        println!("applied: {done:?}");
        let list = plugins::list(&root, None);
        println!("installed: {:?} with {} skills", list[0].version, list[0].skills.len());
        assert_eq!(list[0].name, PLUGIN_NAME);
        assert!(list[0].skills.iter().any(|s| s.id == "using-bspace-sdlc"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::fake;
    use std::io::Write;

    fn plugin_json(version: &str, name: &str) -> String {
        format!(r#"{{"name":"{name}","description":"d","version":"{version}"}}"#)
    }

    fn zip_of(version: &str, name: &str) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            // Azure DevOps puts the folder's own name first.
            z.start_file("bspace-sdlc-skills/.claude-plugin/plugin.json", opts).unwrap();
            z.write_all(plugin_json(version, name).as_bytes()).unwrap();
            z.start_file("bspace-sdlc-skills/skills/using-bspace-sdlc/SKILL.md", opts).unwrap();
            z.write_all(b"---\nname: using-bspace-sdlc\ndescription: entry\n---\n# Entry\n").unwrap();
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    fn src(base: &str) -> Source {
        Source { base: base.trim_end_matches("/api").to_string() + "/api", org: "buma".into() }
    }

    #[test]
    fn versions_compare_as_numbers() {
        use Ordering::*;
        assert_eq!(compare_versions(Some("1.0.10"), Some("1.0.9")), Greater);
        assert_eq!(compare_versions(Some("1.0.8"), Some("1.0.8")), Equal);
        assert_eq!(compare_versions(Some("v1.1"), Some("1.0.9")), Greater);
        assert_eq!(compare_versions(Some("1.1.0-beta"), Some("1.1.0")), Less);
        assert_eq!(compare_versions(Some("1.0.0"), None), Greater);
        assert_eq!(compare_versions(None, Some("1.0.0")), Less);
        assert_eq!(compare_versions(None, None), Equal);
    }

    #[tokio::test]
    async fn reads_main_and_says_when_it_is_ahead_of_what_is_in_use() {
        let f = fake(|req, _| {
            assert!(req.path.contains("/buma/BUMA%20-%20Bspace%20Design%20System/_apis/git/repositories/bspace-sdlc-skills/items"), "{}", req.path);
            assert!(req.path.contains("path=/plugins/bspace-sdlc-skills/.claude-plugin/plugin.json") && req.path.contains("versionDescriptor.version=main"), "{}", req.path);
            (200, serde_json::json!({"commitId": "abc123", "content": plugin_json("1.0.9", "bspace-sdlc-skills")}).to_string())
        })
        .await;
        let s = src(&f.base);
        let ahead = check(&s, "Basic x", Some("1.0.8".into())).await.unwrap();
        assert_eq!((ahead.latest.as_deref(), ahead.commit.as_str(), ahead.newer), (Some("1.0.9"), "abc123", true));
        // Equal and behind are not updates (main being older than this app's own copy is fine).
        assert!(!check(&s, "Basic x", Some("1.0.9".into())).await.unwrap().newer);
        assert!(!check(&s, "Basic x", Some("1.1.0".into())).await.unwrap().newer);
        assert_eq!(f.hits.lock().unwrap()[0].auth.as_deref(), Some("Basic x"));
    }

    #[tokio::test]
    async fn says_why_main_can_not_be_read() {
        let f = fake(|_, _| (404, "{}".into())).await;
        assert!(check(&src(&f.base), "a", None).await.unwrap_err().contains("wasn't found"));
        let f = fake(|_, _| (403, "{}".into())).await;
        assert!(check(&src(&f.base), "a", None).await.unwrap_err().contains("didn't allow"));
        let f = fake(|_, _| (200, serde_json::json!({"content": plugin_json("1.0.0", "other")}).to_string())).await;
        assert!(check(&src(&f.base), "a", None).await.unwrap_err().contains("isn't bspace-sdlc-skills"));
    }

    #[test]
    fn installs_the_downloaded_plugin_over_the_bundled_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = plugins::root(dir.path()).unwrap();
        let bundled = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(bundled.path().join(".claude-plugin")).unwrap();
        std::fs::write(bundled.path().join(".claude-plugin/plugin.json"), plugin_json("1.0.8", "bspace-sdlc-skills")).unwrap();
        assert_eq!(in_use(&root, Some(bundled.path())).as_deref(), Some("1.0.8"));
        install_zip(&root, &zip_of("1.0.9", "bspace-sdlc-skills"), Some("1.0.9")).unwrap();
        // The installed copy is what is in use now, and the bundled one is set aside.
        assert_eq!(in_use(&root, Some(bundled.path())).as_deref(), Some("1.0.9"));
        let list = plugins::list(&root, Some(bundled.path()));
        assert!(list.iter().find(|p| p.source == "bundled").unwrap().replaced);
        assert!(root.join("bspace-sdlc-skills/skills/using-bspace-sdlc/SKILL.md").is_file());
        assert!(!root.join(".staging").read_dir().unwrap().any(|e| e.unwrap().file_name().to_string_lossy().starts_with("sync-")), "the temp zip is gone");
    }

    #[test]
    fn refuses_a_download_that_is_not_the_announced_version_or_plugin() {
        let dir = tempfile::tempdir().unwrap();
        let root = plugins::root(dir.path()).unwrap();
        assert!(install_zip(&root, &zip_of("1.0.7", "bspace-sdlc-skills"), Some("1.0.9")).unwrap_err().contains("isn't the plugin version"));
        assert!(install_zip(&root, &zip_of("1.0.9", "other"), Some("1.0.9")).is_err());
        assert!(install_zip(&root, b"not a zip", Some("1.0.9")).is_err());
        assert!(!root.join("bspace-sdlc-skills").exists(), "nothing was installed");
    }
}
