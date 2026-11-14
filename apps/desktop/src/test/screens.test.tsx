import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, AgentUpdate, Job, PermissionRequest, Settings } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  apiUrlOverride: vi.fn().mockResolvedValue(null),
  listArchivedChats: vi.fn().mockResolvedValue([]),
  setThreadArchived: vi.fn().mockResolvedValue(undefined),
  purgeArchive: vi.fn().mockResolvedValue({ chats: 0, cards: 0 }),
  setJobsArchived: vi.fn().mockResolvedValue(undefined),
  listProjects: vi.fn(),
  openProjectFolder: vi.fn().mockResolvedValue(undefined),
  listChats: vi.fn(),
  createChat: vi.fn(),
  assetUrl: vi.fn((p: string) => `asset://localhost/${p}`),
  listJobs: vi.fn(),
  upsertJob: vi.fn(),
  deleteJob: vi.fn().mockResolvedValue(undefined),
  agentStart: vi.fn(),
  agentSetAuto: vi.fn(),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  pickFolder: vi.fn(),
  detectAgents: vi.fn(),
  accountsList: vi.fn().mockResolvedValue([]),
  agentActivity: vi.fn().mockResolvedValue([]),
  accountUse: vi.fn().mockResolvedValue(undefined),
  accountRemove: vi.fn().mockResolvedValue(undefined),
  accountSignOut: vi.fn().mockResolvedValue(undefined),
  checkTools: vi.fn(),
  getSystemInfo: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
}));
const updateHandlers: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
const permHandlers: ((r: PermissionRequest) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(async (f: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updateHandlers.push(f);
    return () => {};
  }),
  onPermission: vi.fn(async (f: (r: PermissionRequest) => void) => {
    permHandlers.push(f);
    return () => {};
  }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  authStart: vi.fn().mockResolvedValue({
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://bspace.buma.internal/api/auth/device',
    verificationUriComplete: 'https://bspace.buma.internal/api/auth/device?code=ABCD-EFGH',
    expiresIn: 600,
  }),
  authCancel: vi.fn().mockResolvedValue(undefined),
  authStatus: vi.fn().mockResolvedValue({ state: 'signed-out', signedIn: false, offline: false, apiUrl: 'https://bspace.buma.internal/api' }),
  authLogout: vi.fn(),
  onAuthChanged: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@/lib/scheduler', () => ({ sendTestNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ enable: vi.fn(), disable: vi.fn() }));

import * as ipc from '@/lib/ipc';
import { sendTestNotification } from '@/lib/scheduler';
import * as autostart from '@tauri-apps/plugin-autostart';
import { Settings as SettingsScreen } from '@/screens/Settings';
import { Agents as AgentsScreen } from '@/screens/Agents';
import { useApp } from '@/state/app';
import { setUiLanguage } from '@/i18n';

const settings: Settings = {
  workingFolder: '/w/Buma',
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

const agents: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', installed: true, version: '1.0', acpCommand: [], recommended: true },
  { id: 'gemini', name: 'Gemini CLI', installed: false, version: null, acpCommand: [], recommended: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ settings, needsYouCount: 0, route: { name: 'features' } });
  vi.mocked(ipc.listProjects).mockResolvedValue([]);
  vi.mocked(ipc.listJobs).mockResolvedValue([]);
  vi.mocked(ipc.detectAgents).mockResolvedValue(agents);
  vi.mocked(ipc.checkTools).mockResolvedValue([]);
  vi.mocked(ipc.getSystemInfo).mockResolvedValue({ os: 'macos', osVersion: '15', packageManager: 'brew' });
  vi.mocked(ipc.updateSettings).mockImplementation(async (p) => ({ ...settings, ...p }));
});




/** Settings shows one tab at a time: open the one a test is about. */
const openSettingsTab = (tab: string) => useApp.setState({ route: { name: 'settings', tab } });
/** The Agents screen (in the sidebar since it grew out of Settings): Provider or Usage. */
const openAgents = (tab: 'provider' | 'usage' = 'provider') => useApp.setState({ route: { name: 'agents', tab } });

