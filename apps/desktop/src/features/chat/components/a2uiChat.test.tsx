import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, ChatMessage } from '@bspace-sdlc-app/shared';

vi.mock('@/shared/lib/ipc', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  listSkills: vi.fn().mockResolvedValue([]),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => p,
}));
const updates: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/shared/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(async (cb: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updates.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
import { addMessage, agentPrompt, agentRespondPermission, agentStart, agentStop, getChat, listSkills, upsertJob } from '@/shared/lib/ipc';
import { MessageList } from '@/features/chat/components/MessageList';
import { BUSY_NOTE, useChat } from '@/features/chat/state/chat';
import { needsYou } from '@/features/chat/state/jobs';
import { FOREGROUND_RULE } from '@bspace-sdlc-app/skills';

/** What the agent got, without the session facts line a new session starts with. */
const noFacts = <T,>(parts: T[]): T[] =>
  parts.filter((p) => !String((p as { text?: unknown }).text ?? '').includes('local time zone is'));


const V = 'v0.9';
const block = (surfaceId: string, label: string) =>
  '```a2ui\n' +
  [
    { version: V, createSurface: { surfaceId, catalogId: 'basic' } },
    {
      version: V,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['b'] },
          { id: 't', component: 'Text', text: label },
          { id: 'b', component: 'Button', child: 't', action: { event: { name: 'pick', context: { id: 1 } } } },
        ],
      },
    },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n') +
  '\n```';

const msg = (id: string, role: ChatMessage['role'], parts: ChatMessage['parts']): ChatMessage => ({
  id,
  chatId: 'c1',
  role,
  parts,
  createdAt: '2026-11-04T00:00:00Z',
});

beforeEach(() => {
  useChat.getState().reset();
  updates.length = 0;
  vi.mocked(agentPrompt).mockClear();
});

