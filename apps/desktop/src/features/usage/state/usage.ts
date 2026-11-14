import { create } from 'zustand';
import type { AgentId, AgentUsage } from '@bspace-sdlc-app/shared';
import { getAgentUsage } from '@/shared/lib/ipc';

export const POLL_MS = 5 * 60 * 1000;

interface UsageState {
  usage: AgentUsage[];
  loading: boolean;
  loaded: boolean;
  /** The agent of the chat on screen; the bar shows it instead of the default agent. */
  chatAgent: AgentId | null;
  setChatAgent(agent: AgentId | null): void;
  /** Loads now and every five minutes. Safe to call again. */
  start(): void;
  refresh(force?: boolean): Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** A failed refresh keeps the last good numbers instead of blanking the bar. */
export function mergeUsage(prev: AgentUsage[], next: AgentUsage[]): AgentUsage[] {
  return next.map((n) => {
    if (n.status !== 'error') return n;
    const old = prev.find((p) => p.agentId === n.agentId && p.accountId === n.accountId && p.status === 'ok');
    return old ? { ...old, message: n.message } : n;
  });
}

/** Claude and Codex always lead; the rest keep their order. */
const LEAD: AgentId[] = ['claude', 'codex'];
export function sortUsage(list: AgentUsage[]): AgentUsage[] {
  const rank = (u: AgentUsage) => {
    const i = LEAD.indexOf(u.agentId);
    return i < 0 ? LEAD.length : i;
  };
  return list.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map((x) => x.u);
}

export const useUsage = create<UsageState>((set, get) => ({
  usage: [],
  loading: false,
  loaded: false,
  chatAgent: null,
  setChatAgent: (agent) => set({ chatAgent: agent }),
  start: () => {
    if (timer) return;
    void get().refresh(false);
    timer = setInterval(() => void get().refresh(false), POLL_MS);
  },
  refresh: async (force = true) => {
    set({ loading: true });
    try {
      const next = await getAgentUsage(force);
      set((s) => ({ usage: sortUsage(mergeUsage(s.usage, next)), loading: false, loaded: true }));
    } catch {
      set({ loading: false, loaded: true });
    }
  },
}));

/** Test helper: stops the poll timer. */
export function stopUsagePolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
