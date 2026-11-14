import { create } from 'zustand';
import { onAgentAction } from '@/lib/events';
import { getChat, readProjectFile } from '@/lib/ipc';

/**
 * The Agent Office of the bspace-sdlc-skills plugin (its office_state.py hook): which phase each feature
 * is in, its agents and what they say, the units of work and the activity log. Inside the app the hook
 * sends every update straight here (POST /office → `office_state` action); the copy it writes to
 * `.office/office.json` is read when nothing has arrived yet (after a restart).
 */
export type OfficePhase = 'brainstorm' | 'design' | 'slice' | 'verify' | 'close';
export type OfficePhaseState = 'done' | 'active' | 'blocked' | 'todo';

export interface OfficeAgent {
  id: string;
  role: string;
  room?: OfficePhase;
  unit?: string;
  mode?: string;
  err?: string;
  say?: string;
}

export interface OfficeUnit {
  id: string;
  who: string;
  status: string;
  note?: string;
  metric?: unknown;
  ask?: string;
}

export interface OfficeState {
  intent?: string | null;
  /** Seconds since the epoch, when the hook wrote it. */
  t?: number;
  phases: Partial<Record<OfficePhase, OfficePhaseState>>;
  units?: OfficeUnit[];
  agents?: OfficeAgent[];
  /** [time, who, text, bad] */
  log?: [string, string, string, boolean][];
}

const isState = (v: unknown): v is OfficeState => !!v && typeof v === 'object' && 'phases' in v;

interface OfficeStore {
  /** The newest state per project. */
  byProject: Record<string, OfficeState>;
  listen(): void;
  /** Reads `.office/office.json` of a project when nothing newer arrived. */
  load(projectId: string): Promise<void>;
}

let listening = false;
const chatProject = new Map<string, string | null>();

export const useOffice = create<OfficeStore>((set, get) => ({
  byProject: {},
  listen() {
    if (listening) return;
    listening = true;
    void onAgentAction(async (a) => {
      if (a.name !== 'office_state' || !isState(a.context)) return;
      let projectId = chatProject.get(a.chatId);
      if (projectId === undefined) {
        projectId = (await getChat(a.chatId).catch(() => null))?.projectId ?? null;
        chatProject.set(a.chatId, projectId);
      }
      if (projectId) set((s) => ({ byProject: { ...s.byProject, [projectId]: a.context as unknown as OfficeState } }));
    }).catch(() => {
      listening = false;
    });
  },
  async load(projectId) {
    try {
      const f = await readProjectFile(projectId, '.office/office.json');
      if (f.kind !== 'text' || !f.text) return;
      const state: unknown = JSON.parse(f.text);
      if (!isState(state)) return;
      const have = get().byProject[projectId];
      if (have && (have.t ?? 0) >= (state.t ?? 0)) return;
      set((s) => ({ byProject: { ...s.byProject, [projectId]: state } }));
    } catch {
      /* no office yet */
    }
  },
}));
