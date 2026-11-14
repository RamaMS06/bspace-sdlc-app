import type { AgentId } from '@bspace-sdlc-app/shared';
import { setAgentModel } from '@/lib/ipc';
import { DEFAULT_ACCOUNT, MULTI_ACCOUNT, useAccounts } from '@/state/accounts';
import { useApp } from '@/state/app';
import { useFailover, type Step } from '@/state/failover';

/**
 * Chats run on a combo (Agents › Combo), picked per chat under the message box: a new chat starts on
 * its pick's first step that is not resting; a chat that already has an agent starts its next session
 * on that agent's first step in its pick that is not resting.
 */
export function routeStart(pick?: string, now = Date.now()): Step | null {
  const fo = useFailover.getState();
  return fo.steps(pick ?? fo.pickOf(null)).find((s) => !fo.restingUntil(s, now)) ?? null;
}

/** The first step of an agent in a pick that is not resting (null: not in it, or all resting). */
export function stepFor(agent: AgentId, pick?: string, now = Date.now()): Step | null {
  const fo = useFailover.getState();
  return fo.steps(pick).find((s) => s.agent === agent && !fo.restingUntil(s, now)) ?? null;
}

/** Makes a step's account and model the agent's own before its session starts. */
export async function applyStep(step: Step): Promise<void> {
  const accounts = useAccounts.getState();
  const account = step.account ?? DEFAULT_ACCOUNT;
  if (MULTI_ACCOUNT.includes(step.agent) && account !== accounts.activeOf(step.agent)) await accounts.use(step.agent, account);
  const model = step.model ?? null;
  if (model !== (useApp.getState().settings?.agentModels?.[step.agent] ?? null)) {
    const settings = await setAgentModel(step.agent, model, null);
    if (settings) useApp.getState().setSettings(settings);
  }
}

/**
 * Puts a chat on a new pick (a combo or one model). A chat with a session moves now: to another agent
 * with a recap of the chat, or on the same agent to the pick's model (the running session switches).
 */
export async function usePick(chatId: string | null, pick: string, current: AgentId | null): Promise<void> {
  const fo = useFailover.getState();
  fo.setPick(chatId, pick);
  if (!chatId || !current) return;
  const step = routeStart(pick);
  if (!step) return;
  const { useChat } = await import('@/state/chat');
  if (step.agent !== current) {
    await useChat.getState().switchAgent(chatId, step.agent);
    await applyStep(step);
    return;
  }
  const accounts = useAccounts.getState();
  const account = step.account ?? DEFAULT_ACCOUNT;
  if (MULTI_ACCOUNT.includes(step.agent) && account !== accounts.activeOf(step.agent)) {
    // Another account of the same agent: a fresh session on it.
    await accounts.use(step.agent, account);
    await useChat.getState().retire(chatId);
  }
  const settings = await setAgentModel(step.agent, step.model ?? null, chatId);
  if (settings) useApp.getState().setSettings(settings);
}
