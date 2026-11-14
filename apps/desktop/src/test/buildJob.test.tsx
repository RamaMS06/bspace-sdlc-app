import { act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { AgentUpdate } from '@bspace-sdlc-app/shared';

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

import { upsertJob } from '@/lib/ipc';
import { setUiLanguage } from '@/i18n';
import { localized } from '@/lib/stored';
import { useChat, waitsForAnswer } from '@/state/chat';

const emit = (chatId: string, update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId, update })));
const lastJob = () => vi.mocked(upsertJob).mock.calls.at(-1)![0];
const job = { projectId: 'p1', title: 'Attendance' };

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  setUiLanguage('en');
  useChat.getState().reset();
  useChat.getState().listen();
});

describe('waitsForAnswer', () => {
  const agent = (text: string) => ({ id: 'a', chatId: 'c', role: 'agent' as const, parts: [{ type: 'text' as const, text }], createdAt: '' });
  it('is true for a question at the end or an open surface', () => {
    expect(waitsForAnswer(agent('Mau pakai layar yang mana?'))).toBe(true);
    expect(waitsForAnswer(agent('Which one？ '))).toBe(true);
    expect(waitsForAnswer(agent('Pick one\n\n```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}\n```'))).toBe(true);
    expect(waitsForAnswer(agent('Is it ok? I wrote the Blueprint.'))).toBe(false);
    expect(waitsForAnswer(undefined)).toBe(false);
  });
});

describe('a project chat build job at the end of a turn', () => {
  it('is working while the turn runs and done when it ends', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    expect(lastJob()).toMatchObject({ id: 'build-c1', kind: 'build', projectId: 'p1', status: 'working' });
    await emit('c1', { kind: 'text', text: 'The Blueprint is written.' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(lastJob()).toMatchObject({ status: 'done', note: null }));
  });

  it('needs your answer when the agent ended on a question', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'text', text: 'Mau pakai layar yang mana?' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(lastJob()).toMatchObject({ status: 'needs-you', note: 'The agent is waiting for your answer' }));
    setUiLanguage('id');
    expect(localized(lastJob().note!)).toBe('Agen menunggu jawabanmu');
  });

  it('still needs your answer when a system line landed after the question', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'text', text: 'Mau pakai layar yang mana?' });
    useChat.getState().notice('c1', 'The agent is still working. Wait for it to finish, then send again.');
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(lastJob()).toMatchObject({ status: 'needs-you', note: 'The agent is waiting for your answer' }));
  });

  it('a Stop is done, with a note saying so', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'done', stopReason: 'cancelled' });
    await waitFor(() => expect(lastJob()).toMatchObject({ status: 'done', note: 'Cancelled' }));
  });

  it('a chat without a project writes no job', async () => {
    await useChat.getState().send('c2', [{ type: 'text', text: 'go' }], { agentId: 'claude' });
    await emit('c2', { kind: 'done', stopReason: 'end_turn' });
    expect(upsertJob).not.toHaveBeenCalled();
  });
});
