export type AgentId = 'claude' | 'opencode' | 'gemini' | 'codex' | 'antigravity' | 'cursor' | 'custom';

export interface AgentInfo {
  id: AgentId;
  name: string;
  installed: boolean;
  version: string | null;
  acpCommand: string[];
  recommended: boolean;
  /** The agent's own sign-in is saved on this computer (Claude: see the Claude account instead). */
  signedIn?: boolean;
  /** Who is signed in (an email, or what the key is for). */
  account?: string;
}

export type OsKind = 'macos' | 'windows' | 'linux';
export type PackageManager = 'brew' | 'winget' | 'apt' | 'dnf' | 'pacman';

export interface SystemInfo {
  os: OsKind;
  osVersion: string;
  packageManager: PackageManager | null;
}

/** What the BSpace SDLC skills need on this computer (see check_tools in src-tauri/src/system.rs). */
export type ToolId = 'node' | 'git' | 'python' | 'figma-mcp' | 'azure-cli' | 'figma' | 'flutter' | 'word';

export interface ToolStatus {
  id: ToolId;
  name: string;
  required: boolean;
  found: boolean;
  version: string | null;
  ok: boolean;
  detail: string;
}

/** Language of Buma's own interface. */
export type UiLanguage = 'en' | 'id';
/** Where a feature stands: a draft is ideating; one whose chat edited files or ran commands is being built. */
export type ProjectStatus = 'draft' | 'building';

/** A feature: its own folder (where the skills write intent/, sdlc/, specs/) and its chats. */
export interface Project {
  id: string;
  title: string;
  slug: string;
  folder: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewProject {
  title: string;
}

export interface Chat {
  id: string;
  projectId: string | null;
  agentId: AgentId;
  title: string;
  createdAt: string;
  /** A folder the user attached to the chat: its agent works there. */
  folder?: string | null;
}

/** A chat in the sidebar's Recent list. */
export interface RecentChat extends Chat {
  projectTitle: string | null;
  /** The newest message's time, or the chat's own when it has none (RFC 3339). */
  activeAt: string;
  /** When the thread was archived (RFC 3339); only in the archive's list. */
  archivedAt?: string;
}

/** What an agent says a tool call is (ACP tool kinds). */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

/** One bar in a chat's trace. A turn's tokens add up its calls; a tool has tokens only if it ran a subagent. */
export interface TraceSpan {
  id: string;
  parentId: string | null;
  kind: 'turn' | 'llm' | 'tool';
  /** The model of a model call, the tool of a tool call; empty for a turn. */
  name: string;
  /** What a turn was asked or a tool call was for. */
  detail: string | null;
  startMs: number;
  endMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  failed: boolean;
  /** A tool call with no result yet: still running, or cut off. */
  open: boolean;
}

/** GET a chat's trace: only Claude Code's session files have one. */
export interface ChatTrace {
  spans: TraceSpan[];
  supported: boolean;
  costUsd: number | null;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'mention'; projectId: string; title: string }
  | {
      type: 'file';
      path: string;
      name: string;
      mime: string;
      size: number;
      /** When the file was last written (an image the agent made): a rewritten one reloads. */
      modifiedAt?: string;
    }
  | {
      type: 'tool';
      toolCallId: string;
      title: string;
      status: 'pending' | 'running' | 'done' | 'failed';
      toolKind?: ToolKind;
      /** The first file the tool touches. */
      path?: string;
    }
  | { type: 'thought'; text: string }
  | { type: 'a2ui'; surfaceId: string; messages: unknown[] }
  | { type: 'a2ui-action'; summary: string; action: object };

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'agent' | 'system';
  parts: MessagePart[];
  createdAt: string;
}

/** A card on the Workflow board: a feature chat's turns. */
export type JobKind = 'build';
export type JobStatus = 'queued' | 'working' | 'needs-you' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  projectId: string | null;
  chatId: string | null;
  agentId: AgentId;
  status: JobStatus;
  progress: number | null;
  note: string | null;
  updatedAt: string;
  /** When the card was archived off the board (RFC 3339); a card whose status changes comes back. */
  archivedAt?: string | null;
}

