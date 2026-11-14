import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, Chat, PermissionRequest, Project, Settings } from '@bspace-sdlc-app/shared';

vi.mock('@/shared/lib/ipc', () => ({
  listProjects: vi.fn(),
  listSkills: vi.fn(async () => []),
  pickFolder: vi.fn(async () => null),
  setChatFolder: vi.fn(),
  projectFiles: vi.fn(async () => []),
  findProjectFiles: vi.fn(async () => []),
  readProjectFile: vi.fn(),
  createProject: vi.fn(),
  setProjectStatus: vi.fn(),
  listChats: vi.fn(),
  getChat: vi.fn(),
  createChat: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  agentStart: vi.fn(),
  agentSetAuto: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentFailoverRecord: vi.fn().mockResolvedValue(undefined),
  setAgentModel: vi.fn().mockResolvedValue(null),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  getSettings: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  attachFile: vi.fn(),
  detectAgents: vi.fn(),
  updateChatAgent: vi.fn(),
  assetUrl: (p: string) => p,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

type UpdateCb = (e: { chatId: string; update: AgentUpdate }) => void;
type PermCb = (r: PermissionRequest) => void;
const handlers: { update: UpdateCb[]; perm: PermCb[] } = { update: [], perm: [] };
vi.mock('@/shared/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(async (cb: UpdateCb) => {
    handlers.update.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async (cb: PermCb) => {
    handlers.perm.push(cb);
    return () => {};
  }),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import * as ipc from '@/shared/lib/ipc';
import { ChatRoute } from '@/features/chat/screens/ChatRoute';
import { ChatProject } from '@/features/chat/screens/ChatProject';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/shared/state/app';
import { buildRecap, useChat } from '@/features/chat/state/chat';
import { useFailover } from '@/features/agents/state/failover';
import { useUsage } from '@/features/usage/state/usage';
import { StatusBar } from '@/app/layout/StatusBar';

/** Attaching files through the composer's + menu. */
async function attachFiles(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add files, a folder or a skill' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Add files' }));
}
/** The composer's mode menu (Ask, Accept edits, Plan, Auto, Bypass). */
const MODE = /^Mode: /;
/** Switches between Ask and Auto through the mode menu, as the old Auto toggle did. */
async function toggleAuto(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: MODE });
  const wasAuto = trigger.getAttribute('aria-label') === 'Mode: Auto';
  await user.click(trigger);
  await user.click(await screen.findByRole('menuitemradio', { name: new RegExp(`^${wasAuto ? 'Ask' : 'Auto'}`) }));
}

/** What the agent got, without the session facts line a new session starts with. */
const noFacts = <T,>(parts: T[]): T[] =>
  parts.filter((p) => !String((p as { text?: unknown }).text ?? '').includes('local time zone is'));


const settings: Settings = {
  workingFolder: '/tmp/Buma',
  defaultAgent: 'claude',
  onboarded: true,
  apiUrl: 'https://bspace.buma.internal/api',
  installId: '',
  shareInstallStats: true,
  autoMode: false,
  lastPingAt: null,
  uiLanguage: null,
  backgroundMode: false,
  openAtLogin: false,
  agentModels: {},
};