describe('A2UI in the chat', () => {
  it('renders a block inline and hides the raw JSON', () => {
    render(
      <MessageList
        streaming={false}
        messages={[msg('1', 'agent', [{ type: 'text', text: `Which one?\n\n${block('s1', 'Kenapa rupiah melemah?')}` }])]}
      />,
    );
    expect(screen.getByText('Which one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kenapa rupiah melemah?' })).toBeInTheDocument();
    expect(screen.queryByText(/createSurface/)).toBeNull();
  });

  it('shows a muted note, never raw JSON, for a closed block that is not valid', () => {
    render(
      <MessageList
        streaming={false}
        messages={[msg('1', 'agent', [{ type: 'text', text: 'Pick:\n```a2ui\n{"version":"v0.9","createSurface":\n```' }])]}
      />,
    );
    expect(screen.getByText('Pick:')).toBeInTheDocument();
    expect(screen.getByText("Couldn't show these options")).toBeInTheDocument();
    expect(screen.queryByText(/createSurface/)).toBeNull();
  });

  it('shows a placeholder while a block is still streaming', () => {
    render(
      <MessageList
        streaming
        messages={[msg('1', 'agent', [{ type: 'text', text: 'Options\n```a2ui\n{"version":"v0.9","createSu' }])]}
      />,
    );
    expect(screen.getByText('Loading options…')).toBeInTheDocument();
    expect(screen.queryByText(/createSu/)).toBeNull();
  });

  it('sends the readable summary and the action JSON on click', async () => {
    render(
      <MessageList streaming={false} messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    const parts = noFacts(vi.mocked(agentPrompt).mock.calls[0]![1]);
    // The agent gets summary + action JSON from the single a2ui-action part (Rust turns it into text).
    expect(parts).toHaveLength(1);
    const act = parts[0]!;
    expect(act).toMatchObject({ type: 'a2ui-action', summary: 'Picked: Pick me' });
    // The visible user message carries the readable summary too.
    expect(useChat.getState().messages.c1!.at(-1)!.parts[0]).toEqual({ type: 'text', text: 'Picked: Pick me' });
    expect(JSON.stringify(act)).toContain('"surfaceId":"s1"');
    expect(JSON.stringify(act)).toContain('"version":"v0.9"');
  });

  it("sums up an action by its context title when it has one", async () => {
    const text =
      '```a2ui\n' +
      [
        { version: V, createSurface: { surfaceId: 's2', catalogId: 'basic' } },
        {
          version: V,
          updateComponents: {
            surfaceId: 's2',
            components: [
              { id: 'root', component: 'Column', children: ['b'] },
              { id: 't', component: 'Text', text: 'Make this' },
              { id: 'b', component: 'Button', child: 't', action: { event: { name: 'pick_topic', context: { title: 'Selat Malaka', kind: 'data', lengthSec: 45 } } } },
            ],
          },
        },
      ]
        .map((m) => JSON.stringify(m))
        .join('\n') +
      '\n```';
    render(<MessageList streaming={false} messages={[msg('1', 'agent', [{ type: 'text', text }])]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(vi.mocked(agentPrompt).mock.calls[0]![1].at(-1)).toMatchObject({ summary: 'Picked: Selat Malaka' });
  });

  it('keeps an answered surface answered: a later update can neither change nor re-enable it', () => {
    const answered = msg('2', 'user', [
      { type: 'text', text: 'Picked: Pick me' },
      { type: 'a2ui-action', summary: 'Picked: Pick me', action: { version: V, action: { name: 'pick', surfaceId: 's1' } } },
    ]);
    const first = msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }]);
    const { rerender } = render(<MessageList streaming={false} messages={[first, answered]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.getByText('Picked: Pick me')).toBeInTheDocument();

    const update = msg('3', 'agent', [
      {
        type: 'text',
        text:
          '```a2ui\n' +
          JSON.stringify({
            version: V,
            updateComponents: { surfaceId: 's1', components: [{ id: 't', component: 'Text', text: 'Pick again' }] },
          }) +
          '\n```',
      },
    ]);
    rerender(<MessageList streaming={false} messages={[first, answered, update]} />);
    expect(screen.getAllByTestId('a2ui-surface')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Pick again' })).toBeNull();
    // Before it is answered, an update still changes it in place.
    rerender(<MessageList streaming={false} messages={[first, update]} />);
    expect(screen.getAllByTestId('a2ui-surface')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Pick again' })).toBeEnabled();
  });
});

describe('an answered surface in a block that starts with another card', () => {
  it('stays as it was, while the new card shows', () => {
    const first = msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }]);
    const answered = msg('2', 'user', [
      { type: 'text', text: 'Picked: Pick me' },
      { type: 'a2ui-action', summary: 'Picked: Pick me', action: { version: V, action: { name: 'pick', surfaceId: 's1' } } },
    ]);
    const lines = block('n1', 'New card').replace(/\n```$/, '');
    const rewrite = JSON.stringify({ version: V, updateComponents: { surfaceId: 's1', components: [{ id: 't', component: 'Text', text: 'Rewritten' }] } });
    const remove = JSON.stringify({ version: V, deleteSurface: { surfaceId: 's1' } });
    const later = msg('3', 'agent', [{ type: 'text', text: `${lines}\n${rewrite}\n${remove}\n\`\`\`` }]);
    render(<MessageList streaming={false} messages={[first, answered, later]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.queryByText('Rewritten')).toBeNull();
    expect(screen.getByRole('button', { name: 'New card' })).toBeEnabled();
  });
});