export interface Settings {
  workingFolder: string;
  defaultAgent: AgentId;
  onboarded: boolean;
  /** Base URL of the optional Buma API. Settings saves an empty field as the default URL. */
  apiUrl: string;
  /** Random uuid v4 made on first run (empty until then); never derived from the machine. */
  installId: string;
  /** Sends the anonymous daily install ping. */
  shareInstallStats: boolean;
  /** RFC 3339 time of the last successful ping. */
  lastPingAt: string | null;
  /** Chats start in auto mode: the agent runs commands without asking. */
  autoMode: boolean;
  /** Interface language; null until the first run picks one from the system language. */
  uiLanguage: UiLanguage | null;
  /** Closing the window hides it to the tray (menu bar) instead of quitting. */
  backgroundMode: boolean;
  /** Start Buma at login; only available while backgroundMode is on. */
  openAtLogin: boolean;
  /** The model picked for each agent (agent id → the agent's own model value); missing: its default. */
  agentModels: Partial<Record<AgentId, string>>;
  /** "Your API" (the `custom` agent): provider preset, address and model. The key stays in the keychain. */
  apiProvider?: ApiProvider | null;
}

/** A provider preset: `other` is any OpenAI-compatible address the user types. */
export type ApiProviderId = 'deepseek' | '9router' | 'commandcode' | 'other';

export interface ApiProvider {
  provider: ApiProviderId;
  baseUrl: string;
  model: string;
  /** Every model the key can use, offered in the chat's model menu. */
  models?: string[];
}

/** Why checking an API key failed. */
export type ApiFailure = 'unauthorized' | 'noBalance' | 'upgradeRequired' | 'unreachable' | 'notFound' | 'other';

/** The answer of `api_check`: the models the key can use, or why it can't. */
export interface ApiCheck {
  ok: boolean;
  models: string[];
  failure: ApiFailure | null;
  detail: string | null;
}

/** Defaults; workingFolder is `<home>/Buma`, resolved at runtime. */
export const DEFAULT_SETTINGS: Omit<Settings, 'workingFolder'> = {
  defaultAgent: 'claude',
  onboarded: false,
  apiUrl: 'https://bspace.buma.internal/api',
  installId: '',
  shareInstallStats: true,
  lastPingAt: null,
  autoMode: false,
  uiLanguage: null,
  backgroundMode: false,
  openAtLogin: false,
  agentModels: {},
};

export type AgentUpdate =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool';
      toolCallId: string;
      title: string;
      status: 'pending' | 'running' | 'done' | 'failed';
      toolKind?: ToolKind;
      path?: string;
    }
  | { kind: 'done'; stopReason: string }
  | { kind: 'error'; message: string }
  /** The models the agent offers for this session and the one in use. */
  | { kind: 'models'; current: string | null; options: ModelChoice[] };

/** One model an agent offers: `value` is what the agent is told, `name` what the user reads. */
export interface ModelChoice {
  value: string;
  name: string;
  description?: string;
}

/** A question the agent asks the user (ACP `elicitation/create`, form mode). */
export interface AgentQuestion {
  chatId: string;
  requestId: string;
  message: string;
  /** JSON Schema of the answer: `properties` with options (`oneOf`), multi-select arrays, text. */
  schema: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}

/** The answer to an AgentQuestion. */
export type QuestionResponse =
  | { action: 'accept'; content: Record<string, string | number | boolean | string[]> }
  | { action: 'decline' }
  | { action: 'cancel' };

export interface PermissionRequest {
  chatId: string;
  requestId: string;
  title: string;
  commands: string[];
  options: {
    id: string;
    label: string;
    kind: 'allow-once' | 'allow-always' | 'reject-once' | 'reject-always';
  }[];
}

export interface UsageWindow {
  usedPercent: number;
  resetsAt: string | null;
}

export type UsageStatus = 'ok' | 'signed-out' | 'unavailable' | 'error';

export interface AgentUsage {
  agentId: AgentId;
  status: UsageStatus;
  /** The 5 hour window. */
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  /** A model-scoped weekly limit, such as Fable. */
  modelWeekly: { label: string; window: UsageWindow } | null;
  updatedAt: string;
  message: string | null;
  /** For agents without plan limits (opencode): what they used today and over the last 7 days. */
  spend?: { today: Spend; week: Spend };
  /** Which account of the agent these numbers are for (`default` or an extra account's id). */
  accountId?: string;
  /** Who is signed in to it (an email), when known. */
  account?: string;
}

/** Replies, tokens (input, output and reasoning; cached reads left out) and cost over a period. */
export interface Spend {
  replies: number;
  tokens: number;
  costUsd: number;
}
