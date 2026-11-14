import { create } from 'zustand';
import type { AgentId, AgentUpdate, ModelChoice } from '@bspace-sdlc-app/shared';
import { onAgentUpdate } from '@/shared/lib/events';
import { agentModelCatalog, agentModels, type AgentModels } from '@/shared/lib/ipc';
import { useFailover } from '@/features/agents/state/failover';
import { useAccounts } from '@/features/agents/state/accounts';

/**
 * Which agent a chat runs on. The chat store registers it (`setChatAgentLookup`), so this store does not
 * import the chat feature (chat already depends on agents).
 */
let chatAgentOf: (chatId: string) => AgentId | undefined = () => undefined;
export function setChatAgentLookup(lookup: (chatId: string) => AgentId | undefined): void {
  chatAgentOf = lookup;
}

const CACHE_KEY = 'buma.agentModels';

/** Your API's models follow the provider saved in Settings, so they are read fresh, never kept. */
const UNCACHED: AgentId[] = ['custom'];
const withoutUncached = (byAgent: Partial<Record<AgentId, AgentModels>>) =>
  Object.fromEntries(Object.entries(byAgent).filter(([agent]) => !UNCACHED.includes(agent as AgentId))) as Partial<
    Record<AgentId, AgentModels>
  >;

function loadCache(): Partial<Record<AgentId, AgentModels>> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as unknown;
    return raw && typeof raw === 'object' ? withoutUncached(raw as Partial<Record<AgentId, AgentModels>>) : {};
  } catch {
    return {};
  }
}

function saveCache(byAgent: Partial<Record<AgentId, AgentModels>>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(withoutUncached(byAgent)));
  } catch {
    /* storage off: the list is read again next time */
  }
}

interface ModelsState {
  /** What each running chat's session reports. */
  byChat: Record<string, AgentModels>;
  /** The last list each agent reported, kept between launches so the picker has it before a session. */
  byAgent: Partial<Record<AgentId, AgentModels>>;
  /** An agent being asked for its models right now. */
  loading: Partial<Record<AgentId, boolean>>;
  /** An agent that couldn't be asked, with why. */
  failed: Partial<Record<AgentId, string>>;
  /** Starts following the `models` updates of every session. Safe to call again. */
  listen(): void;
  report(chatId: string, update: Extract<AgentUpdate, { kind: 'models' }>): void;
  /** Every model and version each agent can run (Settings' "+ Model" menu), kept between launches. */
  catalog: Partial<Record<AgentId, ModelChoice[]>>;
  catalogLoading: Partial<Record<AgentId, boolean>>;
  /** Reads an agent's full model list (once per app run unless `force`). */
  loadCatalog(agent: AgentId, force?: boolean): Promise<void>;
  /** Asks the agent for its models when none are known yet (or when `force`). */
  load(agent: AgentId, force?: boolean): Promise<void>;
}

let listening = false;

const CATALOG_KEY = 'buma.modelCatalog';
/**
 * Agents whose full list is what the signed-in account may run through the agent adapter (Codex). Two
 * lists have to agree: the account's own (what Codex fetched for it, `models_cache.json`) and the
 * adapter's (what `codex-acp` itself can start: its bundled Codex is often older than the Codex app,
 * so it refuses newer models even when the account has them). Only models on both lists are offered.
 */
export const EXACT_LIST: AgentId[] = ['codex'];

/**
 * The models to offer for an agent: for the exact-list agents the account's list narrowed to what the
 * adapter can run (or just the account's list until the adapter has said); for the rest the full list.
 * `null`: no full list is known, so the agent's own list and the known ones are used.
 */
export function runnableModels(agent: AgentId, catalog: ModelChoice[] | undefined, reported: ModelChoice[] | undefined): ModelChoice[] | null {
  if (!catalog?.length) return null;
  if (!EXACT_LIST.includes(agent) || !reported?.length) return catalog;
  const adapter = new Set(reported.map((m) => m.value));
  const both = catalog.filter((m) => adapter.has(m.value));
  // No overlap at all means the lists can't be compared: trust the adapter, which is what runs.
  return both.length ? both : reported;
}