describe('Settings', () => {
  it('Account lists the AI accounts in use: Claude with its email and plan, the default marked', async () => {
    const { useClaudeAccount } = await import('@/state/claudeAccount');
    useClaudeAccount.setState({ account: { signedIn: true, email: 'rama@buma.co.id', plan: 'max' }, refresh: async () => {} });
    vi.mocked(ipc.detectAgents).mockResolvedValue([
      ...agents,
      { id: 'codex', name: 'Codex', installed: true, version: '0.5', acpCommand: [], recommended: false },
    ]);
    useApp.setState({ route: { name: 'settings', tab: 'account' } });
    render(<SettingsScreen />);
    expect(await screen.findByRole('heading', { name: 'AI accounts' })).toBeInTheDocument();
    const claude = await screen.findByTestId('ai-account-claude');
    expect(claude).toHaveTextContent('rama@buma.co.id · max plan');
    expect(claude).toHaveTextContent('Default');
    expect(screen.getByTestId('ai-account-codex')).toHaveTextContent('Not signed in');
    expect(within(screen.getByTestId('ai-account-codex')).getByRole('button', { name: 'Manage in Agents' })).toBeInTheDocument();
    expect(screen.queryByTestId('ai-account-gemini')).toBeNull();
  });

  it('Agents › Provider: loads everything first, then shows who is signed in on each account chip', async () => {
    const { useClaudeAccount } = await import('@/state/claudeAccount');
    const { useAccounts } = await import('@/state/accounts');
    useAccounts.setState({ list: null });
    useClaudeAccount.setState({ account: null, refresh: async () => {} });
    const signOut = vi.fn(async () => {});
    let finishAccounts: (v: unknown) => void = () => {};
    vi.mocked(ipc.accountsList).mockReturnValueOnce(new Promise((r) => (finishAccounts = r)) as never);
    vi.mocked(ipc.accountsList).mockResolvedValue([
      { id: 'default', agent: 'claude', account: 'rama@buma.co.id', signedIn: true, active: true },
      { id: 'acc-2', agent: 'claude', account: 'second@buma.co.id', signedIn: true, active: false },
    ]);
    vi.mocked(ipc.detectAgents).mockResolvedValue([{ id: 'claude', name: 'Claude Code', installed: true, version: '2.1', acpCommand: [], recommended: true }]);
    openAgents();
    render(<AgentsScreen />);
    // Nothing until it is all in.
    expect(await screen.findByText('Load Provider…')).toBeInTheDocument();
    expect(screen.queryByTestId('accounts-claude')).toBeNull();
    useClaudeAccount.setState({ account: { signedIn: true, email: 'rama@buma.co.id', plan: 'max' }, signOut });
    finishAccounts([
      { id: 'default', agent: 'claude', account: 'rama@buma.co.id', signedIn: true, active: true },
      { id: 'acc-2', agent: 'claude', account: 'second@buma.co.id', signedIn: true, active: false },
    ]);
    const chips = await screen.findByTestId('accounts-claude');
    expect(chips).toHaveTextContent('rama@buma.co.id');
    expect(chips).toHaveTextContent('second@buma.co.id');
    // The row's + is always there: a connected Claude adds another account with it.
    expect(screen.getByTestId('connection-claude')).toHaveAccessibleName('Add a connection to Claude Code');
    await userEvent.click(within(chips).getByRole('button', { name: 'Sign out rama@buma.co.id' }));
    // Buma's own Claude folder: signed out at once, no question (it is not the Claude Code app's sign-in).
    expect(ipc.accountSignOut).toHaveBeenCalledWith('claude', 'default');
    await userEvent.click(within(chips).getByRole('button', { name: 'Remove second@buma.co.id' }));
    expect(ipc.accountRemove).toHaveBeenCalledWith('claude', 'acc-2');
  });

  it('Agents opens on Usage, the first tab; then Provider and Combo', async () => {
    useApp.setState({ route: { name: 'agents' } });
    render(<AgentsScreen />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Usage', 'Provider', 'Combo']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows one tab at a time and remembers the last one', async () => {
    localStorage.clear();
    useApp.setState({ route: { name: 'settings' } });
    const { unmount } = render(<SettingsScreen />);
    expect(await screen.findByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    // General holds the app's own switches now (Agents moved to the sidebar).
    expect(await screen.findByRole('switch', { name: 'Keep Buma running in the background' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Provider' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(screen.queryByRole('switch', { name: 'Keep Buma running in the background' })).toBeNull();
    unmount();
    render(<SettingsScreen />);
    expect(await screen.findByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    localStorage.clear();
  });

  it("How to install opens the agent's own install guide, not onboarding", async () => {
    vi.mocked(ipc.detectAgents).mockResolvedValue([
      { id: 'antigravity', name: 'Antigravity CLI', installed: false, version: null, acpCommand: ['agy', 'acp'], recommended: false },
    ] as never);
    openAgents();
    render(<AgentsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection to Antigravity CLI' }));
    expect(await screen.findByRole('dialog', { name: 'Connect Antigravity CLI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    const link = screen.getByRole('link', { name: 'Open the installer' });
    expect(link).toHaveAttribute('href', 'https://antigravity.google/docs/getting-started?tab=cli');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('background mode saves through updateSettings; open at login is disabled until it is on', async () => {
    openSettingsTab('general');
    render(<SettingsScreen />);
    expect(await screen.findByRole('switch', { name: 'Open at login' })).toBeDisabled();
    const bg = screen.getByRole('switch', { name: 'Keep Buma running in the background' });
    expect(bg).not.toBeChecked();
    await userEvent.click(bg);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ backgroundMode: true }));
  });

  it('says so, in the user language, when there is no system tray for background mode, and shows it off', async () => {
    vi.mocked(ipc.updateSettings).mockRejectedValueOnce(new Error('tray-unavailable'));
    vi.mocked(ipc.getSettings).mockResolvedValue({ ...settings, backgroundMode: false });
    openSettingsTab('general');
    render(<SettingsScreen />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Keep Buma running in the background' }));
    expect(await screen.findByText("Background mode needs a system tray, which isn't available here")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'Keep Buma running in the background' })).not.toBeChecked();
    expect(ipc.getSettings).toHaveBeenCalled();
  });

  it('the test notification button sends one and explains what to check; a denial or error is said too', async () => {
    vi.mocked(sendTestNotification).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('no toast'));
    openSettingsTab('general');
    render(<SettingsScreen />);
    const btn = await screen.findByRole('button', { name: 'Send a test notification' });
    await userEvent.click(btn);
    expect(await screen.findByText(/Test notification sent\. If you don't see it/)).toBeInTheDocument();
    await userEvent.click(btn);
    expect(await screen.findByText(/Notifications can't show/)).toBeInTheDocument();
    await userEvent.click(btn);
    expect(await screen.findByText("Couldn't send it: no toast")).toBeInTheDocument();
  });

  it('the test notification button is in Indonesian too', async () => {
    setUiLanguage('id');
    openSettingsTab('general');
    render(<SettingsScreen />);
    expect(await screen.findByRole('button', { name: 'Kirim notifikasi percobaan' })).toBeInTheDocument();
  });

  it('open at login enables the OS login item, then saves', async () => {
    useApp.setState({ settings: { ...settings, backgroundMode: true } });
    openSettingsTab('general');
    render(<SettingsScreen />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Open at login' }));
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ openAtLogin: true }));
    expect(autostart.enable).toHaveBeenCalledTimes(1);
  });

  it('shows an error and keeps the setting when the OS login item fails', async () => {
    vi.mocked(autostart.enable).mockRejectedValueOnce(new Error('denied by the system'));
    useApp.setState({ settings: { ...settings, backgroundMode: true } });
    openSettingsTab('general');
    render(<SettingsScreen />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Open at login' }));
    expect(await screen.findByText(/Couldn't change that: denied by the system/)).toBeInTheDocument();
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('turning the background off also turns off open at login', async () => {
    useApp.setState({ settings: { ...settings, backgroundMode: true, openAtLogin: true } });
    openSettingsTab('general');
    render(<SettingsScreen />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Keep Buma running in the background' }));
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ backgroundMode: false, openAtLogin: false }));
    expect(autostart.disable).toHaveBeenCalledTimes(1);
  });

  it('toggles auto mode through updateSettings and explains it', async () => {
    openAgents();
    render(<AgentsScreen />);
    const sw = await screen.findByRole('switch', { name: 'Auto mode for chats' });
    expect(sw).not.toBeChecked();
    expect(
      screen.getByText(
        "Your agent runs commands without asking. Claude Code reviews risky steps itself; other agents' requests are approved one at a time.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ autoMode: true }));
  });

  it('toggles shareInstallStats through updateSettings and explains what is sent', async () => {
    openSettingsTab('account');
    render(<SettingsScreen />);
    const sw = await screen.findByRole('switch', { name: 'Share anonymous usage stats' });
    expect(sw).toBeChecked();
    expect(
      screen.getByText('Sends a random install ID, your system, the app version and which features you use (a chat started, a skill imported). Nothing about you or your projects.'),
    ).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ shareInstallStats: false }));
  });

  it('says existing projects stay put when the working folder changes', async () => {
    openSettingsTab('general');
    render(<SettingsScreen />);
    expect(await screen.findByText('Existing projects stay where they are')).toBeInTheDocument();
  });
});
