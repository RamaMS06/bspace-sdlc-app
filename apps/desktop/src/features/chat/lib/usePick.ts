import type { AgentId } from '@bspace-sdlc-app/shared';
import { setAgentModel } from '@/shared/lib/ipc';
import { applyStep, routeStart, DEFAULT_ACCOUNT, MULTI_ACCOUNT, useAccounts, useFailover } from '@/features/agents';
import { useApp } from '@/shared/state/app';
import { useChat } from '@/features/chat/state/chat';

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
