import type { Project } from '@bspace-sdlc-app/shared';
import { buildProjectBrief } from '@bspace-sdlc-app/skills';
import { track } from '@/shared/lib/analytics';
import { createProject } from '@/shared/lib/ipc';
import { useApp } from '@/shared/state/app';

/** A feature is a project: its own folder (where the skills write intent/, sdlc/, specs/) and its chat. */
export async function createFeature(title: string): Promise<Project> {
  const name = title.trim();
  const project = await createProject({ title: name }, buildProjectBrief({ title: name, folder: '' }));
  useApp.getState().bumpProjects();
  track('feature created', {});
  return project;
}

/** The one skill that starts a workflow. Every other skill runs in the chat it is typed in. */
export const WORKFLOW_SKILL = 'using-bspace-sdlc';

/**
 * Only a message that starts with `/using-bspace-sdlc` starts a feature (a workflow of its own, with its
 * folder). Any other message, a chat with no link to a skill, or another skill (`/blueprint-ftsd ...`),
 * never creates one. Returns the words after the skill (the feature's name), or null for any other message.
 */
export function sdlcStart(text: string): string | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m || m[1] !== WORKFLOW_SKILL) return null;
  return (m[2] ?? '').trim().slice(0, 48);
}
