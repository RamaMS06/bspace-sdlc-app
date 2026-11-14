import { notifyAgent } from '@/lib/agentNotify';
import { create } from 'zustand';
import { FOREGROUND_RULE, buildSessionPreamble, languageHint, sessionFacts, userSkillsText } from '@bspace-sdlc-app/skills';
import type { AgentId, AgentQuestion, AgentUpdate, Chat, ChatMessage, JobStatus, MessagePart, PermissionRequest, QuestionResponse } from '@bspace-sdlc-app/shared';
import {
  addMessage,
  agentCancel,
  agentFailoverRecord,
  setAgentModel,
  agentRespondPermission,
  agentRespondQuestion,
  agentPrompt,
  agentSetAuto,
  agentSetMode,
  type PermissionMode,
  agentStart,
  listSkills,
  agentStop,
  getChat,
  listMessages,
  updateChatAgent,
  upsertJob,
} from '@/lib/ipc';
import { onAgentUpdate, onPermission, onQuestion } from '@/lib/events';
import { extractA2ui } from '@/a2ui/parse';
import { agentErrorText, AGENT_NAMES } from '@/lib/agents';
import { i18n, uiLanguage } from '@/i18n';
import { stored } from '@/lib/stored';
import { advanceProject, isWorkTool, resetProjectStatus } from '@/lib/projectStatus';
import { localClock } from '@/lib/time';
import { useApp } from '@/state/app';
import { refreshJobs } from '@/state/jobs';
import { failoverReason, stepKey, useFailover, type Step } from '@/state/failover';
import { DEFAULT_ACCOUNT, MULTI_ACCOUNT, useAccounts } from '@/state/accounts';
import { applyStep, stepFor } from '@/lib/route';


/** A project chat's turns show up on the Workflow board as this build job. */
export interface ChatJob {
  projectId: string;
  title: string;
}

/** A message waiting for the agent's turn to end. */
export interface QueuedMessage {
  id: string;
  parts: MessagePart[];
  opts?: SendOpts;
}

export interface SendOpts {
  /** Sent by the queue after a turn ended: never queued again. */
  fromQueue?: boolean;
  /** What the agent receives instead of the visible message (extra context, a stage's skill). */
  promptParts?: MessagePart[];
  /** Track this chat's turns as a `build` job. */
  job?: ChatJob;
  /** The chat's own agent; defaults to the agent picked in Settings. */
  agentId?: AgentId;
  /** Leave the composer's attachments where they are (a message Buma sends on the user's behalf). */
  keepAttachments?: boolean;
  /** Sent again after a failover: the user's message is already in the chat, so it is not added twice. */
  resend?: boolean;
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, boolean>;
  /** When each chat's running turn started (ms since the epoch); gone once it ends. */
  turnStartedAt: Record<string, number>;
  /** Open permission requests per chat, oldest first. The card shows the head. */
  permissions: Record<string, PermissionRequest[]>;
  /** The agent's open questions per chat (ACP elicitation), oldest first. */
  questions: Record<string, AgentQuestion[]>;
  attachments: Record<string, MessagePart[]>;
  /** Chats whose agent session was started in this app session. */
  started: Record<string, boolean>;
  /** Per-chat Auto toggle (in memory). Chats without an entry follow Settings. */
  auto: Record<string, boolean>;
  /** The toggle on a new chat that has no id yet. */
  pendingAuto: boolean | null;
  /** Chats whose Auto switch is being applied to the running session. */
  autoBusy: Record<string, boolean>;
  /** Per-chat permission mode beyond Ask / Auto (accept edits, plan, bypass). Chats without one follow `auto`. */
  mode: Record<string, PermissionMode>;
  /** The mode on a new chat that has no id yet. */
  pendingMode: PermissionMode | null;
  /** Messages the user sent while the agent was still working, oldest first; they go as one message when its turn ends. */
  queued: Record<string, QueuedMessage[]>;
  /** Takes a queued message back out before it is sent. */
  unqueue(chatId: string, id: string): void;
  /** Chat rows seen in this app session, so a screen knows a chat's project before asking Rust. */
  rows: Record<string, Chat>;
  /** Unsent composer text per chat; `new` is the New chat screen's, which has no chat yet. */
  drafts: Record<string, Draft>;

