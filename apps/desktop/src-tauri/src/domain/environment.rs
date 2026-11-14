//! What is on this computer: the OS, its package manager and the tools the SDLC skills need.

use crate::infra::exec::{home_dir, Exec};
use crate::types::*;
use std::path::{Path, PathBuf};

/// First `\d+(\.\d+)+` match in `raw`.
pub fn parse_version(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i;
        let mut groups = 1;
        loop {
            while end < b.len() && b[end].is_ascii_digit() {
                end += 1;
            }
            if end + 1 < b.len() && b[end] == b'.' && b[end + 1].is_ascii_digit() {
                groups += 1;
                end += 1;
            } else {
                break;
            }
        }
        if groups > 1 {
            return Some(raw[start..end].to_string());
        }
        i = end;
    }
    None
}

fn os_kind() -> OsKind {
    if cfg!(target_os = "macos") {
        OsKind::Macos
    } else if cfg!(target_os = "windows") {
        OsKind::Windows
    } else {
        OsKind::Linux
    }
}

fn os_version(exec: &dyn Exec, os: OsKind) -> String {
    match os {
        OsKind::Macos => exec
            .run("sw_vers", &["-productVersion"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        OsKind::Windows => exec
            .run("cmd", &["/c", "ver"])
            .and_then(|s| parse_version(&s))
            .unwrap_or_default(),
        OsKind::Linux => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                let get = |key: &str| {
                    text.lines().find_map(|l| {
                        l.strip_prefix(key)
                            .and_then(|v| v.strip_prefix('='))
                            .map(|v| v.trim().trim_matches('"').to_string())
                    })
                };
                get("PRETTY_NAME").or_else(|| get("VERSION_ID"))
            })
            .unwrap_or_default(),
    }
}

pub fn system_info(exec: &dyn Exec) -> SystemInfo {
    let os = os_kind();
    let managers: &[(&str, PackageManager)] = match os {
        OsKind::Macos => &[("brew", PackageManager::Brew)],
        OsKind::Windows => &[("winget", PackageManager::Winget)],
        OsKind::Linux => &[
            ("apt", PackageManager::Apt),
            ("dnf", PackageManager::Dnf),
            ("pacman", PackageManager::Pacman),
        ],
    };
    let package_manager = managers
        .iter()
        .find(|(bin, _)| exec.which(bin).is_some())
        .map(|(_, pm)| *pm);
    SystemInfo { os, os_version: os_version(exec, os), package_manager }
}

/// Whether an app is installed: macOS looks in /Applications, Windows under Program Files and the
/// user's AppData. Linux has no desktop Figma or Word.
fn app_installed(os: OsKind, mac_app: &str, windows_rel: &[&str]) -> bool {
    match os {
        OsKind::Macos => {
            Path::new("/Applications").join(mac_app).exists()
                || home_dir().is_some_and(|h| h.join("Applications").join(mac_app).exists())
        }
        OsKind::Windows => ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
            .iter()
            .filter_map(std::env::var_os)
            .any(|base| windows_rel.iter().any(|rel| PathBuf::from(&base).join(rel).exists())),
        OsKind::Linux => false,
    }
}

/// The MCP config files an agent reads, in the order it reads them. Claude is Buma's own config folder
/// (`CLAUDE_CONFIG_DIR`); the others use their CLI's usual files.
pub fn mcp_config_files(agent: AgentId, claude_dir: Option<&Path>) -> Vec<PathBuf> {
    let home = home_dir().unwrap_or_default();
    match agent {
        AgentId::Claude => claude_dir.map(|d| vec![d.join(".claude.json"), d.join("settings.json")]).unwrap_or_default(),
        AgentId::Codex => vec![home.join(".codex").join("config.toml")],
        AgentId::Gemini => vec![home.join(".gemini").join("settings.json")],
        AgentId::Antigravity => vec![home.join(".gemini").join("antigravity").join("mcp_config.json")],
        AgentId::Cursor => vec![home.join(".cursor").join("mcp.json")],
        AgentId::Opencode | AgentId::Custom => vec![
            home.join(".config").join("opencode").join("opencode.json"),
            home.join(".config").join("opencode").join("opencode.jsonc"),
        ],
    }
}

/// Whether any of the agent's MCP config files names a Figma server (`mcp.figma.com`, the desktop
/// server on 127.0.0.1:3845, or a server called figma).
pub fn figma_mcp_configured(files: &[PathBuf]) -> bool {
    files.iter().filter_map(|f| std::fs::read_to_string(f).ok()).any(|text| {
        let t = text.to_lowercase();
        t.contains("mcp.figma.com") || t.contains("127.0.0.1:3845") || t.contains("\"figma\"") || t.contains("mcp_servers.figma")
    })
}