const mk = (id: string, title: string): Project => ({
  id,
  title,
  slug: id,
  folder: `/tmp/Buma/${id}`,
  status: 'building',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

const projects = [mk('p1', 'Kenapa rupiah melemah?'), mk('p2', 'Sejarah singkat QRIS')];
const chat = (id: string, projectId: string | null): Chat => ({
  id,
  projectId,
  agentId: 'claude',
  title: 'chat',
  createdAt: '2026-11-01T00:00:00Z',
});

const emit = (chatId: string, update: AgentUpdate) =>
  act(async () => {
    handlers.update.forEach((cb) => cb({ chatId, update }));
  });

beforeEach(() => {
  vi.clearAllMocks();
  handlers.update.length = 0;
  handlers.perm.length = 0;
  useChat.getState().reset();
  useApp.setState({ settings, route: { name: 'chat-new' } });
  vi.mocked(ipc.listProjects).mockResolvedValue(projects);
  // Same filter as Rust: a project id lists that project's chats, none lists chats without one.
  const allChats = [chat('c1', 'p1'), chat('c0', null)];
  vi.mocked(ipc.listChats).mockImplementation(async (projectId) =>
    allChats.filter((c) => c.projectId === (projectId ?? null)),
  );
  vi.mocked(ipc.getChat).mockImplementation(async (id) => allChats.find((c) => c.id === id) ?? null);
  vi.mocked(ipc.listMessages).mockResolvedValue([]);
  vi.mocked(ipc.createChat).mockResolvedValue(chat('c-new', null));
  vi.mocked(ipc.addMessage).mockImplementation(async (chatId, role, parts) => ({
    id: `m-${Math.random()}`,
    chatId,
    role,
    parts,
    createdAt: '',
  }));
  vi.mocked(ipc.agentStart).mockResolvedValue(false);
  vi.mocked(ipc.agentPrompt).mockResolvedValue();
  vi.mocked(ipc.agentRespondPermission).mockResolvedValue();
});

describe('ChatNew', () => {
  it('centres with my-auto, not justify-center, so an overflowing conversation keeps its top reachable', () => {
    const { container } = render(<ChatRoute />);
    const scroller = container.querySelector('.no-scrollbar')!;
    expect(scroller.className).not.toContain('justify-center');
    expect(scroller.firstElementChild!.className).toContain('my-auto');
  });

  it('shows project titles after typing @ and inserts a chip on Enter', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    expect(await screen.findByText('No feature attached')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Bikin versi 15 detik dari @');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Kenapa rupiah melemah?')).toBeInTheDocument();
    expect(within(list).getByText('Sejarah singkat QRIS')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('1 feature attached')).toBeInTheDocument();
    expect(screen.getByText('@Kenapa rupiah melemah?')).toBeInTheDocument();
  });

  it('sends without a mention part and without any project info', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'halo');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.createChat).toHaveBeenCalledWith(null, 'claude', expect.any(String));
    const [chatId, parts] = vi.mocked(ipc.agentPrompt).mock.calls[0]!;
    expect(chatId).toBe('c-new');
    expect(parts.some((p) => p.type === 'mention')).toBe(false);
    expect(JSON.stringify(parts)).not.toContain('/tmp/Buma');
  });

  it('sends the project folder and brief when a feature is mentioned', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'remix @');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    expect(parts.some((p) => p.type === 'mention')).toBe(true);
    expect(JSON.stringify(parts)).toContain('/tmp/Buma/p1');
    // The agent knows a mentioned feature by its id.
    expect(JSON.stringify(parts)).toMatch(/Its Buma id is p1\./);
  });
});




