import { useEffect } from 'react';
import { create } from 'zustand';
import { i18n } from '@/i18n';
import { systemNotify } from '@/shared/lib/systemNotify';
import { pluginSyncApply, pluginSyncCheck, type PluginInfo, type SyncStatus } from '@/features/skills/lib/plugins';

/** How often the app asks `main` for a newer plugin while it is open. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface PluginSyncState {
  status: SyncStatus | null;
  checking: boolean;
  applying: boolean;
  /** When the last check succeeded. */
  checkedAt: number | null;
  /** Why the last check or update failed; a background check never sets it. */
  error: string | null;
  /** The version the user just updated to (for the "updated" note). */
  updatedTo: string | null;
  check(manual?: boolean): Promise<void>;
  apply(): Promise<PluginInfo[] | null>;
}

const NOTIFIED_KEY = 'buma.pluginNotified';

/** A system notification the first time a version is seen ahead: not on every check, and not when asked by hand. */
function notifyOnce(status: SyncStatus) {
  if (!status.newer || !status.latest) return;
  try {
    if (localStorage.getItem(NOTIFIED_KEY) === status.latest) return;
    localStorage.setItem(NOTIFIED_KEY, status.latest);
  } catch {
    /* no storage: it may repeat, which is harmless */
  }
  void systemNotify(i18n.t('plugins.sync.notifyTitle'), i18n.t('plugins.sync.notifyBody', { version: status.latest }));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const usePluginSync = create<PluginSyncState>((set, get) => ({
  status: null,
  checking: false,
  applying: false,
  checkedAt: null,
  error: null,
  updatedTo: null,
  async check(manual = false) {
    if (get().checking || get().applying) return;
    set({ checking: true, ...(manual ? { error: null } : {}) });
    try {
      const status = await pluginSyncCheck();
      set({ status, checkedAt: Date.now(), error: null });
      notifyOnce(status);
    } catch (e) {
      // Offline or no access in the background is not worth a warning; asked by hand, it is.
      if (manual) set({ error: message(e) });
    } finally {
      set({ checking: false });
    }
  },
  async apply() {
    if (get().applying) return null;
    const before = get().status?.current ?? null;
    set({ applying: true, error: null, updatedTo: null });
    try {
      // Asks main again and installs what is ahead; nothing happens when the version in use is current.
      const list = await pluginSyncApply();
      const status = await pluginSyncCheck();
      set({ status, checkedAt: Date.now(), updatedTo: status.current && status.current !== before ? status.current : null });
      return list;
    } catch (e) {
      set({ error: message(e) });
      return null;
    } finally {
      set({ applying: false });
    }
  },
}));

/** Looks for a newer plugin when it mounts and every few hours after, while the app is open. */
export function usePluginUpdateWatch() {
  useEffect(() => {
    void usePluginSync.getState().check();
    const timer = setInterval(() => void usePluginSync.getState().check(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
}