/// The tools the BSpace SDLC skills need. `mcp_files` are the default agent's MCP config files.
pub fn check_tools(exec: &dyn Exec, mcp_files: &[PathBuf]) -> Vec<ToolStatus> {
    let version_of = |bin: &str, arg: &str| -> Option<String> {
        exec.which(bin)?;
        exec.run(bin, &[arg]).and_then(|s| parse_version(&s))
    };
    let os = os_kind();

    let node_found = exec.which("node").is_some();
    let node_version = version_of("node", "--version");
    let node_major = node_version
        .as_deref()
        .and_then(|v| v.split('.').next())
        .and_then(|m| m.parse::<u32>().ok());
    let node = ToolStatus {
        id: ToolId::Node,
        name: "Node.js".into(),
        required: true,
        found: node_found,
        version: node_version,
        // buma-cli declares node >= 20; Claude Code and the ACP adapters need 18 or newer.
        ok: node_major.is_some_and(|m| m >= 20),
        detail: "Runs the agent adapters and buma-cli · needs 20 or newer".into(),
    };

    let git_version = version_of("git", "--version");
    let git = ToolStatus {
        id: ToolId::Git,
        name: "Git".into(),
        required: true,
        found: exec.which("git").is_some(),
        ok: exec.which("git").is_some(),
        version: git_version,
        detail: "Clones the project and the BUMA Design System packages".into(),
    };

    // python3 everywhere; Windows installs often only have `python` or the `py` launcher.
    let python_bin = ["python3", "python", "py"].into_iter().find(|b| {
        exec.which(b).is_some() && exec.run(b, &["--version"]).is_some_and(|v| v.contains("Python 3"))
    });
    let python = ToolStatus {
        id: ToolId::Python,
        name: "Python 3".into(),
        required: true,
        found: python_bin.is_some(),
        ok: python_bin.is_some(),
        version: python_bin.and_then(|b| version_of(b, "--version")),
        detail: "Runs the skills' gate checks (Blueprint, FTSD, wireframe, fidelity)".into(),
    };

    let figma_mcp_ok = figma_mcp_configured(mcp_files);
    let figma_mcp = ToolStatus {
        id: ToolId::FigmaMcp,
        name: "Figma MCP".into(),
        required: true,
        found: figma_mcp_ok,
        ok: figma_mcp_ok,
        version: None,
        detail: "Lets the agent read and draw Figma designs with the BUMA Design System".into(),
    };

    let figma_ok = app_installed(os, "Figma.app", &[r"Figma\Figma.exe", r"Figma\app\Figma.exe"]);
    let figma = ToolStatus {
        id: ToolId::Figma,
        name: "Figma".into(),
        required: false,
        found: figma_ok,
        ok: figma_ok,
        version: None,
        detail: "Review the designs and prototypes the agent makes".into(),
    };

    let flutter_bin = ["flutter", "fvm"].into_iter().find(|b| exec.which(b).is_some());
    let flutter = ToolStatus {
        id: ToolId::Flutter,
        name: "Flutter SDK".into(),
        required: false,
        found: flutter_bin.is_some(),
        ok: flutter_bin.is_some(),
        version: version_of("flutter", "--version"),
        detail: "Slices and runs Flutter screens · BUMA pins 3.27.4 with fvm".into(),
    };

    let word_ok = app_installed(
        os,
        "Microsoft Word.app",
        &[r"Microsoft Office\root\Office16\WINWORD.EXE", r"Microsoft Office\Office16\WINWORD.EXE"],
    );
    let word = ToolStatus {
        id: ToolId::Word,
        name: "Microsoft Word".into(),
        required: false,
        found: word_ok,
        ok: word_ok,
        version: None,
        detail: "Edit and sign off the Blueprint and FTSD documents".into(),
    };

    let az_found = exec.which("az").is_some();
    let azure_cli = ToolStatus {
        id: ToolId::AzureCli,
        name: "Azure CLI".into(),
        required: false,
        found: az_found,
        ok: az_found,
        version: if az_found { exec.run("az", &["version", "--query", "\"azure-cli\"", "-o", "tsv"]).and_then(|s| parse_version(&s)) } else { None },
        detail: "Sign in to Azure DevOps with your Microsoft account".into(),
    };

    vec![node, git, python, figma_mcp, azure_cli, figma, flutter, word]
}

/// The operating system's preferred language, like `id-ID` or `en-US`. The webview's own
/// `navigator.language` follows the app bundle (English only), not the system, so the first-run
/// interface language is picked from this instead.
pub(crate) fn locale() -> Option<String> {
    clean_locale(sys_locale::get_locale())
}

fn clean_locale(raw: Option<String>) -> Option<String> {
    raw.map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && !is_posix_default(l))
}