describe('one gate while the agent replies', () => {
  it('disables a live surface while the chat streams, without marking it answered', () => {
    const first = msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }]);
    const { rerender } = render(<MessageList streaming messages={[first, msg('2', 'user', [{ type: 'text', text: 'hm' }])]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.getByTestId('a2ui-surface')).not.toHaveAttribute('data-answered');
    rerender(<MessageList streaming={false} messages={[first, msg('2', 'user', [{ type: 'text', text: 'hm' }])]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeEnabled();
  });

  it('disables surfaces while the screen is busy', () => {
    render(<MessageList streaming={false} busy messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Make this') }])]} />);
    expect(screen.getByRole('button', { name: 'Make this' })).toBeDisabled();
  });

  it('a message sent while the agent works waits in the queue and leaves the running turn alone', async () => {
    vi.mocked(agentStart).mockClear();
    await useChat.getState().send('c1', [{ type: 'text', text: 'first' }], {
      agentId: 'claude',
      job: { projectId: 'p1', title: 'Attendance' },
    });
    const perm = { chatId: 'c1', requestId: 'r1', title: 'Run', commands: [], options: [] };
    useChat.setState((s) => ({ permissions: { ...s.permissions, c1: [perm] } }));
    vi.mocked(upsertJob).mockClear();
    vi.mocked(agentRespondPermission).mockClear();
    vi.mocked(agentPrompt).mockClear();
    expect(await useChat.getState().send('c1', [{ type: 'text', text: 'second' }])).toBeNull();
    const s = useChat.getState();
    expect(s.streaming.c1).toBe(true);
    expect(s.started.c1).toBe(true);
    expect(s.permissions.c1).toHaveLength(1);
    expect(s.queued.c1!.map((q) => q.parts)).toEqual([[{ type: 'text', text: 'second' }]]);
    expect(agentPrompt).not.toHaveBeenCalled();
    expect(agentRespondPermission).not.toHaveBeenCalled();
    expect(vi.mocked(upsertJob).mock.calls.map((c) => c[0].status)).not.toContain('failed');
    expect(agentStart).toHaveBeenCalledTimes(1);
  });
});

describe('answering a surface after a restart', () => {
  it("starts the chat's own agent from the chat row, not the default", async () => {
    vi.mocked(agentStart).mockClear();
    vi.mocked(getChat).mockResolvedValueOnce({ id: 'c1', projectId: 'p1', agentId: 'codex', title: 't', createdAt: '' });
    await useChat.getState().load('c1');
    render(<MessageList streaming={false} messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentStart).toHaveBeenCalledWith('c1', 'codex'));
  });

  it("sends with the screen's options: its agent, job and prompt prefix", async () => {
    vi.mocked(agentStart).mockClear();
    vi.mocked(upsertJob).mockClear();
    render(
      <MessageList
        streaming={false}
        sendOptions={(prompt) => ({
          agentId: 'gemini',
          job: { projectId: 'p1', title: 'Attendance' },
          promptParts: [{ type: 'text', text: 'SKIP' }, ...prompt],
        })}
        messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(agentStart).toHaveBeenCalledWith('c1', 'gemini');
    const parts = vi.mocked(agentPrompt).mock.calls[0]![1];
    expect(parts.at(-2)).toEqual({ type: 'text', text: 'SKIP' });
    expect(parts.at(-1)).toMatchObject({ type: 'a2ui-action', summary: 'Picked: Pick me' });
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'build', projectId: 'p1' }));
  });
});

describe('a surface while its message is stored', () => {
  it('keeps what the user typed when the local message becomes the stored one', async () => {
    const form =
      '```a2ui\n' +
      [
        { version: V, createSurface: { surfaceId: 'f', catalogId: 'basic' } },
        { version: V, updateComponents: { surfaceId: 'f', components: [{ id: 'root', component: 'TextField', label: 'Title', value: { path: '/t' } }] } },
      ]
        .map((m) => JSON.stringify(m))
        .join('\n') +
      '\n```';
    function Live() {
      const messages = useChat((st) => st.messages.c1) ?? [];
      return <MessageList streaming={false} messages={messages} />;
    }
    useChat.getState().listen();
    await useChat.getState().load('c1');
    const emit = (update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId: 'c1', update })));
    render(<Live />);
    await emit({ kind: 'text', text: form });
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Selat');
    vi.mocked(addMessage).mockImplementationOnce(async (chatId, role, parts) => ({ id: 'stored-1', chatId, role, parts, createdAt: '' }));
    await emit({ kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(useChat.getState().messages.c1!.at(-1)!.id).toBe('stored-1'));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Selat');
  });
});

describe('skills preamble', () => {
  it('goes to user-facing sessions only, not the setup installs', async () => {
    for (const id of ['setup', 'c-user']) {
      vi.mocked(agentPrompt).mockClear();
      await useChat.getState().send(id, [{ type: 'text', text: 'go' }], { agentId: 'codex' });
      const sent = JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1]);
      expect(sent.includes('AskUserQuestion'), id).toBe(id !== 'setup');
    }
  });

  it("states the user's time zone, and the project id in a project chat, for Claude with the plugin too", async () => {
    await useChat.getState().send('c9', [{ type: 'text', text: 'go' }], { agentId: 'claude', job: { projectId: 'p7', title: 'Jalur Rempah' } });
    const lead = JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1][0]);
    expect(lead).toMatch(/The user's local time zone is .+ \(UTC[+-]\d\d:\d\d\)\. It was \w+day \d{4}-\d\d-\d\d \d\d:\d\d when this chat started\./);
    expect(lead).toContain("This feature's Buma id is p7.");
    expect(lead).not.toContain('createSurface'); // the plugin has the skills
    vi.mocked(agentPrompt).mockClear();
    await useChat.getState().send('c10', [{ type: 'text', text: 'go' }], { agentId: 'codex' });
    const text = JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1][0]);
    expect(text).toContain('# Using bspace SDLC');
    expect(text).toContain('time zone is');
    expect(text).not.toContain('Buma id is');
  });

  it('tells Claude with the plugin to run long work in the foreground', async () => {
    await useChat.getState().send('c9', [{ type: 'text', text: 'go' }], { agentId: 'claude', job: { projectId: 'p7', title: 'Jalur Rempah' } });
    const lead = vi.mocked(agentPrompt).mock.calls[0]![1][0]!;
    expect(lead.type === 'text' && lead.text).toContain(FOREGROUND_RULE);
  });
});

