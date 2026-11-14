import { create } from 'zustand';
import type { UsageResponse } from '@bspace-sdlc-app/shared';
import { cloudErrorCode, cloudUsage, type CloudErrorCode } from '@/features/usage/lib/cloud';

/** Refresh this often while the app is open, so the sidebar's credits follow what agents spend. */
export const BUMA_USAGE_EVERY_MS = 5 * 60 * 1000;

interface BumaUsageState {
  /** The signed-in account's AI credits; null signed out or not loaded yet. */
  usage: UsageResponse | null;
  error: CloudErrorCode | null;
  loading: boolean;
  /** Fetches it again (the user's refresh). */
  load(): Promise<void>;
  /** Signed out: forget it. */
  clear(): void;
}

/**
 * The Buma account's usage, shared by the status bar and Settings › Usage, so one
 * fetch updates all of them.
 */
export const useBumaUsage = create<BumaUsageState>((set) => ({
  usage: null,
  error: null,
  loading: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ usage: await cloudUsage(), loading: false });
    } catch (e) {
      set({ error: cloudErrorCode(e), loading: false });
    }
  },
  clear: () => set({ usage: null, error: null, loading: false }),
}));
