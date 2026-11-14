import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentId, ModelChoice } from '@bspace-sdlc-app/shared';

/**
 * Why an agent was left: its limit or quota ran out, its sign-in failed, it stopped answering, or the
 * account can't use the model (Codex with a ChatGPT account and an API-only model, say).
 */
export type FailoverReason = 'limit' | 'auth' | 'down' | 'model';

const MODEL = /model_not_found|model[^.]{0,80}is not supported|not supported when using|unsupported model|unknown model|invalid model|model[^.]{0,40}(?:does not exist|not found|not available|isn't available)|no access to (?:the )?model|requires a newer version of codex/i;

const LIMIT = /usage limit|rate[ _-]?limit|\b429\b|\b529\b|quota|overloaded|too many requests|limit reached|limit exceeded|credit|insufficient|out of tokens|billing|exhausted/i;
const AUTH = /\bauth|sign[ -]?in|log[ -]?in|-32000|\b401\b|unauthori[sz]ed|expired token|invalid api key/i;
const DOWN = /exited|crash|ENOENT|not found|timed? ?out|no response|stopped unexpectedly|connection (closed|reset|refused)|spawn|broken pipe/i;

/** What kind of failure an agent's error is, or null when moving to another agent would not help. */
export function failoverReason(message: string | null | undefined): FailoverReason | null {
  const m = message ?? '';
  // Checked first: "not supported" is about the model, not the account's limit.
  if (MODEL.test(m)) return 'model';
  if (LIMIT.test(m)) return 'limit';
  if (AUTH.test(m)) return 'auth';
  if (DOWN.test(m)) return 'down';
  return null;
}

/** How long a step is skipped after it failed: a used-up limit lasts longest. */
export const COOLDOWN_MS: Record<FailoverReason, number> = { limit: 60 * 60_000, auth: 30 * 60_000, down: 5 * 60_000, model: 0 };

/** `codex` on the default account, `codex@<account id>` on another: whose models an account can use. */
export const accountOf = (agent: AgentId, account?: string | null) => (account && account !== 'default' ? `${agent}@${account}` : agent);

/**
 * One stop on the route: an agent, on one of its accounts (null or omitted: its default account) and one
 * of its models (null: the agent's own default model).
 */
export interface Step {
  agent: AgentId;
  account?: string | null;
  model: string | null;
}

const acct = (s: Step) => (s.account && s.account !== 'default' ? s.account : null);
/** `claude/opus` on the default account, `claude@<account id>/opus` on another one. */
export const stepKey = (s: Step) => `${s.agent}${acct(s) ? `@${acct(s)}` : ''}/${s.model ?? ''}`;
const sameStep = (a: Step, b: Step) => stepKey(a) === stepKey(b);

/**
 * Models offered for an agent before it has reported its own list (or beyond it). Claude Code takes a
 * full model id, so the current Claude family is listed by id; other agents report theirs, and any id
 * can be added by hand.
 */
export const KNOWN_MODELS: Partial<Record<AgentId, ModelChoice[]>> = {
  claude: [
    { value: 'claude-fable-5-2', name: 'Fable 5.2' },
    { value: 'claude-opus-5-5', name: 'Opus 5.5' },
    { value: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
    { value: 'claude-haiku-5-5', name: 'Haiku 5.5' },
  ],
};

/**
 * A combo: a named list of steps a chat goes through, each an agent on a model (and an account; none:
 * every signed-in account of the agent, in order). One step is a single model; several are a failover
 * chain ("Reasoning": Claude Opus, then Codex GPT-6.1-Sol). A chat runs on one combo, picked per chat.
 */
export interface Combo {
  id: string;
  name: string;
  steps: Step[];
}

/** A chat's pick: a combo id, or one model on its own (`single:<agent>:<model>`, model empty: default). */
export const singlePick = (agent: AgentId, model: string | null) => `single:${agent}:${model ?? ''}`;
export function parseSingle(pick: string): Step | null {
  if (!pick.startsWith('single:')) return null;
  const [, agent = '', ...rest] = pick.split(':');
  const model = rest.join(':');
  return { agent: agent as AgentId, model: model || null };
}

/** The key the New chat screen keeps its pick under until the chat exists. */
export const NEW_CHAT_PICK = 'new';

const DEFAULT_COMBO_ID = 'default';

interface FailoverState {
  /** The combos, in the order they are listed. */
  combos: Combo[];
  /** The combo new chats start on. */
  defaultCombo: string;
  /** Chat id (or `new`) → its pick: a combo id or a single model. */
  chatPick: Record<string, string>;
  /** Agents set up on this computer (from the last detection); steps on others are skipped. */
  ready: AgentId[];
  setReady(agents: AgentId[]): void;
  addCombo(name: string, steps?: Step[]): string;
  renameCombo(id: string, name: string): void;
  /** Removes a combo (never the last); its chats go back to the default. */
  removeCombo(id: string): void;
  setDefaultCombo(id: string): void;
  setComboSteps(id: string, steps: Step[]): void;
  /** The pick of a chat (null: the New chat screen), else the default combo. */
  pickOf(chatId: string | null): string;
  setPick(chatId: string | null, pick: string): void;
  /** A new chat just got its id: it takes over the New chat screen's pick. */
  adoptPick(chatId: string): void;
  /** A pick's name for people: the combo's name, or the agent and model. */
  comboOf(pick: string): Combo | null;
  /** Move a chat to the next step on its own when its agent fails. */
  on: boolean;
  /** The agents in use, in order; the first is the default agent. */
  chain: AgentId[];
  /** Each agent's models to go through, in order; none: the agent's own default model only. */
  models: Partial<Record<AgentId, string[]>>;
  /** Models added by hand per agent (beyond what the agent reports). */
  extra: Partial<Record<AgentId, string[]>>;
  /** Step key → until when (ms since the epoch) it is skipped. */
  cooldown: Record<string, number>;
  /** Each agent's signed-in accounts, in order (from Settings' accounts list); none: the default account. */
  accounts: Partial<Record<AgentId, string[]>>;
  setAccounts(accounts: Partial<Record<AgentId, string[]>>): void;
  /** Account (`accountOf`) → the models it refused ("not supported with this account"); hidden and skipped. */
  incompatible: Record<string, string[]>;
  /** Marks a model the account refused: it leaves the agent's route and its menus. */
  markIncompatible(agent: AgentId, account: string | null | undefined, model: string): void;
  isCompatible(agent: AgentId, account: string | null | undefined, model: string): boolean;
  setOn(on: boolean): void;
  setChain(chain: AgentId[]): void;
  setModels(agent: AgentId, models: string[]): void;
  addExtra(agent: AgentId, model: string): void;
  /** Rests a failed step for the reason's cooldown. */
  rest(step: Step, reason: FailoverReason, now?: number): void;
  /** Lets a step (or every step of an agent) be tried again now. */
  wake(key: string): void;
  /** A pick's steps (default: the default combo), each expanded to the agent's signed-in accounts. */
  steps(pick?: string): Step[];
  /** The next step after `from` in the pick that is not resting (wrapping round), or null. */
  next(from: Step, now?: number, pick?: string): Step | null;
  /** Until when a step rests (0: it doesn't). */
  restingUntil(step: Step, now?: number): number;
}

export const DEFAULT_CHAIN: AgentId[] = ['claude', 'codex', 'gemini', 'opencode'];

export const useFailover = create<FailoverState>()(
  persist(
    (set, get) => ({
      combos: [{ id: DEFAULT_COMBO_ID, name: 'Default', steps: DEFAULT_CHAIN.map((agent) => ({ agent, model: null })) }],
      defaultCombo: DEFAULT_COMBO_ID,
      chatPick: {},
      ready: [],
      setReady: (ready) => set({ ready }),
      addCombo: (name, steps = []) => {
        const id = `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        set((s) => ({ combos: [...s.combos, { id, name, steps }] }));
        return id;
      },
      renameCombo: (id, name) => set((s) => ({ combos: s.combos.map((c) => (c.id === id ? { ...c, name } : c)) })),
      removeCombo: (id) =>
        set((s) => {
          if (s.combos.length <= 1) return {};
          const combos = s.combos.filter((c) => c.id !== id);
          const defaultCombo = s.defaultCombo === id ? combos[0]!.id : s.defaultCombo;
          const chatPick = Object.fromEntries(Object.entries(s.chatPick).filter(([, p]) => p !== id));
          return { combos, defaultCombo, chatPick };
        }),
      setDefaultCombo: (defaultCombo) => set({ defaultCombo }),
      setComboSteps: (id, steps) => set((s) => ({ combos: s.combos.map((c) => (c.id === id ? { ...c, steps } : c)) })),
      pickOf(chatId) {
        const { chatPick, combos, defaultCombo } = get();
        const p = chatPick[chatId ?? NEW_CHAT_PICK];
        if (p && (parseSingle(p) || combos.some((c) => c.id === p))) return p;
        return defaultCombo;
      },
      setPick: (chatId, pick) => set((s) => ({ chatPick: { ...s.chatPick, [chatId ?? NEW_CHAT_PICK]: pick } })),
      adoptPick: (chatId) =>
        set((s) => {
          const p = s.chatPick[NEW_CHAT_PICK];
          if (!p) return {};
          const chatPick = { ...s.chatPick, [chatId]: p };
          delete chatPick[NEW_CHAT_PICK];
          return { chatPick };
        }),
      comboOf: (pick) => get().combos.find((c) => c.id === pick) ?? null,
      on: true,
      chain: DEFAULT_CHAIN,
      models: {},
      extra: {},
      cooldown: {},
      accounts: {},
      setAccounts: (accounts) => set({ accounts }),
      incompatible: {},
      markIncompatible: (agent, account, model) =>
        set((s) => {
          const key = accountOf(agent, account);
          const incompatible = { ...s.incompatible, [key]: [...new Set([...(s.incompatible[key] ?? []), model])] };
          // On the default account the model leaves the route too (other accounts may still take it).
          const models = !account || account === 'default' ? { ...s.models, [agent]: (s.models[agent] ?? []).filter((m) => m !== model) } : s.models;
          return { incompatible, models };
        }),
      isCompatible: (agent, account, model) => !(get().incompatible[accountOf(agent, account)] ?? []).includes(model),
      setOn: (on) => set({ on }),
      setChain: (chain) => set({ chain: [...new Set(chain)] }),
      setModels: (agent, models) => set((s) => ({ models: { ...s.models, [agent]: [...new Set(models)] } })),
      addExtra: (agent, model) => set((s) => ({ extra: { ...s.extra, [agent]: [...new Set([...(s.extra[agent] ?? []), model])] } })),
      rest: (step, reason, now = Date.now()) => set((s) => ({ cooldown: { ...s.cooldown, [stepKey(step)]: now + COOLDOWN_MS[reason] } })),
      wake: (key) =>
        set((s) => ({
          cooldown: Object.fromEntries(Object.entries(s.cooldown).filter(([k]) => k !== key && !k.startsWith(`${key}/`) && !k.startsWith(`${key}@`))),
        })),
      steps: (pick) => {
        const { accounts, ready, incompatible } = get();
        const p = pick ?? get().defaultCombo;
        const raw = parseSingle(p) ? [parseSingle(p)!] : (get().comboOf(p) ?? get().comboOf(get().defaultCombo))?.steps ?? [];
        return raw
          // Steps on agents that are not set up here are skipped.
          .filter((s) => !ready.length || ready.includes(s.agent))
          .flatMap((s): Step[] => {
            // No account: every signed-in account of the agent, in order.
            const accts: (string | null)[] = s.account ? [s.account === 'default' ? null : s.account] : accounts[s.agent]?.length ? accounts[s.agent]!.map((a) => (a === 'default' ? null : a)) : [null];
            return accts
              // A model an account refused is skipped for it.
              .filter((account) => s.model === null || !(incompatible[accountOf(s.agent, account)] ?? []).includes(s.model))
              .map((account) => (account ? { agent: s.agent, account, model: s.model } : { agent: s.agent, model: s.model }));
          });
      },
      restingUntil(step, now = Date.now()) {
        const until = get().cooldown[stepKey(step)] ?? 0;
        return until > now ? until : 0;
      },
      next(from, now = Date.now(), pick) {
        const steps = get().steps(pick);
        // A step the chat was on that is not in the route (another model or account picked by hand): start after its agent.
        let start = steps.findIndex((s) => sameStep(s, from));
        if (start < 0) start = steps.map((s) => s.agent).lastIndexOf(from.agent);
        const order = start < 0 ? steps : [...steps.slice(start + 1), ...steps.slice(0, start)];
        return order.find((s) => !sameStep(s, from) && !get().restingUntil(s, now)) ?? null;
      },
    }),
    {
      name: 'buma.failover',
      version: 3,
      partialize: (s) => ({
        on: s.on,
        chain: s.chain,
        models: s.models,
        extra: s.extra,
        cooldown: s.cooldown,
        incompatible: s.incompatible,
        combos: s.combos,
        defaultCombo: s.defaultCombo,
        chatPick: s.chatPick,
        ready: s.ready,
      }),
      // Before combos there was one route (agents in order, each through its models): it becomes "Default".
      migrate: (old, version): never => {
        const o = (old ?? {}) as Partial<FailoverState>;
        if (version < 3 && o.chain?.length) {
          const steps = o.chain.flatMap((agent): Step[] => (o.models?.[agent]?.length ? o.models[agent]!.map((model) => ({ agent, model })) : [{ agent, model: null }]));
          return { ...o, combos: [{ id: DEFAULT_COMBO_ID, name: 'Default', steps }], defaultCombo: DEFAULT_COMBO_ID, chatPick: {} } as never;
        }
        // Missing fields fall back to the store's own defaults when merged.
        return o as never;
      },
    },
  ),
);
