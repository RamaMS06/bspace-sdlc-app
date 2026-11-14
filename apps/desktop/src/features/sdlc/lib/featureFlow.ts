import type { Project } from '@bspace-sdlc-app/shared';
import { BUILTIN_SKILLS, buildProjectBrief } from '@bspace-sdlc-app/skills';
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

/**
 * A message that starts with a bundled SDLC skill (`/using-bspace-sdlc ...`, `/blueprint-ftsd ...`) starts
 * a feature. Returns the words after the skill (the feature's name), or null for any other message.
 */
export function sdlcStart(text: string): string | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m || !BUILTIN_SKILLS.some((s) => s.id === m[1])) return null;
  return (m[2] ?? '').trim().slice(0, 48);
}
