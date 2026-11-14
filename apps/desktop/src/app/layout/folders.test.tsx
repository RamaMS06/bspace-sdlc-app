import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/shared/lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/ipc')>()),
  setChatFolder: vi.fn(async (chatId: string, folder: string | null) => ({ id: chatId, projectId: null, agentId: 'claude', title: 't', createdAt: '', folder })),
  createChat: vi.fn(async () => ({ id: 'c-folder', projectId: null, agentId: 'claude', title: 'New chat', createdAt: '' })),
  listSkills: vi.fn(async () => [{ id: 'team-rules', description: 'How our team writes acceptance criteria', enabled: true, path: '/d/team-rules/SKILL.md' }]),
  listRecentChats: vi.fn(async () => []),
  agentStop: vi.fn(async () => undefined),
}));

import * as ipc from '@/shared/lib/ipc';
import { Sidebar } from '@/app/layout/Sidebar';
import { useApp } from '@/shared/state/app';
import { useFolders } from '@/features/chat/state/folders';
import { filterSkills, SLASH } from '@/features/skills/components/SlashMenu';
import { BUILTIN_SKILLS } from '@bspace-sdlc-app/skills';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useFolders.setState({ groups: [], byChat: {} });
  useApp.setState({ route: { name: 'chat-new' } });
});

describe('folders attached to chats', () => {
  it('attaching groups the chat under the folder name, and stores the folder for the agent', async () => {
    await useFolders.getState().attach('c1', '/Users/rama/projects/attendance-app', 'Payroll talk');
    expect(ipc.setChatFolder).toHaveBeenCalledWith('c1', '/Users/rama/projects/attendance-app');
    const [g] = useFolders.getState().groups;
    expect(g).toMatchObject({ title: 'attendance-app', open: true, chats: [{ id: 'c1', title: 'Payroll talk' }] });
    expect(useFolders.getState().byChat.c1).toBe('/Users/rama/projects/attendance-app');
    // Saved for the next launch.
    expect(JSON.parse(localStorage.getItem('buma.folders')!).groups).toHaveLength(1);
  });

  it('the sidebar shows the folder as a group that hides and shows, with + for a new chat in it', async () => {
    const user = userEvent.setup();
    await useFolders.getState().attach('c1', '/w/attendance-app', 'Payroll talk');
    render(<Sidebar active="chat" />);
    const group = screen.getByRole('button', { name: 'attendance-app' });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Payroll talk' })).toBeInTheDocument();
    await user.click(group);
    expect(screen.queryByRole('link', { name: 'Payroll talk' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New chat in attendance-app' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-folder' }));
    expect(ipc.setChatFolder).toHaveBeenLastCalledWith('c-folder', '/w/attendance-app');
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'New chat' })).toBeInTheDocument();
  });

  it('detaching removes the chat from its group', async () => {
    await useFolders.getState().attach('c1', '/w/app', 'One');
    await useFolders.getState().detach('c1');
    expect(ipc.setChatFolder).toHaveBeenLastCalledWith('c1', null);
    expect(useFolders.getState().byChat.c1).toBeUndefined();
    expect(useFolders.getState().groups[0]!.chats).toEqual([]);
  });
});

describe('the / skill menu', () => {
  it('opens on / at the start and filters every built-in skill by name or description', () => {
    expect(SLASH.test('/')).toBe(true);
    expect(SLASH.exec('/blue')![1]).toBe('blue');
    expect(SLASH.test('see /blue')).toBe(false);
    const all = BUILTIN_SKILLS.map((s) => ({ id: s.id, description: s.description, source: 'builtin' as const }));
    expect(filterSkills(all, 'blue').map((s) => s.id)).toContain('blueprint-ftsd');
    expect(filterSkills(all, 'figma').length).toBeGreaterThan(0);
  });
});
