import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { i18n } from '@/i18n';
import { useApp } from '@/shared/state/app';

/** Whether notifications may show, asking the first time. */
export async function canNotify(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

/**
 * Shows a system notification. Called through the plugin's command (not `sendNotification`, which fires
 * and forgets) so a failure can be caught. Note: on desktop the plugin always reports permission as
 * granted, so a user who turned Buma's notifications off in the OS is not detected; Settings has a test
 * button for that.
 */
export async function show(body: string): Promise<void> {
  await invoke('plugin:notification|notify', { options: { title: i18n.t('reminders.title'), body } });
}

/** Settings' test button: sends a notification now. Returns false when the system reports a denial. */
export async function sendTestNotification(): Promise<boolean> {
  const granted = await canNotify();
  useApp.getState().setNotificationsBlocked(!granted);
  if (!granted) return false;
  await show(i18n.t('reminders.test'));
  return true;
}
