import type { AgentId, Project } from '@bspace-sdlc-app/shared';
import type { SendOpts } from '@/features/chat/state/chat';

/** What every send in a project chat carries: its agent and its build job. */
export function projectSendOptions(project: Pick<Project, 'id' | 'title'> | null, agentId: AgentId): SendOpts {
  return {
    job: project ? { projectId: project.id, title: project.title } : undefined,
    agentId,
  };
}