  /** Turns auto mode on or off; a running session switches right away. */
  setAuto(chatId: string | null, on: boolean): Promise<void>;
  /** Sets the permission mode; a running session switches right away. */
  setMode(chatId: string | null, mode: PermissionMode): Promise<void>;
  /** Kills the chat's agent process: for a turn that doesn't stop when asked. */
  terminate(chatId: string): Promise<void>;
  rememberChat(chat: Chat): void;
  setDraft(key: string, draft: Draft): void;
  /** A new chat just got its id: it takes over the draft's Auto choice. */
  adoptPendingAuto(chatId: string): void;
  load(chatId: string): Promise<void>;
  /** Resolves to an error message when the agent could not be reached, otherwise null. */
  send(chatId: string, parts: MessagePart[], opts?: SendOpts): Promise<string | null>;
  respondPermission(chatId: string, optionId: string | null): Promise<void>;
  /** Answers the chat's oldest open question; `summary` (what was picked) goes into the chat as the user's line. */
  respondQuestion(chatId: string, response: QuestionResponse, summary: string): Promise<void>;
  /** Stops the running turn; it ends with done (cancelled). */
  cancel(chatId: string): Promise<void>;
  /** Ends the chat's agent process; the next send starts a new one. */
  stop(chatId: string): Promise<void>;
  /**
   * Ends the chat's agent process (a route step that rests). The chat stays as it is; the next message
   * starts a new session that gets a recap of the chat first.
   */
  retire(chatId: string): Promise<void>;
  /** Moves the chat to another agent; it starts fresh on the next send. */
  switchAgent(chatId: string, agent: AgentId): Promise<void>;
  /**
   * Adds a system line to the chat and stores it; resolves once it is stored (best effort). `extra` parts
   * are stored with it but not drawn as text.
   */
  appendSystem(chatId: string, text: string, extra?: MessagePart[]): Promise<void>;
  /** A system line shown in the live chat only, never stored (like the busy note). */
  notice(chatId: string, text: string): void;
  attach(chatId: string, part: MessagePart): void;
  detach(chatId: string, index: number): void;
  listen(): void;
  reset(): void;
}

/** What the composer holds before it is sent. */
export interface Draft {
  text: string;
}

export const EMPTY_DRAFT: Draft = { text: '' };

/** The draft key of the New chat screen, which has no chat id yet. */
export const NEW_CHAT_DRAFT = 'new';

const isLocal = (m: ChatMessage) => m.id.startsWith('local-');

/** The agent chat that has no chat row: the setup installs. */
export const isScratchChat = (chatId: string) => chatId === 'setup';

/** The session that never shows A2UI (the setup installs): no skills preamble. Same rule as Rust. */
export const isInternalChat = (chatId: string) => chatId === 'setup';

/** Chats this store loaded or sent to; updates for any other chat id are not ours. */
const tracked = new Set<string>();
/** The agent each chat last started with, for error copy. */
const chatAgent = new Map<string, AgentId>();
/** Project chats whose turns are tracked as a build job. */
const chatJobs = new Map<string, ChatJob>();

/** Stored message id → the local id it had before it was stored, so the list keeps its React key. */
const clientKeys = new Map<string, string>();
/** A key for a message that stays the same when the local copy is swapped for the stored one. */
export const messageKey = (m: ChatMessage) => clientKeys.get(m.id) ?? m.id;

/** Recaps waiting for the first prompt of a new session: after an agent switch, or a retired session. */
const pendingRecap = new Map<string, { text: string; switched: boolean }>();

/** A route step as people read it: "Claude Code · claude-opus-5-5". */
const stepName = (s: Step) => (s.model ? `${AGENT_NAMES[s.agent]} · ${s.model}` : AGENT_NAMES[s.agent]);

/** Each chat's last prompt from the user, sent again to the next agent after a failover. */
const lastPrompt = new Map<string, { parts: MessagePart[]; opts?: SendOpts }>();
/** How many failovers a chat's current message has had; reset once a turn ends well. */
const failoverHops = new Map<string, number>();

/** What `agent_prompt` says when a turn is still running; that turn goes on untouched. */
const BUSY = /still working/i;
/** Whether an error from `send` is the agent refusing a prompt because it is still working. */
export const isBusyRefusal = (message: string) => BUSY.test(message);
export const BUSY_NOTE = stored('chat.busyNote');

const RECAP_MESSAGES = 6;
const RECAP_CHARS = 1500;

/** The last 6 text messages as "You:"/"Agent:" lines, oldest first, within 1,500 characters, without A2UI blocks. */
export function buildRecap(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    // A2UI blocks are drawn cards, not words: the next agent gets the prose only.
    const text = extractA2ui(m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')).text.trim();
    if (text) lines.push(`${m.role === 'user' ? 'You' : 'Agent'}: ${text}`);
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of lines.slice(-RECAP_MESSAGES).reverse()) {
    const room = RECAP_CHARS - used - (kept.length ? 1 : 0);
    if (room <= 0) break;
    const cut = line.length > room ? `${line.slice(0, Math.max(0, room - 1))}…` : line;
    kept.unshift(cut);
    used += cut.length + (kept.length > 1 ? 1 : 0);
    if (line.length > room) break;
  }
  return kept.join('\n');
}

