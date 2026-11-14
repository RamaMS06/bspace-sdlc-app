import type { AgentId, MessagePart, Project, Settings } from '@bspace-sdlc-app/shared';
import { BUILTIN_SKILLS, buildProjectBrief } from '@bspace-sdlc-app/skills';
import { SDLC_STAGES } from '@/components/SdlcWorkflow';
import { track } from '@/lib/analytics';
import { createChat, createProject, listChats } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

/**
 * A feature is a project: its own folder (where the skills write intent/, sdlc/, specs/) and its chat.
 * The project's video fields are filled with neutral values; the SDLC app doesn't use them.
 */
export async function createFeature(title: string, settings: Pick<Settings, 'format' | 'language' | 'fps' | 'frameCheck'>): Promise<Project> {
  const input = { title: title.trim(), kind: 'explainer' as const, format: settings.format, language: settings.language };
  const draft = {
    ...input,
    id: '',
    slug: '',
    folder: '',
    status: 'draft' as const,
    styleId: null,
    scheduledAt: null,
    reviewState: 'none' as const,
    postedAt: null,
    remindedAt: null,
    reviewRemindedAt: null,
    durationSec: null,
    createdAt: '',
    updatedAt: '',
  } satisfies Project;
  const project = await createProject(input, buildProjectBrief(draft));
  useApp.getState().bumpProjects();
  track('feature created', {});
  return project;
}

/**
 * A message that starts with a bundled SDLC skill (`/using-bspace-sdlc ...`, `/blueprint-ftsd ...`) starts
 * a feature. Returns the words after the skill (the feature's name), or null for any other message.
 */
export function sdlcStart(text: string): string | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m || !BUILTIN_SKILLS.some((s) => s.id === m[1])) return null;
  return (m[2] ?? '').trim().slice(0, 48);
}

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