describe('ChatProject', () => {
  it('renders the step bar and the feature pipeline', async () => {
    render(<ChatProject chatId="c1" />);
    expect(await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'SDLC progress' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'SDLC stages' })).toBeInTheDocument();
  });

  it('merges a text update sequence into one agent message', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude');
    await emit('c1', { kind: 'text', text: 'Okay, ' });
    await emit('c1', { kind: 'text', text: 'making it faster.' });
    expect(await screen.findByText('Okay, making it faster.')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-message')).toHaveLength(1);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(screen.getAllByTestId('agent-message')).toHaveLength(1);
  });

  it('merges thought chunks into one part, keeps tool kind and path, and persists them', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    await emit('c1', { kind: 'thought', text: 'Let me ' });
    await emit('c1', { kind: 'thought', text: 'think' });
    await emit('c1', { kind: 'tool', toolCallId: 't1', title: 'Read a.ts', status: 'done', toolKind: 'read', path: '/w/a.ts' });
    await emit('c1', { kind: 'text', text: 'Done' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    const parts = useChat.getState().messages.c1!.at(-1)!.parts;
    expect(parts).toEqual([
      { type: 'thought', text: 'Let me think' },
      { type: 'tool', toolCallId: 't1', title: 'Read a.ts', status: 'done', toolKind: 'read', path: '/w/a.ts' },
      { type: 'text', text: 'Done' },
    ]);
    expect(ipc.addMessage).toHaveBeenCalledWith('c1', 'agent', parts);
  });

  it('settles tools the agent never finished: done after a normal end, failed after a cancel or error', async () => {
    const run = async (end: AgentUpdate) => {
      useChat.getState().reset();
      const user = userEvent.setup();
      const view = render(<ChatProject chatId="c1" />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
      await emit('c1', { kind: 'tool', toolCallId: 't1', title: 'Run x', status: 'running', toolKind: 'execute' });
      await emit('c1', end);
      const msg = useChat.getState().messages.c1!.find((m) => m.role === 'agent')!;
      view.unmount();
      vi.clearAllMocks();
      return msg.parts.find((p) => p.type === 'tool') as { status: string };
    };
    expect((await run({ kind: 'done', stopReason: 'end_turn' })).status).toBe('done');
    expect((await run({ kind: 'done', stopReason: 'cancelled' })).status).toBe('failed');
    expect((await run({ kind: 'error', message: 'boom' })).status).toBe('failed');
  });

  it('starts with auto mode when Settings has it on, and the Auto toggle switches the running session', async () => {
    const user = userEvent.setup();
    useApp.setState({ settings: { ...settings, autoMode: true } });
    render(<ChatProject chatId="c1" />);
    const toggle = await screen.findByRole('button', { name: MODE });
    expect(toggle).toHaveAccessibleName('Mode: Auto');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude', true));
    // The mode can still change while the turn streams.
    expect(screen.getByRole('button', { name: MODE })).toBeEnabled();
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await toggleAuto(user);
    expect(ipc.agentSetAuto).toHaveBeenCalledWith('c1', false);
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
  });

  it('Auto is off by default and a chat that has not started just remembers the toggle', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    const toggle = await screen.findByRole('button', { name: MODE });
    expect(toggle).toHaveAccessibleName('Mode: Ask');
    await toggleAuto(user);
    expect(ipc.agentSetAuto).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude', true));
  });

  it('prefills the composer with a route draft without sending it', async () => {
    render(<ChatProject chatId="c1" draft="Buma was closed while you were working on this." />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    expect(box).toHaveValue('Buma was closed while you were working on this.');
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });

  it('a new-chat Auto choice does not leak into other chats, and moves to the chat it creates', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChatRoute />);
    await screen.findByRole('button', { name: MODE });
    await toggleAuto(user);
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Auto');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'halo');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c-new', 'claude', true));
    unmount();
    // Another chat starts from Settings, not from the New chat toggle.
    useChat.getState().reset();
    render(<ChatProject chatId="c1" />);
    expect(await screen.findByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
  });

  it('an unsent New chat toggle is dropped when the screen closes', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChatRoute />);
    await screen.findByRole('button', { name: MODE });
    await toggleAuto(user);
    expect(useChat.getState().pendingAuto).toBe(true);
    unmount();
    expect(useChat.getState().pendingAuto).toBeNull();
    render(<ChatProject chatId="c1" />);
    expect(await screen.findByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
  });

  it('the Auto toggle waits for the running session and follows its answer', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalled());
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    let finish!: () => void;
    vi.mocked(ipc.agentSetAuto).mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    await toggleAuto(user);
    // Pending: disabled, and the store has not moved yet.
    expect(screen.getByRole('button', { name: MODE })).toBeDisabled();
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: MODE })).toBeEnabled());
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Auto');
  });

  it('when leaving auto mode fails, the session is dropped, the error is shown and the next send starts with Auto off', async () => {
    const user = userEvent.setup();
    useApp.setState({ settings: { ...settings, autoMode: true } });
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude', true));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    vi.mocked(ipc.agentSetAuto).mockRejectedValueOnce(new Error('cannot leave auto'));
    await toggleAuto(user);
    expect(await screen.findByText(/Couldn't turn off Auto mode.*cannot leave auto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
    expect(useChat.getState().started['c1']).toBe(false);
    vi.mocked(ipc.agentStart).mockClear();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'again');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude'));
  });

  it('the Auto toggle follows Settings changes while it is open', async () => {
    render(<ChatProject chatId="c1" />);
    expect(await screen.findByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Ask');
    act(() => useApp.setState({ settings: { ...settings, autoMode: true } }));
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Auto');
  });

  it('the composer toolbar is icon-only, 32px buttons with labels and tooltips; the agent and the mode also show their names', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    const agent = await screen.findByRole('button', { name: 'Combo or model for this chat: Default' });
    const mention = screen.getByRole('button', { name: '@ Mention a feature' });
    const attach = screen.getByRole('button', { name: 'Add files, a folder or a skill' });
    for (const b of [agent, mention, attach]) expect(b).toHaveClass('size-8');
    for (const b of [mention, attach]) expect(b.textContent).toBe('');
    expect(agent.textContent).toContain('Default');
    const mode = screen.getByRole('button', { name: MODE });
    expect(mode).toHaveAccessibleName('Mode: Ask');
    expect(mode).toHaveTextContent('Ask');
    await toggleAuto(user);
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Auto');
    expect(screen.getByRole('button', { name: MODE })).toHaveClass('bg-primary-soft');
  });

  it('the mode menu offers Ask, Accept edits, Plan, Auto and Bypass, and Bypass is marked', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    await user.click(await screen.findByRole('button', { name: MODE }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent?.split(/[A-Z][a-z]+s /)[0])).toHaveLength(5);
    await user.click(screen.getByRole('menuitemradio', { name: /^Bypass/ }));
    expect(screen.getByRole('button', { name: MODE })).toHaveAccessibleName('Mode: Bypass');
    expect(screen.getByRole('button', { name: MODE })).toHaveClass('bg-error-soft');
  });

  it.each([
    ['Combo or model for this chat: Default', 'Combo or model for this chat: Default', false],
    ['@ Mention a feature', '@ Mention a feature', false],
  ] as const)('hovering %s shows the tooltip %s', async (name, tip, autoMode) => {
    const user = userEvent.setup();
    useApp.setState({ settings: { ...settings, autoMode } });
    render(<ChatRoute />);
    await user.hover(await screen.findByRole('button', { name }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(tip);
  });

  it('the toolbar labels speak Indonesian', async () => {
    setUiLanguage('id');
    render(<ChatRoute />);
    expect(await screen.findByRole('button', { name: 'Combo atau model untuk chat ini: Default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mode: Tanya' })).toBeInTheDocument();
  });

  it("talks to the chat's own agent, not the default one", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue({ ...chat('c1', 'p1'), agentId: 'gemini' });
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'gemini'));
  });

  it('prefixes the Buma skills on the first prompt of a non-Claude session only', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue({ ...chat('c1', 'p1'), agentId: 'gemini' });
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    const first = JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1]);
    expect(first).toContain('AskUserQuestion');
    expect(first).toContain('one');
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[1]![1])).not.toContain('AskUserQuestion');
  });

  it('does not prefix the skills for Claude, which loads the plugin', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).not.toContain('AskUserQuestion');
  });

  it('sends the skills to Claude as text when the app has no plugin to give it', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentStart).mockResolvedValueOnce(true);
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).toContain('AskUserQuestion');
  });

  it('tells an agent that reads Indonesian to answer in Indonesian, once per session', async () => {
    const user = userEvent.setup();
    useApp.setState({ settings: { ...settings, uiLanguage: 'id' } });
    setUiLanguage('id');
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Pesan' }), 'satu');
    await user.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    const sent = JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1]);
    expect(sent).toContain('The user reads Indonesian. Reply in Indonesian unless they write in another language.');
    // a later message in the same session does not repeat it
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await user.type(screen.getByRole('textbox', { name: 'Pesan' }), 'dua');
    await user.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[1]![1])).not.toContain('The user reads Indonesian');
  });

  it('keeps the hint out of the saved message, and sends it again for a new session', async () => {
    const user = userEvent.setup();
    useApp.setState({ settings: { ...settings, uiLanguage: 'id' } });
    setUiLanguage('id');
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Pesan' }), 'satu');
    await user.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ipc.addMessage).mock.calls.every((c) => !JSON.stringify(c[2]).includes('The user reads'))).toBe(true);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await useChat.getState().stop('c1');
    await user.type(screen.getByRole('textbox', { name: 'Pesan' }), 'dua');
    await user.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[1]![1])).toContain('The user reads Indonesian');
  });

  it('does not add the hint for English', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).not.toContain('The user reads');
  });

  it('saves the sign-in line in English and shows it in the language the user reads now', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentStart).mockRejectedValue(new Error('The agent needs you to sign in first (Authentication required)'));
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Sign in to Claude first: open Agents › Provider and add your Claude account');
    const saved = vi.mocked(ipc.addMessage).mock.calls.map((c) => JSON.stringify(c[2]));
    expect(saved.some((s) => s.includes('Sign in to Claude first: open Agents › Provider and add your Claude account'))).toBe(true);
    await act(async () => setUiLanguage('id'));
    expect(
      await screen.findByText('Masuk ke Claude dulu: buka Agen › Provider lalu tambahkan akun Claude'),
    ).toBeInTheDocument();
  });

  it('shows an error message and ends the working state (Stop goes, Send comes back)', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // While it works the box stays open; with nothing typed the one button is Stop, with text it queues.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
    expect(box).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Queue message' })).toBeNull();
    await user.type(box, 'and this');
    expect(screen.getByRole('button', { name: 'Queue message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await user.clear(box);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await emit('c1', { kind: 'error', message: 'The agent reported an error: boom' });
    expect(await screen.findByText('The agent reported an error: boom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('a message sent while the agent works is queued, shown, and goes out when the turn ends', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'first');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await user.type(box, 'and also this');
    await user.click(screen.getByRole('button', { name: 'Queue message' }));
    const queue = await screen.findByRole('list', { name: '1 queued' });
    expect(queue).toHaveTextContent('and also this');
    expect(ipc.agentPrompt).toHaveBeenCalledTimes(1);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[1]![1])).toContain('and also this');
    expect(screen.queryByRole('list', { name: /queued/ })).toBeNull();
  });

  it('tells the user how to sign in when the agent needs auth', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentStart).mockRejectedValue(new Error('The agent needs you to sign in first (Authentication required)'));
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('Sign in to Claude first: open Agents › Provider and add your Claude account'),
    ).toBeInTheDocument();
  });

  it('renders a permission card and Allow sends the allow option id', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await act(async () => {
      handlers.perm.forEach((cb) =>
        cb({
          chatId: 'c1',
          requestId: 'r1',
          title: 'Install a font',
          commands: ['brew install font'],
          options: [
            { id: 'opt-allow', label: 'Allow', kind: 'allow-once' },
            { id: 'opt-no', label: 'Reject', kind: 'reject-once' },
          ],
        }),
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('r1', 'opt-allow');
  });

  it('queues parallel permission requests and answers both', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    const req = (requestId: string, cmd: string): PermissionRequest => ({
      chatId: 'c1',
      requestId,
      title: cmd,
      commands: [cmd],
      options: [{ id: `allow-${requestId}`, label: 'Allow', kind: 'allow-once' }],
    });
    await act(async () => {
      handlers.perm.forEach((cb) => cb(req('r1', 'echo one')));
      handlers.perm.forEach((cb) => cb(req('r2', 'echo two')));
    });
    expect(screen.getAllByRole('button', { name: 'Allow' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenLastCalledWith('r1', 'allow-r1');
    expect(await screen.findByText('echo two', { selector: 'pre' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenLastCalledWith('r2', 'allow-r2');
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('answers still-queued requests with null when the turn ends', async () => {
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    const base = { chatId: 'c1', title: 't', commands: ['x'], options: [{ id: 'a', label: 'Allow', kind: 'allow-once' as const }] };
    await act(async () => {
      handlers.perm.forEach((cb) => cb({ ...base, requestId: 'q1' }));
      handlers.perm.forEach((cb) => cb({ ...base, requestId: 'q2' }));
    });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('q1', null);
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('q2', null);
    expect(useChat.getState().permissions['c1']).toEqual([]);
  });

  it('shows Stop while the agent works and cancels the turn', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentCancel).mockResolvedValue();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'faster');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(ipc.agentCancel).toHaveBeenCalledWith('c1');
    await emit('c1', { kind: 'done', stopReason: 'cancelled' });
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('attach and detach feed the next send, then clear', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'fix this');
    act(() => {
      useChat.getState().attach('c1', { type: 'file', path: '/tmp/Buma/p1/attachments/spec.pdf', name: 'spec.pdf', mime: 'application/pdf', size: 3 });
    });
    expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    expect(parts.some((p) => p.type === 'file')).toBe(true);
    expect(useChat.getState().attachments['c1'] ?? []).toHaveLength(0);
  });
});

describe('chat persistence scope', () => {
  it.each(['setup'])('never stores %s updates', async (id) => {
    useChat.getState().listen();
    await emit(id, { kind: 'tool', toolCallId: 't1', title: 'claude mcp add -s user figma -e FIGMA_TOKEN=secret', status: 'done' });
    await emit(id, { kind: 'text', text: 'done' });
    await emit(id, { kind: 'done', stopReason: 'end_turn' });
    await emit(id, { kind: 'error', message: 'x' });
    expect(ipc.addMessage).not.toHaveBeenCalled();
    expect(useChat.getState().messages[id]).toBeUndefined();
  });

  it('ignores updates for chats it never loaded or started', async () => {
    useChat.getState().listen();
    await emit('someone-else', { kind: 'text', text: 'hi' });
    expect(useChat.getState().messages['someone-else']).toBeUndefined();
  });
});

describe('ChatProject status and jobs', () => {

  it('the step bar moves on when the project does', async () => {
    const user = userEvent.setup();
    const step = (name: string) => screen.getByText(name, { selector: '[data-step-name]' }).closest('li');
    vi.mocked(ipc.listProjects).mockResolvedValue([{ ...projects[0]!, status: 'draft' }, projects[1]!]);
    vi.mocked(ipc.setProjectStatus).mockImplementation(async (id, status) => ({ ...projects[0]!, id, status }));
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    expect(step('Ideate')).toHaveAttribute('aria-current', 'step');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    // The first edit finishes: the project is building, and the header follows.
    vi.mocked(ipc.listProjects).mockResolvedValue(projects);
    await emit('c1', { kind: 'tool', toolCallId: 't1', title: 'Edit intake.md', status: 'done', toolKind: 'edit' });
    expect(ipc.setProjectStatus).toHaveBeenCalledWith('p1', 'building');
    await waitFor(() => expect(step('Build')).toHaveAttribute('aria-current', 'step'));
  });

  it('tracks a turn as a build job: working, needs you, done, failed', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'header span' });
    const statuses = () => vi.mocked(ipc.upsertJob).mock.calls.map(([j]) => j.status);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(statuses()).toEqual(['working']));
    expect(vi.mocked(ipc.upsertJob).mock.calls[0]![0]).toMatchObject({
      id: 'build-c1',
      kind: 'build',
      projectId: 'p1',
      chatId: 'c1',
      title: 'Kenapa rupiah melemah?',
    });
    await act(async () =>
      handlers.perm.forEach((cb) =>
        cb({ chatId: 'c1', requestId: 'r1', title: 't', commands: ['x'], options: [{ id: 'a', label: 'Allow', kind: 'allow-once' }] }),
      ),
    );
    expect(statuses().at(-1)).toBe('needs-you');
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(statuses().at(-1)).toBe('working');
    // A turn that ends without asking anything is done.
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(statuses().at(-1)).toBe('done'));

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'again');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await emit('c1', { kind: 'error', message: 'The agent reported an error: boom' });
    expect(vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0]).toMatchObject({
      status: 'failed',
      note: 'The agent reported an error: boom',
    });
  });
});

