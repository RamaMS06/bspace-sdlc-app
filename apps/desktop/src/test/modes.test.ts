import { act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('@/lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ipc')>()),
  agentSetMode: vi.fn().mockResolvedValue(undefined),
  agentSetAuto: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn().mockResolvedValue(undefined),
  agentStop: vi.fn().mockResolvedValue(undefined),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  saveMessage: vi.fn().mockResolvedValue(undefined),
}));

import * as ipc from '@/lib/ipc';
import { modeOf, STOP_GRACE_MS, useChat } from '@/state/chat';

beforeEach(() => {
  vi.clearAllMocks();
  useChat.getState().reset();
});

describe('permission modes', () => {
  it('a mode picked before the session starts waits; a running session switches right away', async () => {
    await useChat.getState().setMode('c1', 'plan');
    expect(ipc.agentSetMode).not.toHaveBeenCalled();
    expect(modeOf(useChat.getState(), 'c1', false)).toBe('plan');
    useChat.setState({ started: { c1: true } });
    await useChat.getState().setMode('c1', 'bypass');
    expect(ipc.agentSetMode).toHaveBeenCalledWith('c1', 'bypass');
    expect(modeOf(useChat.getState(), 'c1', false)).toBe('bypass');
  });

  it('back to Ask leaves the agent mode and turns Auto off', async () => {
    useChat.setState({ started: { c1: true } });
    await useChat.getState().setMode('c1', 'plan');
    await useChat.getState().setMode('c1', 'ask');
    expect(ipc.agentSetMode).toHaveBeenLastCalledWith('c1', 'ask');
    expect(ipc.agentSetAuto).toHaveBeenCalledWith('c1', false);
    expect(modeOf(useChat.getState(), 'c1', false)).toBe('ask');
  });

  it('a mode the agent refuses falls back to Ask', async () => {
    useChat.setState({ started: { c1: true } });
    vi.mocked(ipc.agentSetMode).mockRejectedValueOnce(new Error('This agent has no plan mode'));
    await useChat.getState().setMode('c1', 'plan');
    expect(modeOf(useChat.getState(), 'c1', false)).toBe('ask');
  });

  it('a new chat takes the mode picked before it had an id', async () => {
    await useChat.getState().setMode(null, 'acceptEdits');
    useChat.getState().adoptPendingAuto('c9');
    expect(modeOf(useChat.getState(), 'c9', false)).toBe('acceptEdits');
  });
});

describe('Stop', () => {
  it('asks the agent to stop, and kills it when the turn does not end', async () => {
    vi.useFakeTimers();
    try {
      useChat.setState({ started: { c1: true }, streaming: { c1: true } });
      await useChat.getState().cancel('c1');
      expect(ipc.agentCancel).toHaveBeenCalledWith('c1');
      expect(ipc.agentStop).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 10);
      });
      expect(ipc.agentStop).toHaveBeenCalledWith('c1');
      expect(useChat.getState().streaming.c1).toBe(false);
      expect(useChat.getState().started.c1).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the agent alone when the turn ends in time', async () => {
    vi.useFakeTimers();
    try {
      useChat.setState({ started: { c1: true }, streaming: { c1: true } });
      await useChat.getState().cancel('c1');
      useChat.setState({ streaming: { c1: false } });
      await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 10);
      expect(ipc.agentStop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
