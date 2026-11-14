import { create } from 'zustand';
import type { AgentId } from '@bspace-sdlc-app/shared';
import { createChat, setChatFolder } from '@/shared/lib/ipc';
import { useChat } from '@/features/chat/state/chat';

/**
 * Folders the user attached to chats (composer › Add folder). Each folder is a group in the sidebar,
 * titled with the folder's name, that can be shown or hidden, lists its chats, and starts a new chat
 * already attached to it. The agent of an attached chat works in that folder (Rust: chats.folder).
 */
export interface FolderGroup {
  path: string;
  title: string;
  open: boolean;
  chats: { id: string; title: string }[];
}

interface FoldersState {
  groups: FolderGroup[];
  /** The folder attached to each chat. */
  byChat: Record<string, string>;
  attach(chatId: string, path: string, chatTitle: string): Promise<void>;
  detach(chatId: string): Promise<void>;
  toggle(path: string): void;
  /** Removes a folder group from the sidebar (its chats stay attached). */
  remove(path: string): void;
  /** A new chat, already attached to `path`. Resolves to its id. */
  newChat(path: string, agent: AgentId, title: string): Promise<string>;
}

const KEY = 'buma.folders';
export const folderTitle = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function load(): Pick<FoldersState, 'groups' | 'byChat'> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Pick<FoldersState, 'groups' | 'byChat'> | null;
    if (raw && Array.isArray(raw.groups) && raw.byChat && typeof raw.byChat === 'object') return raw;
  } catch {
    /* nothing saved */
  }
  return { groups: [], byChat: {} };
}

export const useFolders = create<FoldersState>((set, get) => {
  const save = (patch: Partial<Pick<FoldersState, 'groups' | 'byChat'>>) => {
    set(patch);
    try {
      localStorage.setItem(KEY, JSON.stringify({ groups: get().groups, byChat: get().byChat }));
    } catch {
      /* storage off: kept for this session */
    }
  };
  return {
    ...load(),
    async attach(chatId, path, chatTitle) {
      await setChatFolder(chatId, path);
      // A running agent keeps its old folder: the next message starts it in the new one.
      if (useChat.getState().started[chatId] && !useChat.getState().streaming[chatId]) await useChat.getState().stop(chatId);
      const groups = get().groups.map((g) => ({ ...g, chats: g.chats.filter((c) => c.id !== chatId) }));
      const at = groups.findIndex((g) => g.path === path);
      const entry = { id: chatId, title: chatTitle };
      if (at === -1) groups.unshift({ path, title: folderTitle(path), open: true, chats: [entry] });
      else groups[at] = { ...groups[at]!, open: true, chats: [entry, ...groups[at]!.chats] };
      save({ groups, byChat: { ...get().byChat, [chatId]: path } });
    },
    async detach(chatId) {
      await setChatFolder(chatId, null);
      if (useChat.getState().started[chatId] && !useChat.getState().streaming[chatId]) await useChat.getState().stop(chatId);
      const { [chatId]: _gone, ...byChat } = get().byChat;
      save({ byChat, groups: get().groups.map((g) => ({ ...g, chats: g.chats.filter((c) => c.id !== chatId) })) });
    },
    toggle(path) {
      save({ groups: get().groups.map((g) => (g.path === path ? { ...g, open: !g.open } : g)) });
    },
    remove(path) {
      save({ groups: get().groups.filter((g) => g.path !== path) });
    },
    async newChat(path, agent, title) {
      const chat = await createChat(null, agent, title);
      useChat.getState().rememberChat(chat);
      await get().attach(chat.id, path, title);
      return chat.id;
    },
  };
});
