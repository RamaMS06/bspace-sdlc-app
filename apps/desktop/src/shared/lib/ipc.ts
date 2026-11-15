import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { UserSkill } from '@bspace-sdlc-app/skills';
import type {
  AgentId,
  ApiCheck,
  ApiProvider,
  AgentInfo,
  AgentUsage,
  ChatTrace,
  Chat,
  ChatMessage,
  Job,
  MessagePart,
  ModelChoice,
  NewProject,
  Project,
  ProjectStatus,
  RecentChat,
  Settings,
  SystemInfo,
  ToolStatus,
  QuestionResponse,
} from '@bspace-sdlc-app/shared';

// ---- system and settings ----

// Your API: the user's own provider key, run on the opencode engine Buma downloads (api_engine.rs).
export interface ApiStatus {
  provider: ApiProvider | null;
  hasKey: boolean;
  engineInstalled: boolean;
}
export const apiStatus = () => invoke<ApiStatus>('api_status');
/** Lists the models at `baseUrl`, which checks the key too; no `key` checks the saved one. */
export const apiCheck = (baseUrl: string, key: string | null) => invoke<ApiCheck>('api_check', { baseUrl, key });
/** One real one-token call with `model` before saving; no `key` uses the saved one. */
export const apiTry = (baseUrl: string, key: string | null, model: string) => invoke<ApiCheck>('api_try', { baseUrl, key, model });
export const apiReachable = (baseUrl: string) => invoke<boolean>('api_reachable', { baseUrl });
/** Which voice sources have a key saved (the keys themselves never leave Rust). */
export const apiSave = (provider: ApiProvider, key: string | null) => invoke<Settings>('api_save', { provider, key });
export const apiClear = () => invoke<Settings>('api_clear');
/** Downloads the engine unless it's there; progress comes as `ENGINE_PROGRESS_EVENT`. */
export const engineInstall = () => invoke<void>('engine_install');
export const ENGINE_PROGRESS_EVENT = 'engine://progress';
export interface EngineProgress {
  done: number;
  total: number | null;
}
/** Opens the system's notification settings (macOS and Windows). */
export const openNotificationSettings = () => invoke<void>('open_notification_settings');
export const getSystemInfo = () => invoke<SystemInfo>('get_system_info');
export const detectAgents = () => invoke<AgentInfo[]>('detect_agents');
/** The tools the SDLC skills need; Figma MCP is checked in `agent`'s MCP config. */
export const checkTools = (agent?: AgentId) => invoke<ToolStatus[]>('check_tools', { agent: agent ?? null });
export const getSettings = () => invoke<Settings>('get_settings');
/** BUMA_API_URL when the app was started with it: it wins over the API address in Settings. */
export const apiUrlOverride = () => invoke<string | null>('api_url_override');
export const updateSettings = (patch: Partial<Settings>) =>
  invoke<Settings>('update_settings', { patch });
/** The operating system's preferred language (`id-ID`), or null when it can't be read. */
export const systemLocale = () => invoke<string | null>('system_locale');
export const pickFolder = () => invoke<string | null>('pick_folder');
/** Attaches a folder to a chat (its agent works there from the next session), or detaches it with null. */
export const setChatFolder = (chatId: string, folder: string | null) => invoke<Chat>('set_chat_folder', { chatId, folder });

// ---- usage ----
/** Settings › Agents › Usage: agent turns and failover lines of the last `days` days (all when omitted). */
export const agentActivity = (days?: number) => invoke<Record<string, unknown>[]>('agent_activity', { days: days ?? null });
/** Records that a chat moved to the next agent. */
export const agentFailoverRecord = (chatId: string, from: string, to: string, reason: string) =>
  invoke<void>('agent_failover_record', { chatId, from, to, reason });
export const getAgentUsage = (force: boolean) => invoke<AgentUsage[]>('get_agent_usage', { force });
export const getChatTrace = (chatId: string) => invoke<ChatTrace>('get_chat_trace', { chatId });

// ---- projects ----
export const listProjects = () => invoke<Project[]>('list_projects');
export const createProject = (input: NewProject, brief: string) =>
  invoke<Project>('create_project', { input, brief });
/** Moves a project to `status` (draft → building); it never goes back unless `reset`. */
export const setProjectStatus = (projectId: string, status: ProjectStatus, reset = false) =>
  invoke<Project>('set_project_status', { projectId, status, reset });
// ---- chats ----
export const listChats = (projectId?: string) =>
  invoke<Chat[]>('list_chats', { projectId: projectId ?? null });
