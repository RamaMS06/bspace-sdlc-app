import { act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { AgentUpdate, Project, ProjectStatus } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  setProjectStatus: vi.fn(),
  assetUrl: (p: string) => p,
}));
const updates: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(async (cb: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updates.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async () => () => {}),
}));

import { setProjectStatus } from '@/lib/ipc';
import { useChat } from '@/state/chat';

const emit = (chatId: string, update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId, update })));
const proj = (id: string, status: ProjectStatus): Project => ({ id, title: id, slug: id, folder: `/w/${id}`, status, createdAt: 'c', updatedAt: 'u' });
const job = { projectId: 'p1', title: 'Attendance' };
const tool = (toolCallId: string, toolKind: 'edit' | 'read' | 'execute' | 'delete' | 'move', status: 'running' | 'done' | 'failed'): AgentUpdate => ({
  kind: 'tool', toolCallId, title: `${toolKind} something`, status, toolKind,
});
const statusCalls = () => vi.mocked(setProjectStatus).mock.calls.map(([id, s]) => `${id}:${s}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setProjectStatus).mockImplementation(async (id, status) => proj(id, status));
  updates.length = 0;
  useChat.getState().reset();
  useChat.getState().listen();
});

describe("a project's status follows its chat", () => {
  it('becomes building when the first edit, delete, move or command finishes, not on reads or failures', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', tool('t1', 'read', 'done'));
    await emit('c1', tool('t2', 'edit', 'running'));
    await emit('c1', tool('t3', 'execute', 'failed'));
    expect(setProjectStatus).not.toHaveBeenCalled();
    await emit('c1', tool('t2', 'edit', 'done'));
    await waitFor(() => expect(statusCalls()).toEqual(['p1:building']));
    // Once building, later work asks nothing more.
    await emit('c1', tool('t4', 'move', 'done'));
    await emit('c1', tool('t5', 'delete', 'done'));
    expect(statusCalls()).toEqual(['p1:building']);
  });

  it('a chat without a project never moves a status', async () => {
    await useChat.getState().send('c2', [{ type: 'text', text: 'go' }], { agentId: 'claude' });
    await emit('c2', tool('t1', 'edit', 'done'));
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });

  it('stays where it is when the turn ends without work', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });
});
