import { invoke } from '@tauri-apps/api/core';

/** The Azure DevOps account the app is signed in with (see src-tauri/src/devops.rs). Never the token. */
export interface DevopsProfile {
  org: string;
  id: string;
  displayName: string;
  email: string | null;
}

export interface DevopsStatus {
  signedIn: boolean;
  /** The account is an admin: it can edit the SDLC plugin (src-tauri/src/domain/admin.rs decides). */
  admin?: boolean;
  profile: DevopsProfile | null;
}

/** BUMA's organization, offered by default. */
export const DEFAULT_DEVOPS_ORG = 'buma';

/** Where a user creates a personal access token for `org`. */
export const tokensUrl = (org: string) => `https://dev.azure.com/${encodeURIComponent(org || DEFAULT_DEVOPS_ORG)}/_usersSettings/tokens`;

export const devopsStatus = () => invoke<DevopsStatus>('devops_status');
export const devopsSignIn = (org: string, pat: string) => invoke<DevopsStatus>('devops_sign_in', { org, pat });
/** Sign in with Microsoft through the Azure CLI (opens the browser); waits until it finishes. */
export const devopsMicrosoftSignIn = (org: string) => invoke<DevopsStatus>('devops_microsoft_sign_in', { org });
export const devopsSignOut = () => invoke<DevopsStatus>('devops_sign_out');
