import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentId, AgentInfo } from '@bspace-sdlc-app/shared';

interface ConnectionsState {
  /** Agents signed in from Add connection (in case their CLI keeps its sign-in somewhere Buma doesn't look). */
  signedIn: AgentId[];
  mark(agent: AgentId): void;
}

export const useConnections = create<ConnectionsState>()(
  persist(
    (set) => ({
      signedIn: [],
      mark: (agent) => set((s) => ({ signedIn: [...new Set([...s.signedIn, agent])] })),
    }),
    { name: 'buma.connections' },
  ),
);

/**
 * Whether an agent is connected: it can run and it is signed in. Claude: Buma's Claude account. Your
 * API: its key is saved. The others: installed, with their sign-in saved (or signed in from Buma).
 */
export function isConnected(a: AgentInfo, claudeSignedIn: boolean, marked: AgentId[]): boolean {
  if (!a.installed) return false;
  if (a.id === 'claude') return claudeSignedIn;
  if (a.id === 'custom') return true;
  return !!a.signedIn || marked.includes(a.id);
}
