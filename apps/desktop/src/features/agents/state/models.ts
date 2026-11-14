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
 * Agents whose full list is exactly what the signed-in account may run (Codex: the list Codex fetched
 * for that account). For them the agent's own session list (which may name API-only models) is not
 * offered, and route models missing from it are dropped.
 */
export const EXACT_LIST: AgentId[] = ['codex'];
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
      if (list?.length && EXACT_LIST.includes(agent)) {
        // Models on the route this account doesn't have can't run: hide them for it.
        const fo = useFailover.getState();
        const account = useAccounts.getState().activeOf(agent);
        const have = new Set(list.map((m) => m.value));
        for (const m of fo.models[agent] ?? []) if (!have.has(m)) fo.markIncompatible(agent, account, m);
      }
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
