import { invoke } from '@tauri-apps/api/core';

export type ShareRole = 'viewer' | 'contributor';

export interface ShareInvite {
  email: string;
  role: ShareRole;
  at: string;
}

/** A feature shared as an Azure DevOps repo, and who was invited to it (see src-tauri/src/domain/share.rs). */
export interface ShareInfo {
  org: string;
  project: string;
  projectId: string;
  repoId: string;
  repoName: string;
  webUrl: string;
  remoteUrl: string;
  invites: ShareInvite[];
}

export interface AzProject {
  id: string;
  name: string;
}

export interface InviteResult {
  info: ShareInfo;
  addedToOrg: boolean;
  orgNote: string | null;
}

export const shareStatus = (projectId: string) => invoke<ShareInfo | null>('share_status', { projectId });
export const shareProjects = () => invoke<AzProject[]>('share_projects');
export const shareInvite = (projectId: string, azureProject: AzProject | null, email: string, role: ShareRole) =>
  invoke<InviteResult>('share_invite', { projectId, azureProject, email, role });
export const shareRevoke = (projectId: string, email: string) => invoke<ShareInfo>('share_revoke', { projectId, email });