describe('chat failure handling', () => {
  const permission: PermissionRequest = {
    chatId: 'c1',
    requestId: 'r1',
    title: 'Install a font',
    commands: ['brew install font'],
    options: [{ id: 'opt-allow', label: 'Allow', kind: 'allow-once' }],
  };
  const sendFirst = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), text);
    await user.click(screen.getByRole('button', { name: 'Send' }));
  };

  it('restarts the agent session after an error', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await sendFirst(user, 'one');
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await emit('c1', { kind: 'error', message: 'crash' });
    const box = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(ipc.agentStart).toHaveBeenCalledTimes(2);
  });

  it('moves to the next agent when the limit runs out, and sends the message again (failover)', async () => {
    useFailover.setState({ on: true, ...{ combos: [{ id: 'default', name: 'Default', steps: [{ agent: 'claude', model: null }, { agent: 'codex', model: null }] }], defaultCombo: 'default', chatPick: {}, ready: [] }, accounts: {}, incompatible: {}, cooldown: {} });
    vi.mocked(ipc.updateChatAgent).mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await sendFirst(user, 'build it');
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await emit('c1', { kind: 'error', message: 'Claude AI usage limit reached' });
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(ipc.updateChatAgent).toHaveBeenCalledWith('c1', 'codex');
    expect(ipc.agentFailoverRecord).toHaveBeenCalledWith('c1', 'claude/', 'codex/', 'limit');
    expect(vi.mocked(ipc.agentStart).mock.calls.at(-1)![1]).toBe('codex');
    // The user's message is sent again, not added twice.
    const prompt = vi.mocked(ipc.agentPrompt).mock.calls.at(-1)![1];
    expect(JSON.stringify(prompt)).toContain('build it');
    expect(screen.getAllByText('build it')).toHaveLength(1);
    expect(await screen.findByText(/Moved this chat to Codex/)).toBeInTheDocument();
    expect(useFailover.getState().cooldown['claude/']).toBeGreaterThan(Date.now());
  });

  it('a model the account refuses is hidden for it and the chat moves on', async () => {
    useFailover.setState({ on: true, ...{ combos: [{ id: 'default', name: 'Default', steps: [{ agent: 'codex', model: 'gpt-5.5' }, { agent: 'claude', model: null }] }], defaultCombo: 'default', chatPick: {}, ready: [] }, accounts: {}, incompatible: {}, cooldown: {} });
    useFailover.getState().setModels('codex', ['gpt-5.5']);
    useApp.setState({ settings: { ...settings, defaultAgent: 'codex', agentModels: { codex: 'gpt-5.5' } } });
    vi.mocked(ipc.getChat).mockResolvedValue({ ...chat('c1', 'p1'), agentId: 'codex' });
    vi.mocked(ipc.updateChatAgent).mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await emit('c1', { kind: 'error', message: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account. (model_not_found)" });
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(useFailover.getState().isCompatible('codex', null, 'gpt-5.5')).toBe(false);
    expect(useFailover.getState().models.codex).toEqual([]);
    expect(ipc.setAgentModel).toHaveBeenCalledWith('codex', null, null);
    expect(vi.mocked(ipc.agentStart).mock.calls.at(-1)![1]).toBe('claude');
  });

  it('does not fail over on an error that another agent would not fix', async () => {
    useFailover.setState({ on: true, ...{ combos: [{ id: 'default', name: 'Default', steps: [{ agent: 'claude', model: null }, { agent: 'codex', model: null }] }], defaultCombo: 'default', chatPick: {}, ready: [] }, accounts: {}, incompatible: {}, cooldown: {} });
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await sendFirst(user, 'one');
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await emit('c1', { kind: 'error', message: 'The agent reported an error: boom' });
    expect(ipc.updateChatAgent).not.toHaveBeenCalled();
    expect(ipc.agentPrompt).toHaveBeenCalledTimes(1);
  });

  it.each(['done', 'error'] as const)('clears an open permission card on %s', async (kind) => {
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await act(async () => {
      handlers.perm.forEach((cb) => cb(permission));
    });
    expect(await screen.findByRole('button', { name: 'Allow' })).toBeInTheDocument();
    await emit('c1', kind === 'done' ? { kind: 'done', stopReason: 'end_turn' } : { kind: 'error', message: 'x' });
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('shows an inline error and keeps the draft and mention when the first send fails', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.createChat).mockRejectedValue(new Error('disk full'));
    render(<ChatRoute />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'remix @');
    await user.keyboard('{Enter}');
    await user.type(box, 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Couldn't start the chat: disk full")).toBeInTheDocument();
    expect(box).toHaveValue('remix faster');
    expect(screen.getByText('1 feature attached')).toBeInTheDocument();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });

  it('does not send on Enter when the @ menu has no matches', async () => {
    const user = userEvent.setup();
    render(<ChatRoute />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), '@zzzz');
    await user.keyboard('{Enter}');
    expect(ipc.createChat).not.toHaveBeenCalled();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });
});


