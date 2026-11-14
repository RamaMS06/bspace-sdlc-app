import { vi } from 'vitest';

vi.mock('@/shared/lib/ipc', async (orig) => ({
  ...(await orig<typeof import('@/shared/lib/ipc')>()),
  agentRespondQuestion: vi.fn().mockResolvedValue(undefined),
  addMessage: vi.fn(async (chatId: string, role: string, parts: unknown[]) => ({ id: 'm1', chatId, role, parts, createdAt: '' })),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
}));

import { addMessage, agentRespondQuestion } from '@/shared/lib/ipc';
import { headQuestion, useChat } from '@/features/chat/state/chat';

const q = (id: string) => ({ chatId: 'c1', requestId: id, message: 'Which?', schema: { properties: {} } });

describe('answering a question', () => {
  beforeEach(() => useChat.setState({ questions: { c1: [q('r1'), q('r2')] }, messages: { c1: [] } }));

  it('answers the oldest, puts the answer in the chat, and shows the next', async () => {
    expect(headQuestion(useChat.getState(), 'c1')?.requestId).toBe('r1');
    await useChat.getState().respondQuestion('c1', { action: 'accept', content: { topic: 'b' } }, 'Volcanoes');
    expect(agentRespondQuestion).toHaveBeenCalledWith('r1', { action: 'accept', content: { topic: 'b' } });
    const last = useChat.getState().messages.c1!.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.parts).toEqual([{ type: 'text', text: 'Volcanoes' }]);
    expect(headQuestion(useChat.getState(), 'c1')?.requestId).toBe('r2');
  });

  it('a skip is recorded as skipped', async () => {
    await useChat.getState().respondQuestion('c1', { action: 'decline' }, '');
    expect(useChat.getState().messages.c1!.at(-1)!.parts).toEqual([{ type: 'text', text: 'Skipped the question' }]);
  });
});

describe('a turn with several agent messages', () => {
  it("stores the agent's message before the answer that follows it, so a reload brings both back in order", async () => {
    vi.mocked(addMessage).mockClear();
    const agentMsg = { id: 'local-a1', chatId: 'c1', role: 'agent' as const, parts: [{ type: 'text' as const, text: 'Which stack?' }], createdAt: '' };
    useChat.setState({ questions: { c1: [q('r1')] }, messages: { c1: [agentMsg] } });
    await useChat.getState().respondQuestion('c1', { action: 'accept', content: { stack: 'Flutter' } }, 'Flutter');
    await vi.waitFor(() => expect(vi.mocked(addMessage)).toHaveBeenCalledTimes(2));
    const roles = vi.mocked(addMessage).mock.calls.map((c) => c[1]);
    expect(roles).toEqual(['agent', 'user']);
    expect(vi.mocked(addMessage).mock.calls[0]![2]).toEqual([{ type: 'text', text: 'Which stack?' }]);
  });

  it('a note after an unsaved agent message stores that message first', async () => {
    vi.mocked(addMessage).mockClear();
    const agentMsg = { id: 'local-a2', chatId: 'c1', role: 'agent' as const, parts: [{ type: 'text' as const, text: 'Working on it' }], createdAt: '' };
    useChat.setState({ messages: { c1: [agentMsg] } });
    await useChat.getState().appendSystem('c1', 'Switched to Codex');
    expect(vi.mocked(addMessage).mock.calls.map((c) => c[1])).toEqual(['agent', 'system']);
  });
});
