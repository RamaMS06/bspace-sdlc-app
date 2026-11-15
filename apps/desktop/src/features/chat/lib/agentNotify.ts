import { i18n } from '@/i18n';
import { listRecentChats } from '@/shared/lib/ipc';
import { systemNotify } from '@/shared/lib/systemNotify';
import { useApp } from '@/shared/state/app';

/** What happened in a chat that is worth a system notification. */
export type AgentEvent = 'done' | 'asks' | 'permission' | 'failed';

/** The user is looking at this chat right now: the window has focus and the chat is open. */
function watching(chatId: string): boolean {
  const route = useApp.getState().route;
  const open = route.name === 'chat' && route.chatId === chatId;
  return open && typeof document !== 'undefined' && document.hasFocus();
}

/** The chat's name as the sidebar shows it: its feature's title, else its own. */
async function chatName(chatId: string): Promise<string | null> {
  try {
    const c = (await listRecentChats(50)).find((r) => r.id === chatId);
    return c ? (c.projectTitle ?? c.title) : null;
  } catch {
    return null;
  }
}

/**
 * Tells the user, with a system notification, that an agent finished, is waiting for them to pick
 * something, or asks to run a command, unless they are already looking at that chat. Never asks for
 * the permission itself; never throws.
 */
export async function notifyAgent(chatId: string, event: AgentEvent): Promise<void> {
  if (watching(chatId)) return;
  const name = (await chatName(chatId)) ?? i18n.t('agentNotify.aChat');
  await systemNotify(i18n.t(`agentNotify.${event}.title`), i18n.t(`agentNotify.${event}.body`, { name }));
}