describe('Composer attachments', () => {
  const doc = { type: 'file', path: '/tmp/Buma/p1/attachments/brief.pdf', name: 'brief.pdf', mime: 'application/pdf', size: 2048 } as const;
  const img = { type: 'file', path: '/tmp/Buma/p1/attachments/shot.png', name: 'shot.png', mime: 'image/png', size: 10 } as const;

  it('opens the picker, copies the files and shows removable chips', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf', '/Users/me/shot.png']);
    vi.mocked(ipc.attachFile).mockResolvedValueOnce(doc).mockResolvedValueOnce(img);
    render(<ChatProject chatId="c1" />);
    await attachFiles(user);
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    expect(ipc.attachFile).toHaveBeenCalledWith('c1', '/Users/me/brief.pdf');
    expect(ipc.attachFile).toHaveBeenCalledWith('c1', '/Users/me/shot.png');
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute('src', img.path);
    await user.click(screen.getAllByRole('button', { name: 'Remove file' })[0]!);
    expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('shows the error when a file cannot be attached', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue('/Users/me/big.mov');
    vi.mocked(ipc.attachFile).mockRejectedValue('That file is larger than 50 MB');
    render(<ChatProject chatId="c1" />);
    await attachFiles(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is larger than 50 MB');
  });

  it('sends file parts to the agent with the message', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatProject chatId="c1" />);
    await attachFiles(user);
    await screen.findByText('brief.pdf');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'use this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(noFacts(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).toEqual([doc, { type: 'text', text: 'use this' }]);
    expect(screen.queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
  });

  it('can send attachments without any text', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatProject chatId="c1" />);
    await attachFiles(user);
    await screen.findByText('brief.pdf');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
  });

  it('creates the chat first when attaching in a new chat', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatRoute />);
    await attachFiles(user);
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    expect(ipc.attachFile).toHaveBeenCalledWith('c-new', '/Users/me/brief.pdf');
  });

  it('is flat: no inner box around the textarea', async () => {
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    expect(box.className).toContain('bg-transparent');
    expect(box.className).toContain('border-0');
    expect(box.className).toContain('focus-visible:ring-0');
    expect(box.className).toContain('focus-visible:border-transparent');
  });
});

