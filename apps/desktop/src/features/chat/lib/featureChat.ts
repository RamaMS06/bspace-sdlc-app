import type { AgentId, MessagePart, Project } from '@bspace-sdlc-app/shared';
import { SDLC_STAGES } from '@/features/sdlc';
import { createChat, listChats } from '@/shared/lib/ipc';
import { useApp } from '@/shared/state/app';
import { useChat } from '@/features/chat/state/chat';

/** The feature's chat: its newest one, or a new one. */
export async function featureChat(project: Project, agent: AgentId): Promise<string> {
  const chats = await listChats(project.id).catch(() => []);
  if (chats.length) return chats[0]!.id;
  return (await createChat(project.id, agent, project.title)).id;
}

/**
 * Runs one SDLC stage for a feature: opens its chat and asks the agent to run that stage's skill. The
 * message is a job, so the Workflow screen follows it (working, needs you, done).
 */
export async function runStage(project: Project, stage: number, agent: AgentId, visible: string): Promise<void> {
  const s = SDLC_STAGES[stage];
  if (!s) return;
  const chatId = await featureChat(project, agent);
  useApp.getState().navigate({ name: 'chat', chatId });
  const shown: MessagePart[] = [{ type: 'text', text: visible }];
  void useChat.getState().send(chatId, shown, {
    agentId: agent,
    job: { projectId: project.id, title: project.title },
    // The skill instruction stays in English for the agent; the user sees their own words.
    promptParts: [{ type: 'text', text: `${s.ask}\n\n(${visible})` }],
  });
}
