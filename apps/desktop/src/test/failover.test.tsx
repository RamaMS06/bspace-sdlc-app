import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentInfo } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  agentActivity: vi.fn(),
  agentModels: vi.fn().mockResolvedValue(null),
  agentModelCatalog: vi.fn().mockResolvedValue([]),
  accountsList: vi.fn().mockResolvedValue([]),
  accountSignOut: vi.fn().mockResolvedValue(undefined),
}));

import * as ipc from '@/lib/ipc';
import { failoverReason, singlePick, stepKey, useFailover, COOLDOWN_MS, type Step } from '@/state/failover';
import { CombosTab } from '@/components/Combos';
import { AgentRoute, groupModels, modelFamily } from '@/components/FailoverCard';
import { useModels } from '@/state/models';
import { AgentUsage, bucketize, LIVE_MS, parseActivity, rangeStart } from '@/components/AgentUsage';

/** The store with one combo, "Default", of these steps. */
const COMBO = (steps: Step[]) => ({ combos: [{ id: 'default', name: 'Default', steps }], defaultCombo: 'default', chatPick: {}, ready: [] as AgentInfo['id'][] });

const agent = (id: AgentInfo['id'], installed = true): AgentInfo => ({ id, name: id, installed, version: null, acpCommand: [], recommended: false });

describe('failover rules', () => {
  it('tells a limit, a sign-in failure and a dead agent apart', () => {
    expect(failoverReason('Claude AI usage limit reached|1700000000')).toBe('limit');
    expect(failoverReason('429 Too Many Requests')).toBe('limit');
    expect(failoverReason('Authentication required (-32000)')).toBe('auth');
    expect(failoverReason('agent process exited with code 1')).toBe('down');
    expect(failoverReason('The agent reported an error: boom')).toBeNull();
    // Codex with a ChatGPT account and an API-only model: the model, not the limit.
    expect(
      failoverReason(
        'The agent reported an error: Internal error ({"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.5\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}})',
      ),
    ).toBe('model');
    expect(
      failoverReason(
        'The agent reported an error: Internal error ({"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6-terra\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}})',
      ),
    ).toBe('model');
  });

  it("goes through the combo's steps in order, skipping resting ones and wrapping round", () => {
    useFailover.setState({
      ...COMBO([{ agent: 'claude', model: 'claude-opus-5-5' }, { agent: 'claude', model: 'claude-sonnet-5-5' }, { agent: 'codex', model: null }]),
      accounts: {},
      incompatible: {},
      cooldown: {},
    });
    const fo = useFailover.getState();
    expect(fo.steps()).toEqual([
      { agent: 'claude', model: 'claude-opus-5-5' },
      { agent: 'claude', model: 'claude-sonnet-5-5' },
      { agent: 'codex', model: null },
    ]);
    const now = 1_000;
    const opus = { agent: 'claude' as const, model: 'claude-opus-5-5' };
    fo.rest(opus, 'limit', now);
    expect(useFailover.getState().cooldown[stepKey(opus)]).toBe(now + COOLDOWN_MS.limit);
    expect(fo.next(opus, now)).toEqual({ agent: 'claude', model: 'claude-sonnet-5-5' });
    fo.rest({ agent: 'claude', model: 'claude-sonnet-5-5' }, 'limit', now);
    expect(fo.next({ agent: 'claude', model: 'claude-sonnet-5-5' }, now)).toEqual({ agent: 'codex', model: null });
    // A model picked by hand that is not in the combo: on to the next agent.
    expect(fo.next({ agent: 'claude', model: 'haiku' }, now)).toEqual({ agent: 'codex', model: null });
    fo.rest({ agent: 'codex', model: null }, 'down', now);
    expect(fo.next({ agent: 'codex', model: null }, now)).toBeNull();
    fo.wake('claude');
    expect(fo.next({ agent: 'codex', model: null }, now)).toEqual(opus);
  });

  it('a chat on one model on its own has that one step; a removed combo sends its chats back to the default', () => {
    useFailover.setState({ ...COMBO([{ agent: 'claude', model: null }]), accounts: {}, incompatible: {}, cooldown: {} });
    const fo = useFailover.getState();
    fo.setPick('c1', singlePick('codex', 'gpt-6.1-sol'));
    expect(fo.steps(fo.pickOf('c1'))).toEqual([{ agent: 'codex', model: 'gpt-6.1-sol' }]);
    const id = fo.addCombo('Reasoning', [{ agent: 'claude', model: 'claude-opus-5-5' }]);
    fo.setPick('c2', id);
    expect(useFailover.getState().pickOf('c2')).toBe(id);
    useFailover.getState().removeCombo(id);
    expect(useFailover.getState().pickOf('c2')).toBe('default');
    // The New chat screen's pick goes with the chat it makes.
    useFailover.getState().setPick(null, id);
    useFailover.getState().adoptPick('c3');
    expect(useFailover.getState().chatPick.c3).toBe(id);
  });

  it('steps on agents not set up here are skipped', () => {
    useFailover.setState({ ...COMBO([{ agent: 'gemini', model: null }, { agent: 'claude', model: null }]), ready: ['claude'], accounts: {}, incompatible: {}, cooldown: {} });
    expect(useFailover.getState().steps()).toEqual([{ agent: 'claude', model: null }]);
  });
});

