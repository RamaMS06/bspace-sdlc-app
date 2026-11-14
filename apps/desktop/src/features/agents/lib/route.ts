import type { AgentId } from '@bspace-sdlc-app/shared';
import { setAgentModel } from '@/shared/lib/ipc';
import { DEFAULT_ACCOUNT, MULTI_ACCOUNT, useAccounts } from '@/features/agents/state/accounts';
import { useApp } from '@/shared/state/app';
import { useFailover, type Step } from '@/features/agents/state/failover';

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