/** A system line that shows in the live chat and is stored with it. */
export const appendSystem = (chatId: string, text: string, extra?: MessagePart[]) =>
  useChat.getState().appendSystem(chatId, text, extra);

export const buildJobId = (chatId: string) => `build-${chatId}`;

/** Best effort: the job board must never break a chat. */
function writeJob(chatId: string, status: JobStatus, note: string | null = null) {
  const job = chatJobs.get(chatId);
  if (!job) return;
  void upsertJob({
    id: buildJobId(chatId),
    kind: 'build',
    title: job.title,
    projectId: job.projectId,
    chatId,
    agentId: chatAgent.get(chatId) ?? 'claude',
    status,
    progress: null,
    note,
    updatedAt: new Date().toISOString(),
  })
    .then(() => refreshJobs())
    .catch(() => {});
}
/** Whether the agent's last message waits on the user: an open A2UI surface, or a question at the end. */
export function waitsForAnswer(m: ChatMessage | undefined): boolean {
  if (!m || m.role !== 'agent') return false;
  const { text, blocks } = extractA2ui(m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''));
  const asks = blocks.some((b) => b.some((x) => typeof x === 'object' && x !== null && ('createSurface' in x || 'updateComponents' in x)));
  return asks || /[?？]\s*$/.test(text.trim());
}

let seq = 0;
const localMessage = (chatId: string, role: ChatMessage['role'], parts: MessagePart[]): ChatMessage => ({
  id: `local-${++seq}`,
  chatId,
  role,
  parts,
  createdAt: new Date().toISOString(),
});

let unlisten: Promise<() => void>[] = [];

/** How long Stop waits for the agent to end its turn before it kills the process. */
export const STOP_GRACE_MS = 4000;
/** The pending "kill it if it doesn't stop" of each chat; a turn that ends on its own cancels it. */
const stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
const clearStopTimer = (chatId: string) => {
  clearTimeout(stopTimers.get(chatId));
  stopTimers.delete(chatId);
};

const NO_PERMISSION = null;
/** The permission request a chat's card shows: the oldest open one. */
const NO_QUESTION = null;
/** The question a chat's card shows: the oldest open one. */
export const headQuestion = (s: { questions: Record<string, AgentQuestion[]> }, chatId: string | null) =>
  (chatId ? s.questions[chatId]?.[0] : undefined) ?? NO_QUESTION;

export const headPermission = (s: { permissions: Record<string, PermissionRequest[]> }, chatId: string | null) =>
  (chatId ? s.permissions[chatId]?.[0] : undefined) ?? NO_PERMISSION;

/** The chat's permission mode: its own (the unsent New chat uses its draft), else Auto or Ask from the toggle. */
export const modeOf = (
  s: { auto: Record<string, boolean>; pendingAuto: boolean | null; mode: Record<string, PermissionMode>; pendingMode: PermissionMode | null },
  chatId: string | null,
  settingsAuto: boolean,
): PermissionMode => (chatId ? s.mode[chatId] : s.pendingMode) ?? (autoOn(s, chatId, settingsAuto) ? 'auto' : 'ask');

/** Whether the Auto toggle is on: the chat's own value (the unsent New chat uses its draft), else Settings. */
export const autoOn = (
  s: { auto: Record<string, boolean>; pendingAuto: boolean | null },
  chatId: string | null,
  settingsAuto: boolean,
) => (chatId ? s.auto[chatId] : s.pendingAuto) ?? settingsAuto;

/** The user's own skills that are on, as text for an agent; empty when none are (or they can't be read). */
async function userSkills(): Promise<string> {
  try {
    return userSkillsText(await listSkills());
  } catch {
    return '';
  }
}

