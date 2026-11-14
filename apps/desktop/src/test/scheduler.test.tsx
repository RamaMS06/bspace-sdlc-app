import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { sendTestNotification } from '@/lib/scheduler';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';

const notified = () =>
  vi.mocked(invoke).mock.calls.map(([cmd, args]) => {
    expect(cmd).toBe('plugin:notification|notify');
    expect((args as { options: { title: string } }).options.title).toBe('BSpace SDLC');
    return (args as { options: { body: string } }).options.body;
  });

beforeEach(() => {
  vi.clearAllMocks();
  setUiLanguage('en');
  useApp.setState({ notificationsBlocked: false });
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe('notifications', () => {
  it('the test notification sends one, or flags the banner on a denial', async () => {
    await expect(sendTestNotification()).resolves.toBe(true);
    expect(notified()).toEqual(['This is a test notification. If you can read it, agent notifications will reach you.']);
    vi.mocked(invoke).mockClear();
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('denied');
    await expect(sendTestNotification()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(useApp.getState().notificationsBlocked).toBe(true);
  });

  it('asks for permission the first time and sends once it is granted', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('granted');
    await expect(sendTestNotification()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(notified()).toHaveLength(1);
    expect(useApp.getState().notificationsBlocked).toBe(false);
  });
});
