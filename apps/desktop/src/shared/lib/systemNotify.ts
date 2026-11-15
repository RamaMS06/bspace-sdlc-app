import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';

/**
 * Shows a system notification (the operating system's own: Windows puts it at the bottom right, macOS at
 * the top right, and it follows the user's Do Not Disturb and per-app settings). Never asks for the
 * permission itself and never throws: a missed notification is not worth an error.
 */
export async function systemNotify(title: string, body: string): Promise<void> {
  try {
    if (!(await isPermissionGranted())) return;
    await invoke('plugin:notification|notify', { options: { title, body } });
  } catch {
    /* ignored */
  }
}