/// `C`, `POSIX` and values like `C.UTF-8` mean "no language chosen", not a language.
fn is_posix_default(l: &str) -> bool {
    ["C", "POSIX"].iter().any(|p| {
        l.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '@', '_', '-']))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::FakeExec;

    #[test]
    fn locale_is_trimmed_and_blank_is_none() {
        assert_eq!(clean_locale(Some(" id-ID ".into())), Some("id-ID".into()));
        assert_eq!(clean_locale(Some("  ".into())), None);
        assert_eq!(clean_locale(None), None);
        for unknown in ["C", "POSIX", "C.UTF-8", "POSIX.UTF-8", " C "] {
            assert_eq!(clean_locale(Some(unknown.into())), None, "{unknown}");
        }
        assert_eq!(clean_locale(Some("ca-ES".into())), Some("ca-ES".into()));
        assert_eq!(clean_locale(Some("Czech".into())), Some("Czech".into()));
    }

    #[test]
    fn system_locale_never_panics_and_is_none_or_text() {
        assert!(locale().is_none_or(|l| !l.is_empty()));
    }

    #[test]
    fn parse_version_cases() {
        assert_eq!(parse_version("v22.12.0").as_deref(), Some("22.12.0"));
        assert_eq!(parse_version("ffmpeg version n7.1-tessus").as_deref(), Some("7.1"));
        assert_eq!(
            parse_version("ffmpeg version 7.1.1-full_build-www.gyan.dev").as_deref(),
            Some("7.1.1")
        );
        assert_eq!(parse_version("2026.10.22").as_deref(), Some("2026.10.22"));
        assert_eq!(parse_version("nope"), None);
        assert_eq!(parse_version("build 7 then 1.2"), Some("1.2".to_string()));
    }

    fn tool(list: &[ToolStatus], id: ToolId) -> &ToolStatus {
        list.iter().find(|t| t.id == id).unwrap()
    }

    #[test]
    fn old_node_is_not_ok() {
        let ex = FakeExec::default().with("node", "v18.19.0");
        let t = check_tools(&ex, &[]);
        let n = tool(&t, ToolId::Node);
        assert!(n.found && !n.ok && n.required);
        assert_eq!(n.version.as_deref(), Some("18.19.0"));
    }

    #[test]
    fn new_node_is_ok() {
        let ex = FakeExec::default().with("node", "v20.20.2");
        let t = check_tools(&ex, &[]);
        assert!(tool(&t, ToolId::Node).ok);
    }

    #[test]
    fn sdlc_tools_required_and_recommended() {
        let ex = FakeExec::default().with("git", "git version 2.47.1").with("python3", "Python 3.12.4");
        let t = check_tools(&ex, &[]);
        assert_eq!(t.len(), 8);
        assert!(!tool(&t, ToolId::AzureCli).required);
        let git = tool(&t, ToolId::Git);
        assert!(git.ok && git.required);
        assert_eq!(git.version.as_deref(), Some("2.47.1"));
        let py = tool(&t, ToolId::Python);
        assert!(py.ok && py.required);
        assert_eq!(py.version.as_deref(), Some("3.12.4"));
        let mcp = tool(&t, ToolId::FigmaMcp);
        assert!(!mcp.ok && mcp.required);
        assert!(!tool(&t, ToolId::Flutter).required && !tool(&t, ToolId::Flutter).found);
        assert!(!tool(&t, ToolId::Word).required);
    }

    #[test]
    fn python_2_does_not_count() {
        let ex = FakeExec::default().with("python", "Python 2.7.18");
        assert!(!tool(&check_tools(&ex, &[]), ToolId::Python).found);
    }

    #[test]
    fn figma_mcp_is_found_in_the_agent_config() {
        let tmp = tempfile::tempdir().unwrap();
        let claude = tmp.path().join(".claude.json");
        std::fs::write(&claude, r#"{"mcpServers":{"other":{"type":"http","url":"https://example.com"}}}"#).unwrap();
        assert!(!figma_mcp_configured(&[claude.clone()]));
        std::fs::write(&claude, r#"{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"}}}"#).unwrap();
        assert!(figma_mcp_configured(&[claude.clone()]));
        let codex = tmp.path().join("config.toml");
        std::fs::write(&codex, "[mcp_servers.figma]\nurl = \"https://mcp.figma.com/mcp\"\n").unwrap();
        assert!(figma_mcp_configured(&[tmp.path().join("missing.json"), codex]));
        let ex = FakeExec::default();
        assert!(tool(&check_tools(&ex, &[claude]), ToolId::FigmaMcp).ok);
    }

    #[test]
    fn package_manager_first_found() {
        let ex = FakeExec::default().with("brew", "x").with("dnf", "x").with("apt", "x");
        let s = system_info(&ex);
        if cfg!(target_os = "linux") {
            assert_eq!(s.package_manager, Some(PackageManager::Apt));
        } else if cfg!(target_os = "macos") {
            assert_eq!(s.package_manager, Some(PackageManager::Brew));
        }
    }
}
