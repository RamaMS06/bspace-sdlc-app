import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-notification', () => ({ isPermissionGranted: vi.fn().mockResolvedValue(true) }));
vi.mock('@/features/skills/lib/plugins', () => ({ pluginSyncCheck: vi.fn(), pluginSyncApply: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { pluginSyncCheck } from '@/features/skills/lib/plugins';
import { usePluginSync } from '@/features/skills/state/pluginSync';
import '@/i18n';

const sent = () => vi.mocked(invoke).mock.calls.map((c) => (c[1] as { options: { title: string; body: string } }).options);
const ahead = { current: '1.0.8', latest: '1.0.9', commit: 'c', newer: true };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePluginSync.setState({ status: null, checking: false, applying: false, checkedAt: null, error: null, updatedTo: null });
});

describe('plugin update notification', () => {
  it('tells the user once when main gets ahead, not on every check', async () => {
    vi.mocked(pluginSyncCheck).mockResolvedValue(ahead);
    await usePluginSync.getState().check();
    await usePluginSync.getState().check();
    await usePluginSync.getState().check(true);
    expect(sent()).toEqual([{ title: 'SDLC plugin update', body: 'Version 1.0.9 is ready. Open Skills › Plugins and press Sync.' }]);
    // A newer version after that is news again.
    vi.mocked(pluginSyncCheck).mockResolvedValue({ ...ahead, latest: '1.0.10' });
    await usePluginSync.getState().check();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]!.body).toContain('1.0.10');
  });

  it('says nothing when main is not ahead or cannot be read', async () => {
    vi.mocked(pluginSyncCheck).mockResolvedValueOnce({ ...ahead, newer: false });
    await usePluginSync.getState().check();
    vi.mocked(pluginSyncCheck).mockRejectedValueOnce('offline');
    await usePluginSync.getState().check();
    expect(invoke).not.toHaveBeenCalled();
  });
});
