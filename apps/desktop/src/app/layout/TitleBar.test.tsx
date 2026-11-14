import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleBar } from '@/app/layout/TitleBar';
import { useApp } from '@/shared/state/app';
import { useLayout } from '@/shared/state/layout';

beforeEach(() => {
  useApp.setState({ route: { name: 'chat-new' }, past: [], future: [], leaveGuard: null });
  useLayout.setState({ sidebarHidden: false });
});

describe('title bar', () => {
  it('Back and Forward walk the screens visited, and are off at either end', async () => {
    render(<TitleBar />);
    const back = screen.getByRole('button', { name: 'Back' });
    const forward = screen.getByRole('button', { name: 'Forward' });
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();
    useApp.getState().navigate({ name: 'workflow' });
    useApp.getState().navigate({ name: 'skills' });
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(useApp.getState().route).toEqual({ name: 'workflow' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new' });
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(useApp.getState().route).toEqual({ name: 'workflow' });
    // A new screen drops the forward history.
    useApp.getState().navigate({ name: 'settings' });
    expect(useApp.getState().future).toEqual([]);
  });

  it('the same screen twice is one step, and a leave guard can keep the screen', async () => {
    useApp.getState().navigate({ name: 'workflow' });
    useApp.getState().navigate({ name: 'workflow' });
    expect(useApp.getState().past).toEqual([{ name: 'chat-new' }]);
    useApp.setState({ leaveGuard: () => false });
    useApp.getState().back();
    expect(useApp.getState().route).toEqual({ name: 'workflow' });
  });

  it('hides and shows the sidebar', async () => {
    render(<TitleBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(useLayout.getState().sidebarHidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(useLayout.getState().sidebarHidden).toBe(false);
  });
});
