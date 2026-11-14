import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Settings } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  systemLocale: vi.fn(),
  listProjects: vi.fn().mockResolvedValue([]),
  detectAgents: vi.fn().mockResolvedValue([]),
  listRecentChats: vi.fn().mockResolvedValue([]),
  listArchivedChats: vi.fn().mockResolvedValue([]),
  setThreadArchived: vi.fn().mockResolvedValue(undefined),
  purgeArchive: vi.fn().mockResolvedValue({ chats: 0, cards: 0 }),
  setJobsArchived: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(), onPermission: vi.fn() }));

import { getSettings, systemLocale, updateSettings } from '@/lib/ipc';
import App from '@/App';
import { useApp } from '@/state/app';

const base: Settings = {
  workingFolder: '/tmp/Buma',
  defaultAgent: 'claude',
  onboarded: false,
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

describe('App start', () => {
  beforeEach(() => useApp.setState({ route: { name: 'welcome' }, settings: null }));

  it('shows welcome when not onboarded', async () => {
    vi.mocked(getSettings).mockResolvedValue(base);
    render(<App />);
    expect(await screen.findByText('Get started')).toBeInTheDocument();
  });

  it('goes to a new chat when onboarded', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...base, onboarded: true });
    render(<App />);
    expect(await screen.findByText('What are we building?', { selector: 'h1' })).toBeInTheDocument();
    expect(useApp.getState().route.name).toBe('chat-new');
  });
});

describe('App interface language', () => {
  beforeEach(() => useApp.setState({ route: { name: 'welcome' }, settings: null }));

  it('first run: asks the system (through Rust) for its language, not the webview', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    vi.mocked(systemLocale).mockResolvedValue('id-ID');
    vi.mocked(getSettings).mockResolvedValue(base);
    vi.mocked(updateSettings).mockClear().mockImplementation(async (p) => ({ ...base, ...p }));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledWith({ uiLanguage: 'id' });
    vi.mocked(systemLocale).mockReset();
    vi.restoreAllMocks();
  });

  it('first run: keeps the language in the store when saving it fails', async () => {
    vi.mocked(systemLocale).mockResolvedValue('id_ID');
    vi.mocked(getSettings).mockResolvedValue(base);
    vi.mocked(updateSettings).mockClear().mockRejectedValue(new Error('disk full'));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    expect(useApp.getState().settings?.uiLanguage).toBe('id');
    vi.mocked(systemLocale).mockReset();
  });

  it('first run: falls back to the webview language when Rust cannot say', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('id-ID');
    vi.mocked(systemLocale).mockRejectedValue(new Error('no locale'));
    vi.mocked(getSettings).mockResolvedValue(base);
    vi.mocked(updateSettings).mockClear().mockImplementation(async (p) => ({ ...base, ...p }));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    vi.mocked(systemLocale).mockReset();
    vi.restoreAllMocks();
  });

  it('first run: follows an Indonesian system language, saves it, and sets <html lang>', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('id-ID');
    vi.mocked(getSettings).mockResolvedValue(base);
    vi.mocked(updateSettings).mockClear().mockImplementation(async (p) => ({ ...base, ...p }));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledWith({ uiLanguage: 'id' });
    expect(document.documentElement.lang).toBe('id');
    vi.restoreAllMocks();
  });

  it('a saved language wins over the system language and is not saved again', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('id-ID');
    vi.mocked(getSettings).mockResolvedValue({ ...base, uiLanguage: 'en' });
    vi.mocked(updateSettings).mockClear();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('App settings failure', () => {
  it('shows an error with Try again instead of a blank window', async () => {
    useApp.setState({ route: { name: 'welcome' }, settings: null });
    vi.mocked(getSettings).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(base);
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();
    expect(await screen.findByText('Get started')).toBeInTheDocument();
  });
});
