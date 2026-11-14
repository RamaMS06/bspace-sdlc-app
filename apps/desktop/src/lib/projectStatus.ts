import type { MessagePart, ProjectStatus } from '@bspace-sdlc-app/shared';
import { setProjectStatus } from '@/lib/ipc';
import { useApp } from '@/state/app';

const RANK: Record<ProjectStatus, number> = { draft: 0, building: 1 };

/** Tool kinds that change the project: the agent has started building once one of them finished. */
const WORK_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/** A finished tool call that edited, deleted or moved files, or ran a command. */
export const isWorkTool = (p: MessagePart) => p.type === 'tool' && p.status === 'done' && !!p.toolKind && WORK_KINDS.has(p.toolKind);

/** The status each project is known to have in this app session; a move to it or behind it asks nothing. */
const known = new Map<string, ProjectStatus>();
/** Remembers a status, never lower than one already known. */
const remember = (id: string, status: ProjectStatus) => {
  const at = known.get(id);
  if (!at || RANK[status] > RANK[at]) known.set(id, status);
};
const moving = new Map<string, Promise<void>>();

/**
 * Moves a project forward to `status` (Rust never moves it back) and refreshes the project lists.
 * Best effort: a failure is tried again on the next call. Never throws.
 */
export function advanceProject(projectId: string, status: 'building'): Promise<void> {
  const at = known.get(projectId);
  if (at && RANK[at] >= RANK[status]) return Promise.resolve();
  const key = `${projectId}:${status}`;
  const running = moving.get(key);
  if (running) return running;
  const run = (async () => {
    try {
      const project = await setProjectStatus(projectId, status);
      remember(projectId, project.status);
      useApp.getState().bumpProjects();
    } catch {
      /* the step bar is best effort: a chat or a job never breaks over it */
    }
  })().finally(() => moving.delete(key));
  moving.set(key, run);
  return run;
}

/** For tests: forget what is known. */
export const resetProjectStatus = () => {
  known.clear();
  moving.clear();
};
