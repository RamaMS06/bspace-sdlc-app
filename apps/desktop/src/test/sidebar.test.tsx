import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { RecentChat } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  listRecentChats: vi.fn(),
  listArchivedChats: vi.fn().mockResolvedValue([]),
  setThreadArchived: vi.fn().mockResolvedValue(undefined),
  purgeArchive: vi.fn().mockResolvedValue({ chats: 0, cards: 0 }),
  setJobsArchived: vi.fn().mockResolvedValue(undefined),
}));

import { listRecentChats } from '@/lib/ipc';
import { Sidebar } from '@/components/Sidebar';
import { useApp } from '@/state/app';

const mk = (id: string, title: string, projectTitle: string | null): RecentChat => ({
  id,
  projectId: projectTitle ? `p-${id}` : null,
  agentId: 'claude',
  title,
  createdAt: '2026-11-01T00:00:00Z',
  projectTitle,
  activeAt: '2026-11-01T00:00:00Z',
});

describe('Sidebar', () => {
  beforeEach(() => {
    vi.mocked(listRecentChats).mockResolvedValue([
      mk('a', 'chat a', 'Kenapa rupiah melemah?'),
      mk('b', 'Ide konten minggu ini', null),
      mk('c', 'chat c', 'Promo Kopi Senja'),
    ]);
  });

  it('marks the active item, shows New chat and recent chats', async () => {
    render(<Sidebar active="workflow" />);
    expect(screen.getByRole('link', { name: /^Workflow/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^New/ })).not.toHaveAttribute('aria-current', 'page');
    // New is the menu item: there is no separate New chat button.
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(await screen.findByText('Kenapa rupiah melemah?')).toBeInTheDocument();
    expect(screen.getByText('Ide konten minggu ini')).toBeInTheDocument();
    expect(screen.getByText('Promo Kopi Senja')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('shows the needs-you count on Workflow only when above zero', () => {
    useApp.setState({ needsYouCount: 2 });
    const { unmount } = render(<Sidebar active="chat" />);
    expect(screen.getByRole('link', { name: /^Workflow/ })).toHaveTextContent('2');
    unmount();
    useApp.setState({ needsYouCount: 0 });
    render(<Sidebar active="chat" />);
    expect(screen.getByRole('link', { name: /^Workflow/ })).not.toHaveTextContent(/\d/);
  });

  it('lists New, Workflow, Agents and Skills in that order; Workflow and Agents open their screens', async () => {
    render(<Sidebar active="workflow" />);
    const names = screen.getAllByRole('link').map((l) => l.getAttribute('aria-label') ?? l.textContent ?? '');
    const at = (re: RegExp) => names.findIndex((n) => re.test(n));
    expect(at(/^Workflow/)).toBe(at(/^New/) + 1);
    expect(at(/^Agents/)).toBe(at(/^Workflow/) + 1);
    expect(at(/^Skills/)).toBe(at(/^Agents/) + 1);
    expect(names.some((n) => /^Features/.test(n))).toBe(false);
    await userEvent.click(screen.getByRole('link', { name: /^Workflow/ }));
    expect(useApp.getState().route).toEqual({ name: 'workflow' });
    await userEvent.click(screen.getByRole('link', { name: /^Agents/ }));
    expect(useApp.getState().route).toEqual({ name: 'agents' });
  });
});

describe('leave guard', () => {
  it('a guard that says no keeps the route; removing it lets navigation through', () => {
    useApp.setState({ route: { name: 'settings' }, leaveGuard: null });
    const guard = vi.fn(() => false);
    useApp.getState().setLeaveGuard(guard);
    useApp.getState().navigate({ name: 'features' });
    expect(guard).toHaveBeenCalledWith({ name: 'features' });
    expect(useApp.getState().route).toEqual({ name: 'settings' });
    useApp.getState().setLeaveGuard(null);
    useApp.getState().navigate({ name: 'features' });
    expect(useApp.getState().route).toEqual({ name: 'features' });
  });
});

describe('sidebar account', () => {
  it('always shows who is signed in to Azure DevOps, and opens Settings › Account', async () => {
    const { useDevops } = await import('@/state/devops');
    useDevops.setState({ status: { signedIn: true, profile: { org: 'buma', id: 'u', displayName: 'Rama Sugiyanto', email: 'rama@buma.co.id' } } });
    render(<Sidebar active="chat" />);
    const row = await screen.findByTestId('sidebar-account');
    expect(row).toHaveTextContent('RS');
    expect(row).toHaveTextContent('Rama Sugiyanto');
    expect(row).toHaveTextContent('rama@buma.co.id');
    expect(screen.queryByTestId('sidebar-ai')).not.toBeInTheDocument();
    await userEvent.click(row);
    expect(useApp.getState().route).toEqual({ name: 'settings', tab: 'account' });
    await userEvent.click(screen.getByTestId('sidebar-settings'));
    expect(useApp.getState().route).toEqual({ name: 'settings' });
  });
});