/** Chats with and without a project, newest activity first; all of them without a limit. */
export const listRecentChats = (limit?: number) => invoke<RecentChat[]>('list_recent_chats', { limit: limit ?? null });
export const listArchivedChats = () => invoke<RecentChat[]>('list_archived_chats');
/** Archives or restores the thread a chat belongs to (every chat of its project). */
export const setThreadArchived = (chatId: string, archived: boolean) => invoke<void>('set_thread_archived', { chatId, archived });
/** Deletes archived chats and cards for good; projects and their videos stay. */
export const purgeArchive = () => invoke<{ chats: number; cards: number }>('purge_archive');
export const getChat =(chatId: string) => invoke<Chat | null>('get_chat', { chatId });
export const createChat = (projectId: string | null, agentId: AgentId, title: string) =>
  invoke<Chat>('create_chat', { projectId, agentId, title });
export const setChatProject = (chatId: string, projectId: string) => invoke<Chat>('set_chat_project', { chatId, projectId });
export const updateChatAgent = (chatId: string, agentId: AgentId) =>
  invoke<Chat>('update_chat_agent', { chatId, agentId });
export const listMessages = (chatId: string) => invoke<ChatMessage[]>('list_messages', { chatId });
export const addMessage = (chatId: string, role: ChatMessage['role'], parts: MessagePart[]) =>
  invoke<ChatMessage>('add_message', { chatId, role, parts });

// ---- jobs ----
export const listJobs = () => invoke<Job[]>('list_jobs');
export const upsertJob = (job: Job) => invoke<void>('upsert_job', { job });
export const deleteJob = (id: string) => invoke<void>('delete_job', { id });
export const setJobsArchived = (ids: string[], archived: boolean) => invoke<void>('set_jobs_archived', { ids, archived });

// ---- agent ----
/** Resolves true when Claude started without the Buma plugin: send it the skills as text too. */
export const agentStart = (chatId: string, agentId: AgentId, auto?: boolean) =>
  invoke<boolean>('agent_start', auto === undefined ? { chatId, agentId } : { chatId, agentId, auto });
/** Auto mode for the running session: the agent runs commands without asking. */
export const agentSetAuto = (chatId: string, on: boolean) => invoke<void>('agent_set_auto', { chatId, on });
export const agentPrompt = (chatId: string, parts: MessagePart[]) =>
  invoke<void>('agent_prompt', { chatId, parts });
export const agentCancel = (chatId: string) => invoke<void>('agent_cancel', { chatId });
/** How the agent asks before acting: every time, accepting edits, planning only, auto, or never. */
export type PermissionMode = 'ask' | 'acceptEdits' | 'plan' | 'auto' | 'bypass';
export const agentSetMode = (chatId: string, mode: PermissionMode) => invoke<void>('agent_set_mode', { chatId, mode });
export const agentStop = (chatId: string) => invoke<void>('agent_stop', { chatId });
export const agentRespondPermission = (requestId: string, optionId: string | null) =>
  invoke<void>('agent_respond_permission', { requestId, optionId });
/** Answers an agent's question (ACP elicitation). */
export const agentRespondQuestion = (requestId: string, response: QuestionResponse) =>
  invoke<void>('agent_respond_question', { requestId, response });

/** URL the webview can load for a file on disk. */
export const assetUrl = (path: string): string => convertFileSrc(path);

// ---- attachments ----
export const attachFile = (chatId: string, sourcePath: string) =>
  invoke<Extract<MessagePart, { type: 'file' }>>('attach_file', { chatId, sourcePath });

// ---- project files (the workspace) ----

/** A file or folder in a project, `path` relative to the project folder with `/` between parts. */
export interface ProjectFile {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  /** A dot file, or a dependency or build folder (or inside one). */
  dim: boolean;
}
export type ProjectFileKind = 'text' | 'image' | 'video' | 'audio' | 'binary' | 'tooLarge';
export interface ProjectFileContent {
  kind: ProjectFileKind;
  absPath: string;
  size: number;
  text: string | null;
}
/** One folder of a project ("" is the top), folders first. */
export const projectFiles = (projectId: string, dir = '') => invoke<ProjectFile[]>('project_files', { projectId, dir });
/** Files whose name contains `query`; dependency and dot folders are not searched. */
export const findProjectFiles = (projectId: string, query: string) => invoke<ProjectFile[]>('find_project_files', { projectId, query });
export const readProjectFile = (projectId: string, path: string) => invoke<ProjectFileContent>('read_project_file', { projectId, path });
/** A Word document in the project (Blueprint, FTSD) as Markdown. */
export const readProjectDocx = (projectId: string, path: string) => invoke<string>('read_project_docx', { projectId, path });
/** Opens a project's folder in the file manager. */
export const openProjectFolder = (projectId: string) => invoke<void>('open_project_folder', { projectId });