const info = (id: string, name: string, installed: boolean, version: string | null) => ({
  id,
  name,
  installed,
  version,
  acpCommand: [],
  recommended: false,
});

describe('Combo in the chat', () => {
  it('names the pick and the model in use; the menu lists the combos and one-model picks, and links to them', async () => {
    const user = userEvent.setup();
    useFailover.setState({
      on: true,
      combos: [
        { id: 'default', name: 'Default', steps: [{ agent: 'claude', model: 'claude-opus-5-5' }, { agent: 'codex', model: null }] },
        { id: 'fast', name: 'Fast', steps: [{ agent: 'claude', model: 'claude-haiku-5-5' }] },
      ],
      defaultCombo: 'default',
      chatPick: {},
      ready: ['claude', 'codex'],
      accounts: {},
      incompatible: {},
      cooldown: {},
    });
    useApp.setState({ settings: { ...settings, agentModels: { claude: 'claude-opus-5-5' } } });
    render(<ChatProject chatId="c1" />);
    const badge = await screen.findByTestId('route-badge');
    expect(badge).toHaveAccessibleName('Combo or model for this chat: Default');
    expect(badge).toHaveTextContent('Default· Opus 5.5');
    await user.click(badge);
    const list = await screen.findByRole('list', { name: 'Combos' });
    expect(within(list).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Default2 models in order', 'FastOne model']);
    // This chat goes on Fast; other chats keep theirs.
    await user.click(within(list).getByRole('button', { name: /Fast/ }));
    expect(useFailover.getState().pickOf('c1')).toBe('fast');
    expect(useFailover.getState().pickOf('c2')).toBe('default');
    await user.click(screen.getByTestId('route-badge'));
    await user.click(await screen.findByRole('button', { name: 'Manage combos' }));
    expect(useApp.getState().route).toEqual({ name: 'agents', tab: 'combo' });
  });

  it("a new chat starts on its combo's first step that is not resting", async () => {
    const user = userEvent.setup();
    useFailover.setState({ on: true, ...{ combos: [{ id: 'default', name: 'Default', steps: [{ agent: 'claude', model: null }, { agent: 'codex', model: null }] }], defaultCombo: 'default', chatPick: {}, ready: [] }, accounts: {}, incompatible: {}, cooldown: { 'claude/': Date.now() + 60_000 } });
    vi.mocked(ipc.createChat).mockResolvedValue({ ...chat('c-new', null), agentId: 'codex' });
    render(<ChatRoute />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalled());
    expect(vi.mocked(ipc.agentStart).mock.calls.at(-1)![1]).toBe('codex');
  });
});

describe('buildRecap', () => {
  const msg = (role: 'user' | 'agent' | 'system', text: string, i = 0) => ({
    id: `x${i}`,
    chatId: 'c',
    role,
    parts: [{ type: 'text' as const, text }],
    createdAt: '',
  });

  it('keeps the last 6 text messages, oldest first, with You/Agent prefixes', () => {
    const list = Array.from({ length: 8 }, (_, i) => msg(i % 2 ? 'agent' : 'user', `line ${i}`, i));
    list.splice(3, 0, msg('system', 'Switched', 99));
    const recap = buildRecap(list);
    expect(recap).not.toContain('line 1');
    expect(recap).not.toContain('Switched');
    expect(recap.indexOf('You: line 2')).toBeLessThan(recap.indexOf('Agent: line 7'));
  });

  it('leaves out A2UI blocks and keeps the prose around them', () => {
    const block = '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"x"}}\n```';
    const recap = buildRecap([msg('agent', `Pick one:\n${block}\nThen tell me.`, 1), msg('agent', block, 2)]);
    expect(recap).toBe('Agent: Pick one:\n\nThen tell me.');
    expect(recap).not.toContain('createSurface');
  });

  it('leaves out thoughts and tools', () => {
    const m = {
      id: 'a',
      chatId: 'c',
      role: 'agent' as const,
      parts: [
        { type: 'thought' as const, text: 'secret musing' },
        { type: 'tool' as const, toolCallId: 't', title: 'Run ls', status: 'done' as const },
        { type: 'text' as const, text: 'Hello' },
      ],
      createdAt: '',
    };
    expect(buildRecap([m])).toBe('Agent: Hello');
  });

  it('stays within 1,500 characters and skips messages without text', () => {
    const big = 'x'.repeat(900);
    const list = [msg('user', big, 1), msg('agent', big, 2), msg('user', big, 3)];
    list.push({ id: 'f', chatId: 'c', role: 'user', parts: [] as never, createdAt: '' });
    expect(buildRecap(list).length).toBeLessThanOrEqual(1500);
    expect(buildRecap([])).toBe('');
  });
});

describe('Composer / menu', () => {
  it('lists the built-in skills and the user\'s own, and picking one writes /name', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.listSkills).mockResolvedValue([{ id: 'team-rules', description: 'How our team writes acceptance criteria', enabled: true, path: '/d/SKILL.md' }]);
    render(<ChatRoute />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, '/');
    const menu = await screen.findByRole('listbox', { name: 'Skills' });
    expect(within(menu).getByRole('option', { name: 'using-bspace-sdlc' })).toHaveAttribute('aria-selected', 'true');
    // The entry skill is the default route: first in the list, with a star on its left.
    expect(within(within(menu).getByRole('option', { name: 'using-bspace-sdlc' })).getByTestId('entry-star')).toBeInTheDocument();
    expect(within(menu).getAllByTestId('entry-star')).toHaveLength(1);
    expect(screen.getByTestId('slash-hint')).toHaveTextContent(/Default route: starts every feature.*Entry point for a BUMA feature/);
    expect(await within(menu).findByRole('option', { name: 'team-rules' })).toBeInTheDocument();
    await user.hover(within(menu).getByRole('option', { name: 'team-rules' }));
    expect(screen.getByTestId('slash-hint')).toHaveTextContent('How our team writes acceptance criteria');
    await user.type(box, 'bluep');
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('/blueprint-ftsd ');
  });
});
