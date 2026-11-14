import { create } from 'zustand';
import type { AgentId } from '@bspace-sdlc-app/shared';
import { useFailover } from '@/features/agents/state/failover';
import { i18n } from '@/i18n';
import { cleanError } from '@/shared/lib/cleanError';
import { accountAdd, accountRemove, accountSignIn, accountSignOut, accountsList, accountUse, type AccountView } from '@/shared/lib/ipc';

/** The account every agent signs in to on its own. */
export const DEFAULT_ACCOUNT = 'default';

/** Agents that can have several accounts (their sign-in can live in a folder of Buma's choosing). */
export const MULTI_ACCOUNT: AgentId[] = ['claude', 'codex', 'opencode'];

interface AccountsState {
  list: AccountView[] | null;
  /** `<agent>/<account id>` (or `<agent>/new`) → being signed in right now. Keyed by agent too: every
   * agent has a `default` account. */
  signingIn: Record<string, boolean>;
  /** `<agent>/<account id>` (or `<agent>/new`) → why the last sign-in or sign-out failed. */
  failed: Record<string, string>;
  load(): Promise<void>;
  /** Adds an account to an agent and signs it in, in the browser. */
  add(agent: AgentId): Promise<void>;
  signIn(agent: AgentId, id: string): Promise<void>;
  remove(agent: AgentId, id: string): Promise<void>;
  /** Signs one account out; agents are detected again afterwards (`changed` goes up). */
  signOut(agent: AgentId, id: string): Promise<void>;
  /** Goes up whenever a sign-in or sign-out changed who is signed in, so screens read the agents again. */
  changed: number;
  /** Makes an account the agent's active one (new sessions start on it). */
  use(agent: AgentId, id: string): Promise<void>;
  /** The agent's accounts, the default first. */
  of(agent: AgentId): AccountView[];
  /** The agent's active account id. */
  activeOf(agent: AgentId): string;
}

/** Another account of the same agent signed in as the same person (an email), if there is one. */
const duplicateOf = (list: AccountView[], agent: AgentId, id: string): AccountView | undefined => {
  const me = list.find((a) => a.agent === agent && a.id === id);
  const who = me?.account?.trim().toLowerCase();
  if (!me?.signedIn || !who) return undefined;
  return list.find((a) => a.agent === agent && a.id !== id && a.signedIn && a.account?.trim().toLowerCase() === who);
};

/** The state key of one account: every agent has a `default` account, so the agent is part of it. */
export const accountKey = (agent: AgentId, id: string) => `${agent}/${id}`;

const errorText = (e: unknown) => cleanError(e instanceof Error ? e.message : String(e));

export const useAccounts = create<AccountsState>((set, get) => ({
  list: null,
  signingIn: {},
  failed: {},
  changed: 0,
  async load() {
    try {
      const list = await accountsList();
      set({ list });
      // The failover route goes through every signed-in account of an agent, in order.
      const byAgent: Partial<Record<AgentId, string[]>> = {};
      for (const a of list) if (a.signedIn) byAgent[a.agent] = [...(byAgent[a.agent] ?? []), a.id];
      useFailover.getState().setAccounts(byAgent);
    } catch {
      set((s) => ({ list: s.list ?? [] }));
    }
  },
  async add(agent) {
    const key = accountKey(agent, 'new');
    set((s) => ({ signingIn: { ...s.signingIn, [key]: true }, failed: { ...s.failed, [key]: '' } }));
    let id: string | null = null;
    try {
      id = await accountAdd(agent);
      await accountSignIn(agent, id);
      // The same person twice is not a second account: drop it.
      const now = await accountsList();
      const dup = duplicateOf(now, agent, id);
      if (dup) throw new Error(i18n.t('agents.duplicateAccount', { account: dup.account ?? '' }));
    } catch (e) {
      set((s) => ({ failed: { ...s.failed, [key]: errorText(e) } }));
      // An account that never signed in is not kept.
      if (id) await accountRemove(agent, id).catch(() => {});
    } finally {
      set((s) => ({ signingIn: { ...s.signingIn, [key]: false }, changed: s.changed + 1 }));
      await get().load();
    }
  },
  async signIn(agent, id) {
    const key = accountKey(agent, id);
    set((s) => ({ signingIn: { ...s.signingIn, [key]: true }, failed: { ...s.failed, [key]: '' } }));
    try {
      await accountSignIn(agent, id);
      // Signing an account in as someone another account already is: sign it out again.
      const dup = duplicateOf(await accountsList(), agent, id);
      if (dup) {
        await accountSignOut(agent, id).catch(() => {});
        throw new Error(i18n.t('agents.duplicateAccount', { account: dup.account ?? '' }));
      }
    } catch (e) {
      set((s) => ({ failed: { ...s.failed, [key]: errorText(e) } }));
    } finally {
      set((s) => ({ signingIn: { ...s.signingIn, [key]: false }, changed: s.changed + 1 }));
      await get().load();
    }
  },
  async remove(agent, id) {
    await accountRemove(agent, id).catch(() => {});
    await get().load();
  },
  async signOut(agent, id) {
    const key = accountKey(agent, id);
    set((s) => ({ signingIn: { ...s.signingIn, [key]: true }, failed: { ...s.failed, [key]: '' } }));
    try {
      await accountSignOut(agent, id);
    } catch (e) {
      set((s) => ({ failed: { ...s.failed, [key]: errorText(e) } }));
    } finally {
      set((s) => ({ signingIn: { ...s.signingIn, [key]: false }, changed: s.changed + 1 }));
      await get().load();
    }
  },
  async use(agent, id) {
    await accountUse(agent, id);
    set((s) => ({ list: s.list?.map((a) => (a.agent === agent ? { ...a, active: a.id === id } : a)) ?? null }));
  },
  of: (agent) => (get().list ?? []).filter((a) => a.agent === agent),
  activeOf: (agent) => get().of(agent).find((a) => a.active)?.id ?? DEFAULT_ACCOUNT,
}));
