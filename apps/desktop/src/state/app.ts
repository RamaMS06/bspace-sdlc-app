import { create } from 'zustand';
import type { Settings } from '@bspace-sdlc-app/shared';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect' }
  | { name: 'requirements' }
  /** Onboarding's last, required step: sign in to Azure DevOps. */
  | { name: 'onboarding-account' }
  | { name: 'chat-new'; styleId?: string }
  | {
      name: 'chat';
      chatId: string;
      /** Prefilled in the composer, never sent. */
      draft?: string;
      /** A chat without a project that New chat started from a template on the Style screen. */
      styleId?: string;
    }
  /** The SDLC in one place: every feature, its pipeline and its agent. */
  | { name: 'workflow' }
  /** An older name of the Workflow screen. */
  | { name: 'features' }
  /** The AI platforms in use (Provider) and what they used (Usage). */
  | { name: 'agents'; tab?: 'usage' | 'provider' | 'combo' }
  /** The skills agents use: the built-in one and the user's own. */
  | { name: 'skills' }
  | { name: 'settings'; /** The tab to open on (Settings' own id). */ tab?: string };

/** How many screens Back and Forward remember. */
const HISTORY = 50;
const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

/** Asked before every navigation while set; returning false keeps the current screen (it asks the user itself). */
export type LeaveGuard = (next: Route) => boolean;

interface AppState {
  route: Route;
  navigate(r: Route): void;
  /** Screens visited before and after the current one, for the title bar's Back and Forward. */
  past: Route[];
  future: Route[];
  back(): void;
  forward(): void;
  leaveGuard: LeaveGuard | null;
  setLeaveGuard(guard: LeaveGuard | null): void;
  settings: Settings | null;
  setSettings(s: Settings): void;
  needsYouCount: number;
  /** The chat New chat started last in this app session: Chat goes back to it while it runs. */
  newChatId: string | null;
  /** The chat New chat just handed its first message to: its composer takes the focus over. */
  focusChatId: string | null;
  /** Bumped when a project is created so the sidebar's Recent list refreshes. */
  projectsVersion: number;
  bumpProjects(): void;
  /** Set when a reminder was due but the system denied notifications; the Calendar explains it. */
  notificationsBlocked: boolean;
  setNotificationsBlocked(blocked: boolean): void;
}

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'welcome' },
  navigate: (route) => {
    const guard = get().leaveGuard;
    if (guard && !guard(route)) return;
    const from = get().route;
    if (sameRoute(from, route)) return set({ route });
    set({ route, past: [...get().past, from].slice(-HISTORY), future: [] });
  },
  past: [],
  future: [],
  back: () => {
    const { past, route, leaveGuard } = get();
    const to = past.at(-1);
    if (!to || (leaveGuard && !leaveGuard(to))) return;
    set({ route: to, past: past.slice(0, -1), future: [route, ...get().future].slice(0, HISTORY) });
  },
  forward: () => {
    const { future, route, leaveGuard } = get();
    const to = future[0];
    if (!to || (leaveGuard && !leaveGuard(to))) return;
    set({ route: to, future: future.slice(1), past: [...get().past, route].slice(-HISTORY) });
  },
  leaveGuard: null,
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  needsYouCount: 0,
  newChatId: null,
  focusChatId: null,
  projectsVersion: 0,
  bumpProjects: () => set((s) => ({ projectsVersion: s.projectsVersion + 1 })),
  notificationsBlocked: false,
  setNotificationsBlocked: (notificationsBlocked) => set({ notificationsBlocked }),
}));