describe("the user's own skills", () => {
  const hooks = { id: 'hooks', description: 'Use for hooks', enabled: true, path: '/d/skills/hooks/SKILL.md' };

  it('are listed for agents without the plugin, once per session', async () => {
    vi.mocked(listSkills).mockResolvedValue([hooks]);
    vi.mocked(agentPrompt).mockClear();
    await useChat.getState().send('s1', [{ type: 'text', text: 'go' }], { agentId: 'codex' });
    expect(JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1])).toContain('- hooks: Use for hooks (/d/skills/hooks/SKILL.md)');
    // The first turn is over (otherwise the next message would wait in the queue).
    useChat.setState((s) => ({ streaming: { ...s.streaming, s1: false } }));
    await useChat.getState().send('s1', [{ type: 'text', text: 'more' }]);
    expect(JSON.stringify(vi.mocked(agentPrompt).mock.calls[1]![1])).not.toContain('hooks:');
  });

  it('are not listed for Claude, which loads them as a plugin', async () => {
    vi.mocked(listSkills).mockResolvedValue([hooks]);
    vi.mocked(agentPrompt).mockClear();
    await useChat.getState().send('s2', [{ type: 'text', text: 'go' }], { agentId: 'claude' });
    expect(JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1])).not.toContain('hooks:');
  });

  it("don't stop a chat when they can't be read", async () => {
    vi.mocked(listSkills).mockRejectedValue(new Error('no folder'));
    vi.mocked(agentPrompt).mockClear();
    await useChat.getState().send('s3', [{ type: 'text', text: 'go' }], { agentId: 'codex' });
    expect(vi.mocked(agentPrompt)).toHaveBeenCalledTimes(1);
    vi.mocked(listSkills).mockResolvedValue([]);
  });
});

describe('send agent fallback', () => {
  it("uses the chat's last agent, not the default, when none is given", async () => {
    vi.mocked(agentStart).mockClear();
    await useChat.getState().send('c1', [{ type: 'text', text: 'hi' }], { agentId: 'codex' });
    await useChat.getState().stop('c1');
    await useChat.getState().send('c1', [{ type: 'text', text: 'again' }]);
    expect(vi.mocked(agentStart).mock.calls.map((c) => c[1])).toEqual(['codex', 'codex']);
  });
});

describe('build jobs when a turn does not finish well', () => {
  const emitTo = (chatId: string, update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId, update })));
  const lastJob = () => vi.mocked(upsertJob).mock.calls.at(-1)![0];

  it("a user's Stop ends the job done with the stored Cancelled note, so it never needs them", async () => {
    useChat.getState().listen();
    await useChat.getState().send('j1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job: { projectId: 'p1', title: 'Attendance' } });
    await emitTo('j1', { kind: 'done', stopReason: 'cancelled' });
    await waitFor(() => expect(lastJob()).toMatchObject({ id: 'build-j1', status: 'done', note: 'Cancelled' }));
    expect(needsYou([lastJob()])).toBe(0);
  });

  it('retire stops the session; the next message starts a new one with a recap of the chat', async () => {
    useChat.getState().listen();
    await useChat.getState().send('r1', [{ type: 'text', text: 'Write the Blueprint' }], { agentId: 'claude' });
    await emitTo('r1', { kind: 'text', text: 'Wrote sdlc/blueprint.docx' });
    await emitTo('r1', { kind: 'done', stopReason: 'end_turn' });
    vi.mocked(agentStart).mockClear();
    await useChat.getState().retire('r1');
    expect(agentStop).toHaveBeenCalledWith('r1');
    expect(useChat.getState().started.r1).toBe(false);
    vi.mocked(agentPrompt).mockClear();
    await useChat.getState().send('r1', [{ type: 'text', text: 'Make it shorter' }]);
    expect(agentStart).toHaveBeenCalledWith('r1', 'claude');
    const sent = JSON.stringify(vi.mocked(agentPrompt).mock.calls[0]![1]);
    expect(sent).toContain('Earlier in this chat:');
    expect(sent).not.toContain('another agent');
    expect(sent).toContain('You: Write the Blueprint');
    expect(sent).toContain('Agent: Wrote sdlc/blueprint.docx');
  });
});
