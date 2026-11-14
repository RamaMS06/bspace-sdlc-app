import { create } from 'zustand';
import { devopsMicrosoftSignIn, devopsSignIn, devopsSignOut, devopsStatus, type DevopsStatus } from '@/features/devops/lib/devops';

interface DevopsState {
  status: DevopsStatus | null;
  /** Signing in: with a token (`pat`) or through Microsoft's page in the browser (`microsoft`). */
  busy: false | 'pat' | 'microsoft';
  error: string | null;
  init(): Promise<DevopsStatus>;
  signIn(org: string, pat: string): Promise<boolean>;
  signInMicrosoft(org: string): Promise<boolean>;
  signOut(): Promise<void>;
}

/** The Azure DevOps sign-in. The app does not open without it (App.tsx sends the user to onboarding). */
export const useDevops = create<DevopsState>((set) => ({
  status: null,
  busy: false,
  error: null,
  async init() {
    const status = await devopsStatus();
    set({ status });
    return status;
  },
  async signIn(org, pat) {
    set({ busy: 'pat', error: null });
    try {
      set({ status: await devopsSignIn(org, pat), busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
  async signInMicrosoft(org) {
    set({ busy: 'microsoft', error: null });
    try {
      set({ status: await devopsMicrosoftSignIn(org), busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
  async signOut() {
    set({ status: await devopsSignOut(), error: null });
  },
}));

/** Whether the signed-in account is an admin: it can edit the SDLC plugin; everyone else can use it. */
export const useIsAdmin = () => useDevops((s) => !!s.status?.admin);