/** Where the bundled SDLC plugin is on disk (null when the app shipped without it). */
export const pluginRoot = () => invoke<string | null>('plugin_root');

// ---- agent models ----

export interface AgentModels {
  current: string | null;
  options: ModelChoice[];
}
/** The models an agent offers, read from a short session in a scratch folder; null when it reports none. */
/** Every model and version an agent can run (Claude: Anthropic's list; opencode: `opencode models`; others: none). */
export const agentModelCatalog = (agentId: AgentId) => invoke<ModelChoice[]>('agent_model_catalog', { agentId });
/** Signs in to an agent through its own browser sign-in (OAuth); resolves once the user is done. */
export const agentSignIn = (agentId: AgentId, method?: string) => invoke<void>('agent_sign_in', { agentId, method: method ?? null });
/** One account of an agent (Claude, Codex and opencode can have several). */
export interface AccountView {
  id: string;
  agent: AgentId;
  account?: string | null;
  signedIn: boolean;
  active: boolean;
}
export const accountsList = () => invoke<AccountView[]>('accounts_list');
export const accountAdd = (agentId: AgentId) => invoke<string>('account_add', { agentId });
export const accountRemove = (agentId: AgentId, id: string) => invoke<void>('account_remove', { agentId, id });
/** Signs one account out (for an agent's default account: its CLI's own sign-in on this computer). */
export const accountSignOut = (agentId: AgentId, id: string) => invoke<void>('account_sign_out', { agentId, id });
export const accountUse = (agentId: AgentId, id: string) => invoke<void>('account_use', { agentId, id });
/** Signs one account in, in the browser; resolves once it is done. */
export const accountSignIn = (agentId: AgentId, id: string) => invoke<void>('account_sign_in', { agentId, id });
/** Installs an agent's CLI with npm. */
export const agentInstall = (agentId: AgentId) => invoke<void>('agent_install', { agentId });
export const agentModels = (agentId: AgentId) => invoke<AgentModels | null>('agent_models', { agentId });
/** Picks the agent's model (null: its own default); a running session of `chatId` switches now. */
export const setAgentModel = (agentId: AgentId, model: string | null, chatId: string | null) =>
  invoke<Settings>('set_agent_model', { agentId, model, chatId });

// ---- the user's own skills (Skills screen) ----

export interface SkillDetail {
  skill: UserSkill;
  /** SKILL.md without its frontmatter. */
  body: string;
}
export const listSkills = () => invoke<UserSkill[]>('skills_list');
export const readSkill = (id: string) => invoke<SkillDetail>('skill_read', { id });
/** A new skill without `id`; otherwise saves that skill's description and instructions. */
export const saveSkill = (input: { id?: string; name: string; description: string; body: string }) =>
  invoke<UserSkill>('skill_save', { id: input.id ?? null, name: input.name, description: input.description, body: input.body });
export const setSkillEnabled = (id: string, enabled: boolean) => invoke<UserSkill>('skill_set_enabled', { id, enabled });
export const deleteSkill = (id: string) => invoke<void>('skill_delete', { id });
/** From a SKILL.md file or a folder with one. */
export const importSkill = (path: string) => invoke<UserSkill>('skill_import', { path });

/** A skill found at a GitHub link, before it's added. */
export interface FoundSkill {
  /** Its folder in the repo, '' when SKILL.md is at the top. */
  folder: string;
  name: string;
  description: string;
  /** Files the agent could run, relative to the skill's folder (the first few). */
  scripts: string[];
  scriptCount: number;
  /** Its folder on GitHub. */
  source: string;
}
export interface SkillDownload {
  id: string;
  skills: FoundSkill[];
}
export const fetchGithubSkills = (url: string) => invoke<SkillDownload>('skill_github_fetch', { url });
export const installGithubSkills = (id: string, picks: { folder: string; source: string }[]) =>
  invoke<{ added: UserSkill[]; failed: string[] }>('skill_github_install', { id, picks });
export const discardGithubSkills = (id: string) => invoke<void>('skill_github_discard', { id });
