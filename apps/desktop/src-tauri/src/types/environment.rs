//! This computer: OS, package manager and the tools the SDLC skills need.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OsKind {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Brew,
    Winget,
    Apt,
    Dnf,
    Pacman,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: OsKind,
    pub os_version: String,
    pub package_manager: Option<PackageManager>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolId {
    #[serde(rename = "node")]
    Node,
    #[serde(rename = "git")]
    Git,
    #[serde(rename = "python")]
    Python,
    #[serde(rename = "figma-mcp")]
    FigmaMcp,
    #[serde(rename = "figma")]
    Figma,
    #[serde(rename = "flutter")]
    Flutter,
    #[serde(rename = "word")]
    Word,
    #[serde(rename = "azure-cli")]
    AzureCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: ToolId,
    pub name: String,
    pub required: bool,
    pub found: bool,
    pub version: Option<String>,
    pub ok: bool,
    pub detail: String,
}