describe('Agents › Provider and Combo', () => {
  it('Provider lists connections only: no ticks, no order, no models', async () => {
    render(<AgentRoute agents={[agent('claude'), agent('codex'), agent('gemini', false)]} actions={() => null} />);
    expect(await screen.findByTestId('failover-claude')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
    // Combos skip agents that are not set up.
    await waitFor(() => expect(useFailover.getState().ready).toEqual(['claude', 'codex']));
  });

  it('makes a combo, adds models from any connected agent, orders them and stars it for new chats', async () => {
    useFailover.setState({ ...COMBO([{ agent: 'claude', model: null }]), accounts: {}, incompatible: {}, cooldown: {} });
    const user = userEvent.setup();
    render(<CombosTab agents={[agent('claude'), agent('codex')]} />);
    await user.click(screen.getByRole('button', { name: 'New combo' }));
    const combo = useFailover.getState().combos[1]!;
    const card = screen.getByTestId(`combo-${combo.id}`);
    await user.click(within(card).getByRole('button', { name: 'Model' }));
    const menu = await screen.findByTestId('step-menu');
    await user.click(within(within(menu).getByRole('group', { name: 'Claude Code' })).getByRole('button', { name: /^Opus 5\.5/ }));
    await user.click(within(card).getByRole('button', { name: 'Model' }));
    await user.click(within(within(await screen.findByTestId('step-menu')).getByRole('group', { name: 'Codex' })).getByRole('button', { name: 'Default model' }));
    expect(useFailover.getState().combos[1]!.steps).toEqual([
      { agent: 'claude', model: 'claude-opus-5-5' },
      { agent: 'codex', model: null },
    ]);
    await user.click(within(card).getByRole('button', { name: 'Move Codex · Default model up' }));
    expect(useFailover.getState().combos[1]!.steps[0]).toEqual({ agent: 'codex', model: null });
    await user.click(within(card).getByRole('button', { name: `Use ${combo.name} for new chats` }));
    expect(useFailover.getState().defaultCombo).toBe(combo.id);
    await user.click(within(card).getByRole('button', { name: `Delete ${combo.name}` }));
    expect(useFailover.getState().combos).toHaveLength(1);
    expect(useFailover.getState().defaultCombo).toBe('default');
  });
});

describe('Settings › Agents › Usage', () => {
  const lines = [
    { agent: 'claude', at: new Date(Date.now() - 120_000).toISOString(), chat: 'a', model: 'sonnet', cost: { amount: 0.1 }, usage: { inputTokens: 10, cachedWriteTokens: 5, cachedReadTokens: 100, outputTokens: 20 } },
    { agent: 'claude', at: new Date(Date.now() - 60_000).toISOString(), chat: 'a', model: 'sonnet', cost: { amount: 0.25 }, usage: { inputTokens: 1, cachedReadTokens: 50, outputTokens: 4 } },
    { event: 'failover', at: new Date(Date.now() - 30_000).toISOString(), chat: 'a', from: 'claude', to: 'codex', reason: 'limit' },
    { agent: 'codex', at: new Date(Date.now() - 10_000).toISOString(), chat: 'a', model: 'gpt-5', usage: { inputTokens: 7, outputTokens: 3 } },
    { agent: 'codex', at: '2020-01-01T00:00:00Z', chat: 'old', usage: { inputTokens: 999 } },
  ];

  it('turns the log into turns with per-turn cost, and failovers', () => {
    const { turns, failovers } = parseActivity(lines);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toMatchObject({ input: 15, cached: 100, output: 20, cost: 0.1 });
    expect(turns[1]!.cost).toBeCloseTo(0.15);
    expect(failovers).toEqual([expect.objectContaining({ from: 'claude', to: 'codex', reason: 'limit' })]);
    expect(rangeStart('all')).toBe(0);
  });

  it('shows the tokens and how they split, tokens over time, the route and recent activity', async () => {
    vi.mocked(ipc.agentActivity).mockResolvedValue(lines);
    useFailover.setState({ on: true, ...COMBO([{ agent: 'claude', model: null }, { agent: 'codex', model: null }]), accounts: {}, incompatible: {}, cooldown: { 'claude/': Date.now() + 60_000 } });
    const user = userEvent.setup();
    render(<AgentUsage />);
    // Today: three turns (the 2020 one is out of range): 15+100+20 + 1+50+4 + 7+3 tokens.
    expect(await screen.findByTestId('usage-total')).toHaveTextContent('200');
    expect(screen.getByTestId('split-cached')).toHaveTextContent('150');
    expect(screen.getByTestId('tile-turns')).toHaveTextContent('3');
    expect(screen.getByTestId('tile-cost')).toHaveTextContent('~$0.25');
    expect(screen.getByTestId('tile-failovers')).toHaveTextContent('1');
    expect(screen.getByTestId('route-codex/')).toHaveAttribute('data-status', 'active');
    expect(screen.getByTestId('route-claude/')).toHaveAttribute('data-status', 'resting');
    expect(screen.getAllByTestId('recent-turn')).toHaveLength(3);
    expect(screen.getByTestId('recent-failover')).toHaveTextContent('moved to Codex');
    expect(screen.getByRole('list', { name: 'Tokens per hour' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByTestId('tile-turns')).toHaveTextContent('4');
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByRole('region', { name: 'Tokens over time' }).querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('puts turns into hours for a day and days for a week', () => {
    const now = new Date('2026-11-14T12:30:00').getTime();
    const turn = (at: number) => ({ at, chat: 'a', agent: 'claude' as const, model: 'm', input: 1, cached: 0, output: 1, cost: 0 });
    const day = bucketize([turn(now - 3_600_000), turn(now)], '24h', now);
    expect(day.unit).toBe('hour');
    expect(day.buckets.reduce((n, b) => n + b.tokens, 0)).toBe(4);
    const week = bucketize([turn(now)], '7d', now);
    expect(week.unit).toBe('day');
    expect(week.buckets).toHaveLength(8);
  });

});

describe('the + Model menu', () => {
  it('groups every version by family, with shortcuts last', () => {
    const groups = groupModels('claude', [
      { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
      { value: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { value: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5' },
    ]);
    expect(groups.map((g) => [g.family, g.items.length])).toEqual([
      ['Opus', 2],
      ['Sonnet', 1],
      ['Haiku', 1],
      [null, 1],
    ]);
    expect(modelFamily('opencode', 'openai/gpt-5.5')).toBe('openai');
    expect(modelFamily('codex', 'gpt-5.5-codex')).toBe('GPT');
  });

  it('the model menu lists the full catalog, grouped by family, and searches it', async () => {
    vi.mocked(ipc.agentModelCatalog).mockResolvedValue([
      { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { value: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
      { value: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    ]);
    useModels.setState({ catalog: {}, catalogLoading: {} });
    await useModels.getState().loadCatalog('claude', true);
    useFailover.setState({ ...COMBO([]), accounts: {}, incompatible: {}, cooldown: {} });
    const user = userEvent.setup();
    render(<CombosTab agents={[agent('claude')]} />);
    await user.click(screen.getByRole('button', { name: 'Model' }));
    const menu = await screen.findByTestId('step-menu');
    expect(within(menu).getByRole('button', { name: /^Claude Opus 4\.1/ })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'haiku');
    expect(within(menu).queryByRole('button', { name: /^Claude Opus/ })).toBeNull();
    await user.click(within(menu).getByRole('button', { name: /^Claude Haiku 5\.5/ }));
    expect(useFailover.getState().combos[0]!.steps).toEqual([{ agent: 'claude', model: 'claude-haiku-5-5' }]);
  });
});

describe('accounts on the route', () => {
  it('goes through each signed-in account of an agent before the next agent', () => {
    useFailover.setState({ ...COMBO([{ agent: 'claude', model: 'claude-opus-5-5' }, { agent: 'codex', model: null }]), accounts: { claude: ['default', 'acc-2'] }, incompatible: {}, cooldown: {} });
    const fo = useFailover.getState();
    expect(fo.steps()).toEqual([
      { agent: 'claude', model: 'claude-opus-5-5' },
      { agent: 'claude', account: 'acc-2', model: 'claude-opus-5-5' },
      { agent: 'codex', model: null },
    ]);
    expect(stepKey({ agent: 'claude', account: 'acc-2', model: 'x' })).toBe('claude@acc-2/x');
    expect(stepKey({ agent: 'claude', account: 'default', model: 'x' })).toBe('claude/x');
    const now = 5;
    fo.rest({ agent: 'claude', model: 'claude-opus-5-5' }, 'limit', now);
    expect(fo.next({ agent: 'claude', account: 'default', model: 'claude-opus-5-5' }, now)).toEqual({ agent: 'claude', account: 'acc-2', model: 'claude-opus-5-5' });
    fo.wake('claude');
    expect(useFailover.getState().cooldown).toEqual({});
  });
});

describe('account chips', () => {
  const codexAgent = { ...agent('codex'), signedIn: true, account: 'uiux@buma.co.id' };
  it('a failed sign-in shows only under its own agent (every agent has a default account)', async () => {
    const { useAccounts } = await import('@/state/accounts');
    vi.mocked(ipc.accountsList).mockResolvedValue([
      { id: 'default', agent: 'codex', account: 'uiux@buma.co.id', signedIn: true, active: true },
      { id: 'default', agent: 'opencode', account: null, signedIn: false, active: true },
    ]);
    render(<AgentRoute agents={[codexAgent, agent('opencode')]} actions={() => null} />);
    await screen.findByText('uiux@buma.co.id');
    act(() => useAccounts.setState({ failed: { 'opencode/default': 'Configuration is invalid' }, signingIn: { 'opencode/default': false } }));
    expect(within(screen.getByTestId('accounts-opencode')).getByText('Configuration is invalid')).toBeInTheDocument();
    expect(within(screen.getByTestId('accounts-codex')).queryByText('Configuration is invalid')).toBeNull();
  });

  it("signing out of the Codex app's own sign-in asks first, then signs it out", async () => {
    vi.mocked(ipc.accountsList).mockResolvedValue([{ id: 'default', agent: 'codex', account: 'uiux@buma.co.id', signedIn: true, active: true }]);
    const user = userEvent.setup();
    render(<AgentRoute agents={[codexAgent]} actions={() => null} />);
    await user.click(await screen.findByRole('button', { name: 'Sign out uiux@buma.co.id' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out of Codex?' });
    expect(ipc.accountSignOut).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(ipc.accountSignOut).toHaveBeenCalledWith('codex', 'default');
  });

  it('Gemini (one account) shows who is signed in as a chip with sign out', async () => {
    render(<AgentRoute agents={[{ ...agent('gemini'), signedIn: true, account: 'g@buma.co.id' }]} actions={() => null} />);
    expect(await screen.findByRole('button', { name: 'Sign out g@buma.co.id' })).toBeInTheDocument();
  });
});

describe('models an account refused', () => {
  it('are hidden for that account and leave the route', () => {
    useFailover.setState({ ...COMBO([{ agent: 'codex', model: 'gpt-5.5' }, { agent: 'codex', model: 'gpt-5.5-codex' }, { agent: 'claude', model: null }]), accounts: {}, incompatible: {}, cooldown: {} });
    useFailover.getState().markIncompatible('codex', 'default', 'gpt-5.5');
    expect(useFailover.getState().isCompatible('codex', null, 'gpt-5.5')).toBe(false);
    expect(useFailover.getState().isCompatible('codex', 'other', 'gpt-5.5')).toBe(true);
    expect(useFailover.getState().steps()).toEqual([
      { agent: 'codex', model: 'gpt-5.5-codex' },
      { agent: 'claude', model: null },
    ]);
  });
});

describe("Codex: the account's own model list", () => {
  it('offers only the models the account has, and hides the ones it lacks', async () => {
    const { useAccounts } = await import('@/state/accounts');
    useAccounts.setState({ list: [{ id: 'default', agent: 'codex', account: 'u@buma.co.id', signedIn: true, active: true }] });
    useModels.setState({ catalog: {}, catalogLoading: {}, byAgent: { codex: { current: null, options: [{ value: 'gpt-5.5', name: 'GPT-5.5' }] } } });
    vi.mocked(ipc.agentModelCatalog).mockResolvedValue([
      { value: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      { value: 'gpt-6-astra', name: 'GPT-6-Astra' },
    ]);
    useFailover.setState({ ...COMBO([{ agent: 'codex', model: 'gpt-5.5' }]), accounts: {}, incompatible: {}, cooldown: {} });
    useFailover.getState().setModels('codex', ['gpt-5.5']);
    await useModels.getState().loadCatalog('codex', true);
    // gpt-5.5 (API only) is hidden for this ChatGPT account, so its step is skipped.
    expect(useFailover.getState().isCompatible('codex', 'default', 'gpt-5.5')).toBe(false);
    expect(useFailover.getState().steps()).toEqual([]);
    const user = userEvent.setup();
    render(<CombosTab agents={[agent('codex')]} />);
    await user.click(screen.getByRole('button', { name: 'Model' }));
    const menu = await screen.findByTestId('step-menu');
    expect(within(menu).getByRole('button', { name: /^GPT-6\.1-Sol/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /^GPT-5\.5/ })).toBeNull();
  });
});

describe('Usage is live', () => {
  it('reads the activity log again on its own while open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(ipc.agentActivity).mockResolvedValue([]);
      render(<AgentUsage />);
      await act(async () => {});
      const before = vi.mocked(ipc.agentActivity).mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(LIVE_MS + 10);
      });
      expect(vi.mocked(ipc.agentActivity).mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