/** Hides the route's models that this account can't run through the adapter, for the exact-list agents. */
function pruneRoute(agent: AgentId, catalog: ModelChoice[] | undefined, reported: ModelChoice[] | undefined) {
  if (!EXACT_LIST.includes(agent)) return;
  const list = runnableModels(agent, catalog, reported);
  if (!list) return;
  const fo = useFailover.getState();
  const account = useAccounts.getState().activeOf(agent);
  const have = new Set(list.map((m) => m.value));
  const inCombos = new Set(fo.combos.flatMap((c) => c.steps.filter((x) => x.agent === agent && x.model).map((x) => x.model!)));
  for (const m of [...(fo.models[agent] ?? []), ...inCombos]) if (!have.has(m)) fo.markIncompatible(agent, account, m);
}
/** Agents whose full list was read in this app run. */
const catalogRead = new Set<AgentId>();
function loadCatalogCache(): Partial<Record<AgentId, ModelChoice[]>> {
  try {
    const raw = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null') as unknown;
    return raw && typeof raw === 'object' ? (raw as Partial<Record<AgentId, ModelChoice[]>>) : {};
  } catch {
    return {};
  }
}

export const useModels = create<ModelsState>((set, get) => ({
  byChat: {},
  byAgent: loadCache(),
  loading: {},
  catalog: loadCatalogCache(),
  catalogLoading: {},
  loadCatalog: async (agent, force = false) => {
    if (get().catalogLoading[agent] || (!force && catalogRead.has(agent))) return;
    catalogRead.add(agent);
    set((s) => ({ catalogLoading: { ...s.catalogLoading, [agent]: true } }));
    try {
      const list = await agentModelCatalog(agent);
      if (list?.length) pruneRoute(agent, list, get().byAgent[agent]?.options);
      if (list?.length)
        set((s) => {
          const catalog = { ...s.catalog, [agent]: list };
          try {
            localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
          } catch {
            /* read again next time */
          }
          return { catalog };
        });
    } catch {
      /* the agent's own list (or the known one) stands in */
    } finally {
      set((s) => ({ catalogLoading: { ...s.catalogLoading, [agent]: false } }));
    }
  },
  failed: {},
  listen: () => {
    if (listening) return;
    listening = true;
    Promise.resolve()
      .then(() =>
        onAgentUpdate(({ chatId, update }) => {
          if (update.kind === 'models') get().report(chatId, update);
        }),
      )
      .catch(() => {
        listening = false;
      });
  },
  report: (chatId, { current, options }) => {
    const info = { current, options };
    const agent = chatAgentOf(chatId);
    set((s) => {
      const byAgent = agent && options.length ? { ...s.byAgent, [agent]: info } : s.byAgent;
      if (byAgent !== s.byAgent) saveCache(byAgent);
      return { byChat: { ...s.byChat, [chatId]: info }, byAgent };
    });
  },
  load: async (agent, force = false) => {
    if (get().loading[agent] || (!force && get().byAgent[agent]?.options.length)) return;
    set((s) => ({ loading: { ...s.loading, [agent]: true }, failed: { ...s.failed, [agent]: undefined } }));
    try {
      const info = await agentModels(agent);
      set((s) => {
        const byAgent = info?.options.length ? { ...s.byAgent, [agent]: info } : s.byAgent;
        if (byAgent !== s.byAgent) saveCache(byAgent);
        return { byAgent };
      });
      // The adapter has said what it can run: models of the route that it can't leave the combos.
      if (info?.options.length) pruneRoute(agent, get().catalog[agent], info.options);
    } catch (e) {
      set((s) => ({ failed: { ...s.failed, [agent]: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [agent]: false } }));
    }
  },
}));

const NO_OPTIONS: ModelChoice[] = [];

/** The options to pick from for an agent: the chat's live session first, else the last list seen. */
export function modelOptions(s: Pick<ModelsState, 'byChat' | 'byAgent'>, agent: AgentId, chatId: string | null): ModelChoice[] {
  return (chatId ? s.byChat[chatId]?.options : undefined) ?? s.byAgent[agent]?.options ?? NO_OPTIONS;
}