export const useChat = create<ChatState>((set, get) => {
  const append = (chatId: string, m: ChatMessage) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), m] } }));

  /** The agent's message in the chat's latest turn: the last one after the last user message. */
  const turnMessage = (chatId: string): ChatMessage | undefined => {
    const list = get().messages[chatId] ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.role === 'agent') return list[i];
      if (list[i]!.role === 'user') return undefined;
    }
    return undefined;
  };

  const replaceLast = (chatId: string, fn: (m: ChatMessage) => ChatMessage) =>
    set((s) => {
      const list = [...(s.messages[chatId] ?? [])];
      list[list.length - 1] = fn(list[list.length - 1]!);
      return { messages: { ...s.messages, [chatId]: list } };
    });

  /** Persist a local message and swap in the stored one. Best effort. */
  const persist = async (chatId: string, m: ChatMessage) => {
    if (isScratchChat(chatId)) return;
    try {
      const saved = await addMessage(chatId, m.role, m.parts);
      if (!saved) return;
      clientKeys.set(saved.id, m.id);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((x) => (x.id === m.id ? { ...saved } : x)),
        },
      }));
    } catch {
      /* keep the local copy */
    }
  };

  /** The turn is over: answer whatever is still queued with null and clear the queue. */
  /** The turn ended: everything the user queued meanwhile goes to the agent as one message. */
  const flushQueue = (chatId: string) => {
    const waiting = get().queued[chatId] ?? [];
    if (!waiting.length) return;
    set((s) => ({ queued: { ...s.queued, [chatId]: [] } }));
    const parts: MessagePart[] = waiting.flatMap((q, i) => (i === 0 ? q.parts : [{ type: 'text' as const, text: '\n\n' }, ...q.parts]));
    const opts = waiting.at(-1)?.opts;
    void get().send(chatId, parts, { ...opts, promptParts: undefined, fromQueue: true });
  };

  const finish = (chatId: string) => {
    clearStopTimer(chatId);
    const open = get().permissions[chatId] ?? [];
    const { [chatId]: _, ...turns } = get().turnStartedAt;
    set((s) => ({
      streaming: { ...s.streaming, [chatId]: false },
      permissions: { ...s.permissions, [chatId]: [] },
      questions: { ...s.questions, [chatId]: [] },
      turnStartedAt: turns,
    }));
    for (const req of open) void agentRespondPermission(req.requestId, null).catch(() => {});
  };

  /** The turn is over: a tool the agent never finished must not look like it is still running. */
  const settleTools = (chatId: string, status: 'done' | 'failed') => {
    const last = (get().messages[chatId] ?? []).at(-1);
    if (!last || last.role !== 'agent') return;
    if (!last.parts.some((p) => p.type === 'tool' && (p.status === 'pending' || p.status === 'running'))) return;
    replaceLast(chatId, (m) => ({
      ...m,
      parts: m.parts.map((p) => (p.type === 'tool' && (p.status === 'pending' || p.status === 'running') ? { ...p, status } : p)),
    }));
  };

  /** The turn is over: the agent's message is stored once, as it ended. */
  const saveTurn = (chatId: string) => {
    const m = turnMessage(chatId);
    if (m && isLocal(m)) void persist(chatId, m);
  };

  /**
   * A project chat's turn is over: its build job needs the user when the agent asked them something,
   * else it is done.
   */
  const settleBuildJob = (chatId: string) => {
    // The agent's last word, past any system line that landed after it (a busy note).
    const asked = waitsForAnswer([...(get().messages[chatId] ?? [])].reverse().find((m) => m.role === 'agent'));
    writeJob(chatId, asked ? 'needs-you' : 'done', asked ? stored('agents.waitingAnswer') : null);
  };

  const onUpdate = (chatId: string, u: AgentUpdate) => {
    if (!tracked.has(chatId)) return;
    if (u.kind === 'text' || u.kind === 'thought' || u.kind === 'tool') {
      const list = get().messages[chatId] ?? [];
      const last = list[list.length - 1];
      if (!last || last.role !== 'agent') {
        append(chatId, localMessage(chatId, 'agent', []));
      }
      replaceLast(chatId, (m) => {
        const parts = [...m.parts];
        if (u.kind === 'text' || u.kind === 'thought') {
          const tail = parts[parts.length - 1];
          if (tail?.type === u.kind) parts[parts.length - 1] = { type: u.kind, text: tail.text + u.text };
          else parts.push({ type: u.kind, text: u.text });
        } else {
          const part: MessagePart = {
            type: 'tool',
            toolCallId: u.toolCallId,
            title: u.title,
            status: u.status,
            ...(u.toolKind ? { toolKind: u.toolKind } : {}),
            ...(u.path ? { path: u.path } : {}),
          };
          const i = parts.findIndex((p) => p.type === 'tool' && p.toolCallId === u.toolCallId);
          if (i >= 0) parts[i] = part;
          else parts.push(part);
        }
        return { ...m, parts };
      });
      if (u.kind === 'tool') {
        // The first edit or command that finishes in a feature's chat: it is being built.
        const projectId = chatJobs.get(chatId)?.projectId;
        if (projectId && isWorkTool({ type: 'tool', toolCallId: u.toolCallId, title: u.title, status: u.status, toolKind: u.toolKind })) {
          void advanceProject(projectId, 'building');
        }
      }
      return;
    }
    if (u.kind === 'done') {
      if (u.stopReason !== 'cancelled') failoverHops.delete(chatId);
      // A Stop is the user's choice, not a failure: done, with a note saying so (never "needs you").
      if (u.stopReason === 'cancelled') writeJob(chatId, 'done', stored('agents.cancelled'));
      else settleBuildJob(chatId);
      settleTools(chatId, u.stopReason === 'cancelled' ? 'failed' : 'done');
      finish(chatId);
      // The message is stored once, as the turn ended, before anything queued is sent.
      saveTurn(chatId);
      flushQueue(chatId);
      // Tell the user, unless they stopped it themselves: it waits for their pick, or it is done.
      if (u.stopReason !== 'cancelled') {
        const last = [...(get().messages[chatId] ?? [])].reverse().find((m) => m.role === 'agent');
        void notifyAgent(chatId, waitsForAnswer(last) ? 'asks' : 'done');
      }
      return;
    }
    // The session's models are the models store's (see state/models), not part of the conversation.
    if (u.kind === 'models') return;
    // error: the session is gone, so the next send must start a new one
    settleTools(chatId, 'failed');
    finish(chatId);
    set((s) => ({ started: { ...s.started, [chatId]: false } }));
    // Saved in English; the chat and the job board say it in the user's language when they show it.
    const text = agentErrorText(u.message, chatAgent.get(chatId) ?? 'claude', 'en');
    writeJob(chatId, 'failed', text);
    const sys = localMessage(chatId, 'system', [{ type: 'text', text }]);
    append(chatId, sys);
    void persist(chatId, sys);
    void failover(chatId, u.message);
  };

  /**
   * Like 9router: when the chat's agent fails because its limit ran out, its sign-in failed or it stopped
   * answering, the chat moves to the next agent in Settings › Agents › Failover (with a recap) and the
   * user's last message is sent again. A failed agent rests for a while; each message tries every agent once.
   */
  const failover = async (chatId: string, message: string | undefined) => {
    const fo = useFailover.getState();
    const reason = failoverReason(message);
    const agent = chatAgent.get(chatId);
    const last = lastPrompt.get(chatId);
    if (!reason || !agent || isScratchChat(chatId)) return;
    if (reason === 'model' && (!fo.on || !last)) {
      // No failover to make: still hide the model for this account, so it isn't tried again.
      const model = useApp.getState().settings?.agentModels?.[agent] ?? null;
      if (model) fo.markIncompatible(agent, useAccounts.getState().activeOf(agent), model);
      const settings = await setAgentModel(agent, null, null).catch(() => null);
      if (settings) useApp.getState().setSettings(settings);
      if (model) await get().appendSystem(chatId, stored('chat.failoverModel', { from: model }));
      return;
    }
    if (!fo.on || !last) return;
    // The step the chat was on: its agent, on the model picked for that agent.
    const accounts = useAccounts.getState();
    const from: Step = { agent, account: accounts.activeOf(agent), model: useApp.getState().settings?.agentModels?.[agent] ?? null };
    if (reason === 'model') {
      // The account can't use this model: hide it for that account and go back to the agent's default.
      if (from.model) fo.markIncompatible(agent, from.account, from.model);
      const settings = await setAgentModel(agent, null, null).catch(() => null);
      if (settings) useApp.getState().setSettings(settings);
    } else fo.rest(from, reason);
    const hops = failoverHops.get(chatId) ?? 0;
    // Failover stays inside the chat's own combo.
    const pick = fo.pickOf(chatId);
    const to = fo.next(from, undefined, pick);
    if (!to || hops >= fo.steps(pick).length) {
      await get().appendSystem(chatId, stored('chat.failoverNone', { from: stepName(from) }));
      return;
    }
    failoverHops.set(chatId, hops + 1);
    try {
      void agentFailoverRecord(chatId, stepKey(from), stepKey(to), reason).catch(() => {});
    } catch {
      /* the Usage screen just misses this line */
    }
    try {
      // The next step's model is picked for its agent before its session starts.
      if ((to.model ?? null) !== (useApp.getState().settings?.agentModels?.[to.agent] ?? null)) {
        const settings = await setAgentModel(to.agent, to.model, null);
        if (settings) useApp.getState().setSettings(settings);
      }
      // The next step's account is made the agent's active one before its session starts.
      const toAccount = to.account ?? DEFAULT_ACCOUNT;
      if (MULTI_ACCOUNT.includes(to.agent) && toAccount !== accounts.activeOf(to.agent)) await accounts.use(to.agent, toAccount);
      if (to.agent !== agent) await get().switchAgent(chatId, to.agent);
      else {
        // Same agent, another model: a fresh session that gets a recap of the chat.
        pendingRecap.set(chatId, { text: buildRecap(get().messages[chatId] ?? []), switched: false });
        await get().stop(chatId);
      }
    } catch {
      return;
    }
    await get().appendSystem(chatId, stored(`chat.failover.${reason}`, { from: stepName(from), to: stepName(to) }));
    await get().send(chatId, last.parts, { ...last.opts, agentId: to.agent, fromQueue: true, resend: true, keepAttachments: true });
  };

  return {
    messages: {},
    streaming: {},
    turnStartedAt: {},
    permissions: {},
    questions: {},
    attachments: {},
    started: {},
    auto: {},
    mode: {},
    pendingMode: null,
    queued: {},
    unqueue(chatId, id) {
      set((s) => ({ queued: { ...s.queued, [chatId]: (s.queued[chatId] ?? []).filter((q) => q.id !== id) } }));
    },
    pendingAuto: null,
    autoBusy: {},
    rows: {},
    drafts: {},

    rememberChat: (chat) => set((s) => ({ rows: { ...s.rows, [chat.id]: chat } })),

    setDraft(key, draft) {
      const was = get().drafts[key] ?? EMPTY_DRAFT;
      if (was.text === draft.text) return;
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
    },

    async setAuto(chatId, on) {
      if (!chatId) {
        set({ pendingAuto: on });
        return;
      }
      if (!get().started[chatId]) {
        set((s) => ({ auto: { ...s.auto, [chatId]: on } }));
        return;
      }
      if (get().autoBusy[chatId]) return;
      set((s) => ({ autoBusy: { ...s.autoBusy, [chatId]: true } }));
      try {
        await agentSetAuto(chatId, on);
        set((s) => ({ auto: { ...s.auto, [chatId]: on } }));
      } catch (e) {
        if (on) return; // still asking, as before
        // Fail closed: the agent may still be in auto mode, so the app stopped it. The next
        // message starts a new session with Auto off.
        set((s) => ({ auto: { ...s.auto, [chatId]: false }, started: { ...s.started, [chatId]: false } }));
        const reason = e instanceof Error ? e.message : String(e);
        await get().appendSystem(
          chatId,
          stored('chat.autoOffFailed', { reason }),
        );
      } finally {
        set((s) => ({ autoBusy: { ...s.autoBusy, [chatId]: false } }));
      }
    },

    adoptPendingAuto(chatId) {
      const pending = get().pendingAuto;
      const mode = get().pendingMode;
      if (mode !== null) set((s) => ({ mode: { ...s.mode, [chatId]: mode }, pendingMode: null }));
      if (pending === null) return;
      set((s) => ({ auto: { ...s.auto, [chatId]: pending }, pendingAuto: null }));
    },

    async setMode(chatId, mode) {
      // Ask and Auto are the Auto toggle; the other modes ride on Ask's session settings.
      if (!chatId) {
        set({ pendingMode: mode, pendingAuto: mode === 'auto' });
        return;
      }
      if (mode === 'auto' || mode === 'ask') {
        const was = get().mode[chatId];
        // Ask and Auto show what the session confirmed (the Auto toggle's state), not the request.
        set((s) => {
          const { [chatId]: _dropped, ...rest } = s.mode;
          return { mode: rest };
        });
        // From plan, accept edits or bypass back to Ask, the agent has to leave that mode.
        if (mode === 'ask' && was && was !== 'ask' && was !== 'auto' && get().started[chatId]) {
          await agentSetMode(chatId, 'ask').catch(() => {});
        }
        await get().setAuto(chatId, mode === 'auto');
        return;
      }
      set((s) => ({ mode: { ...s.mode, [chatId]: mode }, auto: { ...s.auto, [chatId]: false } }));
      if (!get().started[chatId]) return;
      try {
        await agentSetMode(chatId, mode);
      } catch (e) {
        set((s) => ({ mode: { ...s.mode, [chatId]: 'ask' } }));
        await get().appendSystem(chatId, stored('chat.modeFailed', { reason: e instanceof Error ? e.message : String(e) }));
      }
    },

    async terminate(chatId) {
      await agentStop(chatId).catch(() => {});
      set((s) => ({
        started: { ...s.started, [chatId]: false },
        streaming: { ...s.streaming, [chatId]: false },
        permissions: { ...s.permissions, [chatId]: [] },
        questions: { ...s.questions, [chatId]: [] },
      }));
      writeJob(chatId, 'done', stored('agents.cancelled'));
      await get().appendSystem(chatId, stored('chat.terminated'));
    },

    async load(chatId) {
      if (isScratchChat(chatId)) return;
      tracked.add(chatId);
      const agent = (async () => {
        try {
          // After a restart the chat row is the only record of the chat's agent.
          const row = await getChat(chatId);
          if (row && !chatAgent.has(chatId)) chatAgent.set(chatId, row.agentId);
        } catch {
          /* the next send falls back to the default agent */
        }
      })();
      try {
        const list = await listMessages(chatId);
        // Never clobber a conversation that is already live in memory.
        if (!get().messages[chatId]?.length) set((s) => ({ messages: { ...s.messages, [chatId]: list } }));
      } catch {
        /* an empty chat is fine */
      }
      await agent;
    },

    async send(chatId, parts, opts) {
      tracked.add(chatId);
      // The agent is still working: the message waits for its turn to end (see flushQueue).
      if (get().streaming[chatId] && !opts?.fromQueue) {
        const item: QueuedMessage = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, parts, opts };
        set((s) => ({ queued: { ...s.queued, [chatId]: [...(s.queued[chatId] ?? []), item] } }));
        return null;
      }
      const attached = opts?.keepAttachments ? [] : (get().attachments[chatId] ?? []);
      const visible = [...attached, ...parts];
      set((s) => ({
        attachments: opts?.keepAttachments ? s.attachments : { ...s.attachments, [chatId]: [] },
        streaming: { ...s.streaming, [chatId]: true },
        // A send refused because a turn is running keeps that turn's start.
        turnStartedAt: { ...s.turnStartedAt, [chatId]: s.streaming[chatId] ? (s.turnStartedAt[chatId] ?? Date.now()) : Date.now() },
      }));
      if (!opts?.resend) {
        const user = localMessage(chatId, 'user', visible);
        append(chatId, user);
        void persist(chatId, user);
        failoverHops.delete(chatId);
        lastPrompt.set(chatId, { parts: opts?.promptParts ? [...attached, ...opts.promptParts] : visible, opts: opts?.promptParts ? { ...opts, promptParts: undefined } : opts });
      }
      try {
        const agent = opts?.agentId ?? chatAgent.get(chatId) ?? useApp.getState().settings?.defaultAgent ?? 'claude';
        chatAgent.set(chatId, agent);
        if (opts?.job) chatJobs.set(chatId, opts.job);
        writeJob(chatId, 'working');
        let fresh = false;
        let noPlugin = false;
        if (!get().started[chatId]) {
          // The session starts on the agent's step of the route (its account and model), skipping resting ones.
          const step = stepFor(agent, useFailover.getState().pickOf(chatId));
          if (step) await applyStep(step).catch(() => {});
          const auto = autoOn(get(), chatId, useApp.getState().settings?.autoMode ?? false);
          // Keep the toggle's value with the chat once it has a session.
          set((s) => ({ auto: { ...s.auto, [chatId]: auto } }));
          noPlugin = (auto ? await agentStart(chatId, agent, true) : await agentStart(chatId, agent)) === true;
          set((s) => ({ started: { ...s.started, [chatId]: true } }));
          fresh = true;
          const mode = get().mode[chatId];
          if (mode === 'acceptEdits' || mode === 'plan' || mode === 'bypass') {
            await agentSetMode(chatId, mode).catch(async (e) => {
              set((s) => ({ mode: { ...s.mode, [chatId]: 'ask' } }));
              await get().appendSystem(chatId, stored('chat.modeFailed', { reason: e instanceof Error ? e.message : String(e) }));
            });
          }
        }
        const sent = opts?.promptParts ? [...attached, ...opts.promptParts] : visible;
        const lead: MessagePart[] = [];
        // Claude loads the Buma plugin itself (unless the app shipped without it); other agents get
        // the skills as text, once per session.
        const uiLang = uiLanguage();
        if (fresh && !isInternalChat(chatId)) {
          // The agent's clock, and the id of the feature a project chat is about.
          const projectId = opts?.job?.projectId ?? chatJobs.get(chatId)?.projectId;
          const facts = { ...localClock(), ...(projectId ? { projectId } : {}) };
          if (agent !== 'claude' || noPlugin) lead.push({ type: 'text', text: buildSessionPreamble(uiLang, facts) });
          // The foreground rule too: long work (installs, test runs) must not be backgrounded and lost.
          else lead.push({ type: 'text', text: [languageHint(uiLang), sessionFacts(facts), FOREGROUND_RULE].filter(Boolean).join('\n\n') });
          // Claude loads the user's own skills as a plugin; other agents get a list of them.
          if (agent !== 'claude') {
            const mine = await userSkills();
            if (mine) lead.push({ type: 'text', text: mine });
          }
        }
        const recap = pendingRecap.get(chatId);
        if (recap?.text) {
          // i18n-ignore: this goes to the agent, not the user
          const intro = recap.switched ? 'Earlier in this chat, with another agent:' : 'Earlier in this chat:';
          // i18n-ignore: this goes to the agent, not the user
          lead.push({ type: 'text', text: `${intro}\n${recap.text}\n\nContinue from here.` });
        }
        await agentPrompt(chatId, [...lead, ...sent]);
        pendingRecap.delete(chatId);
        return null;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (BUSY.test(message)) {
          // The running turn is fine: leave its permissions, job and session alone and just say so.
          append(chatId, localMessage(chatId, 'system', [{ type: 'text', text: BUSY_NOTE }]));
          return null;
        }
        onUpdate(chatId, { kind: 'error', message });
        return agentErrorText(message, chatAgent.get(chatId) ?? 'claude');
      }
    },

    async respondPermission(chatId, optionId) {
      const [req, ...rest] = get().permissions[chatId] ?? [];
      if (!req) return;
      set((s) => ({ permissions: { ...s.permissions, [chatId]: rest } }));
      if (!rest.length && get().streaming[chatId]) writeJob(chatId, 'working');
      await agentRespondPermission(req.requestId, optionId);
    },

    async respondQuestion(chatId, response, summary) {
      const [q, ...rest] = get().questions[chatId] ?? [];
      if (!q) return;
      set((s) => ({ questions: { ...s.questions, [chatId]: rest } }));
      if (!rest.length && get().streaming[chatId]) writeJob(chatId, 'working');
      // The answer is part of the conversation: kept in the chat as the user's line.
      const text = response.action === 'accept' && summary ? summary : i18n.t('question.skipped');
      const line = localMessage(chatId, 'user', [{ type: 'text', text }]);
      append(chatId, line);
      void persist(chatId, line);
      await agentRespondQuestion(q.requestId, response);
    },

    async cancel(chatId) {
      await agentCancel(chatId).catch(() => {});
      // An agent that doesn't end its turn when asked is stopped for good.
      clearTimeout(stopTimers.get(chatId));
      stopTimers.set(
        chatId,
        setTimeout(() => {
          stopTimers.delete(chatId);
          if (get().streaming[chatId]) void get().terminate(chatId);
        }, STOP_GRACE_MS),
      );
    },

    async stop(chatId) {
      // The process goes away mid-turn without a `done`: the turn is over too.
      set((s) => ({ started: { ...s.started, [chatId]: false }, streaming: { ...s.streaming, [chatId]: false } }));
      await agentStop(chatId).catch(() => {});
    },

    async retire(chatId) {
      pendingRecap.set(chatId, { text: buildRecap(get().messages[chatId] ?? []), switched: false });
      await get().stop(chatId);
    },

    async switchAgent(chatId, agent) {
      const earlier = get().messages[chatId] ?? [];
      const row = await updateChatAgent(chatId, agent);
      await get().stop(chatId);
      chatAgent.set(chatId, agent);
      pendingRecap.set(chatId, { text: buildRecap(earlier), switched: true });
      const name = AGENT_NAMES[agent];
      const sys = localMessage(chatId, 'system', [
        {
          type: 'text',
          text: stored(row?.projectId ? 'chat.switchedProject' : 'chat.switched', { name }),
        },
      ]);
      append(chatId, sys);
      void persist(chatId, sys);
    },

    async appendSystem(chatId, text, extra = []) {
      const sys = localMessage(chatId, 'system', [{ type: 'text', text }, ...extra]);
      append(chatId, sys);
      await persist(chatId, sys);
    },

    notice(chatId, text) {
      append(chatId, localMessage(chatId, 'system', [{ type: 'text', text }]));
    },

    attach: (chatId, part) =>
      set((s) => ({ attachments: { ...s.attachments, [chatId]: [...(s.attachments[chatId] ?? []), part] } })),

    detach: (chatId, index) =>
      set((s) => ({
        attachments: { ...s.attachments, [chatId]: (s.attachments[chatId] ?? []).filter((_, i) => i !== index) },
      })),

    listen() {
      if (unlisten.length) return;
      unlisten = [
        onAgentUpdate(({ chatId, update }) => onUpdate(chatId, update)),
        onQuestion((q) => {
          if (!tracked.has(q.chatId)) return;
          writeJob(q.chatId, 'needs-you', stored('agents.waitingAnswer'));
          void notifyAgent(q.chatId, 'asks');
          set((s) => ({ questions: { ...s.questions, [q.chatId]: [...(s.questions[q.chatId] ?? []), q] } }));
        }),
        onPermission((req) => {
          if (!tracked.has(req.chatId)) return;
          writeJob(req.chatId, 'needs-you');
          void notifyAgent(req.chatId, 'permission');
          set((s) => ({
            permissions: { ...s.permissions, [req.chatId]: [...(s.permissions[req.chatId] ?? []), req] },
          }));
        }),
      ];
    },

    reset() {
      unlisten.forEach((p) => void p.then((fn) => fn()));
      unlisten = [];
      tracked.clear();
      lastPrompt.clear();
      failoverHops.clear();
      chatAgent.clear();
      chatJobs.clear();
      pendingRecap.clear();
      clientKeys.clear();
      resetProjectStatus();
      for (const id of [...stopTimers.keys()]) clearStopTimer(id);
      set({ messages: {}, streaming: {}, turnStartedAt: {}, permissions: {}, questions: {}, attachments: {}, started: {}, auto: {}, pendingAuto: null, mode: {}, pendingMode: null, queued: {}, autoBusy: {}, rows: {}, drafts: {} });
    },
  };
});
