import type { AgentId, SystemInfo, ToolId } from '@bspace-sdlc-app/shared';

/** Where Node.js comes from: agents need Node to run, so the agent can't install it. */
export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';
/** Microsoft Word comes with Microsoft 365; nothing an agent can install. */
export const WORD_DOWNLOAD_URL = 'https://www.microsoft.com/microsoft-365/word';
/** Figma's desktop app, for Linux (no package) and a Mac without Homebrew. */
export const FIGMA_DOWNLOAD_URL = 'https://www.figma.com/downloads/';
/** Flutter's install guide, when there is no package manager to install it with. */
export const FLUTTER_INSTALL_URL = 'https://docs.flutter.dev/get-started/install';
/** The Azure CLI's install guide, for Linux and a Mac without Homebrew. */
export const AZURE_CLI_INSTALL_URL = 'https://learn.microsoft.com/cli/azure/install-azure-cli';
/** Figma's remote MCP server: the one the BUMA skills need (`use_figma` draws only through it). */
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

/** A system package install. Only Linux package managers need sudo. */
function pmInstall(sys: SystemInfo, pkg: string): string {
  switch (sys.packageManager) {
    case 'brew':
      return `brew install ${pkg}`;
    case 'winget':
      return `winget install ${pkg}`;
    case 'dnf':
      return `sudo dnf install -y ${pkg}`;
    case 'pacman':
      return `sudo pacman -S --noconfirm ${pkg}`;
    default:
      return `sudo apt install -y ${pkg}`;
  }
}

/** A Mac without Homebrew. Git and Python 3 then come with the Xcode Command Line Tools. */
const macNoBrew = (sys: SystemInfo) => sys.os === 'macos' && sys.packageManager !== 'brew';

/**
 * The page the user installs a tool from themselves, when the agent can't: Node (agents run on it),
 * Word, Figma where there is no package, Flutter without a package manager. Null when the agent installs it.
 */
export function manualInstallUrl(tool: ToolId, sys: SystemInfo | null): string | null {
  if (tool === 'node') return NODE_DOWNLOAD_URL;
  if (tool === 'word') return WORD_DOWNLOAD_URL;
  if (tool === 'azure-cli' && sys && (sys.os === 'linux' || macNoBrew(sys))) return AZURE_CLI_INSTALL_URL;
  if (tool === 'figma' && sys && (sys.os === 'linux' || macNoBrew(sys))) return FIGMA_DOWNLOAD_URL;
  if (tool === 'flutter' && sys && (sys.os === 'linux' || macNoBrew(sys))) return FLUTTER_INSTALL_URL;
  return null;
}

/** Adds Figma's remote MCP server to the agent's own config, user-wide. Empty when the agent has no CLI for it. */
function figmaMcpCommands(agent: AgentId): string[] {
  switch (agent) {
    case 'claude':
      return [`claude mcp add --transport http --scope user figma ${FIGMA_MCP_URL}`];
    case 'codex':
      return [`codex mcp add figma --url ${FIGMA_MCP_URL}`];
    case 'gemini':
      return [`gemini mcp add --transport http --scope user figma ${FIGMA_MCP_URL}`];
    default:
      return [];
  }
}

export function installCommands(tool: ToolId, sys: SystemInfo, agent: AgentId): string[] {
  if (tool === 'figma-mcp') return figmaMcpCommands(agent);
  return commandsFor(tool, sys);
}

function commandsFor(tool: ToolId, sys: SystemInfo): string[] {
  const pm = sys.packageManager;
  const windows = pm === 'winget' || sys.os === 'windows';
  switch (tool) {
    case 'node':
      if (pm === 'brew') return ['brew install node'];
      if (windows) return ['winget install --id OpenJS.NodeJS.LTS -e'];
      return [pmInstall(sys, 'nodejs')];
    case 'git':
      if (pm === 'brew') return ['brew install git'];
      if (windows) return ['winget install --id Git.Git -e'];
      if (sys.os === 'macos') return ['xcode-select --install'];
      return [pmInstall(sys, 'git')];
    case 'python':
      if (pm === 'brew') return ['brew install python@3.12'];
      if (windows) return ['winget install --id Python.Python.3.12 -e'];
      if (sys.os === 'macos') return ['xcode-select --install'];
      return [pmInstall(sys, 'python3')];
    case 'azure-cli':
      if (pm === 'brew') return ['brew install azure-cli'];
      if (windows) return ['winget install --id Microsoft.AzureCLI -e'];
      return []; // the user follows AZURE_CLI_INSTALL_URL
    case 'figma':
      if (pm === 'brew') return ['brew install --cask figma'];
      if (windows) return ['winget install --id Figma.Figma -e'];
      return []; // the user downloads it from FIGMA_DOWNLOAD_URL
    case 'flutter':
      if (pm === 'brew') return ['brew install --cask flutter'];
      if (windows) return ['winget install --id Google.Flutter -e'];
      return []; // the user follows FLUTTER_INSTALL_URL
    default:
      return [];
  }
}

/** True when this install can only go through the system package manager with sudo. */
export function needsSudo(tool: ToolId, sys: SystemInfo): boolean {
  return commandsFor(tool, sys).some((c) => c.startsWith('sudo '));
}

const VERIFY: Record<ToolId, string> = {
  node: '`node --version`',
  git: '`git --version`',
  python: '`python3 --version` (or `python --version` on Windows)',
  'figma-mcp': 'the agent\'s MCP list (for Claude Code: `claude mcp list`) showing a server named figma',
  figma: 'that the Figma app is installed',
  flutter: '`flutter --version`',
  'azure-cli': '`az version`',
  word: 'that Microsoft Word is installed',
};

const NAMES: Record<ToolId, string> = {
  node: 'Node.js 20 or newer',
  git: 'Git',
  python: 'Python 3',
  'figma-mcp': `the Figma MCP server (${FIGMA_MCP_URL})`,
  figma: 'the Figma desktop app',
  flutter: 'the Flutter SDK',
  'azure-cli': 'the Azure CLI',
  word: 'Microsoft Word',
};

export function buildInstallPrompt(tool: ToolId, sys: SystemInfo, agent: AgentId): string {
  const lines: string[] = [];
  const run = (cmds: string[]) => lines.push(...cmds.map((c) => `  ${c}`));
  if (tool === 'figma-mcp') {
    lines.push(`Please add ${NAMES[tool]} to your MCP configuration for this user, named "figma", over HTTP.`);
    const cmds = figmaMcpCommands(agent);
    if (cmds.length) {
      lines.push('Run:');
      run(cmds);
    } else {
      lines.push(`Add a remote MCP server named figma with the URL ${FIGMA_MCP_URL} to your MCP config file.`);
    }
    lines.push('Signing in to Figma happens in the browser the first time a Figma tool is used; do not start it now.');
    lines.push(`Then verify with ${VERIFY[tool]} and reply with only "figma added".`);
    return lines.join('\n');
  }
  lines.push(`Please install ${NAMES[tool]} on this computer (${sys.os} ${sys.osVersion}).`);
  if (needsSudo(tool, sys)) {
    // A sudo password prompt can't be answered from inside the agent.
    lines.push('This needs the system package manager with sudo. Do not run sudo yourself.');
    lines.push('Ask the user to run this command in their own terminal, then check that it worked:');
  } else {
    lines.push('Run:');
  }
  run(commandsFor(tool, sys));
  if (tool === 'flutter') lines.push('The BUMA Design System pins Flutter 3.27.4: if fvm is available, also run `fvm install 3.27.4`.');
  lines.push(`Then verify with ${VERIFY[tool]} and reply with only the version you see.`);
  return lines.join('\n');
}
