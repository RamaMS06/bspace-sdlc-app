import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@bspace-sdlc-app/shared';

vi.mock('@/shared/lib/ipc', () => ({ updateSettings: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { openUrl } from '@tauri-apps/plugin-opener';
import { updateSettings } from '@/shared/lib/ipc';
import { devopsMicrosoftSignIn, devopsSignIn, devopsStatus } from '@/features/devops/lib/devops';
import { AccountStep } from '@/features/onboarding/screens/AccountStep';
import { OnboardingHeader } from '@/features/onboarding/components/OnboardingHeader';
import { useApp } from '@/shared/state/app';
import { useDevops } from '@/features/devops/state/devops';

const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, workingFolder: '/w', ...o });
const signedOut = { signedIn: false, profile: null };
const profile = { org: 'buma', id: 'u-1', displayName: 'Rama Sugiyanto', email: 'rama@buma.co.id' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(devopsStatus).mockResolvedValue(signedOut);
  useApp.setState({ route: { name: 'onboarding-account' }, settings: settings(), leaveGuard: null });
  useDevops.setState({ status: signedOut, busy: false, error: null });
});

describe('onboarding: Azure DevOps sign-in step', () => {
  it('is required: no skip, and the app cannot be opened while signed out', async () => {
    render(<AccountStep />);
    expect(screen.getByRole('heading', { name: 'Sign in to Azure DevOps' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Open BSpace SDLC/ })).toBeDisabled();
    expect(screen.getByText('Sign in to Azure DevOps to continue')).toBeInTheDocument();
  });

  it('signs in with the organization and a token, then opens the app', async () => {
    vi.mocked(devopsSignIn).mockResolvedValue({ signedIn: true, profile });
    vi.mocked(updateSettings).mockResolvedValue(settings({ onboarded: true }));
    render(<AccountStep />);
    expect(screen.getByRole('textbox', { name: 'Organization' })).toHaveValue('buma');
    expect(screen.getByRole('button', { name: 'Sign in with token' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Personal access token'), 'secret-pat');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with token' }));
    expect(devopsSignIn).toHaveBeenCalledWith('buma', 'secret-pat');
    expect(await screen.findByText('Rama Sugiyanto')).toBeInTheDocument();
    expect(screen.getByText('rama@buma.co.id · dev.azure.com/buma')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Open BSpace SDLC/ }));
    expect(updateSettings).toHaveBeenCalledWith({ onboarded: true });
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat-new' }));
  });

  it('signs in with Microsoft in one click, for the organization', async () => {
    vi.mocked(devopsMicrosoftSignIn).mockResolvedValue({ signedIn: true, profile });
    render(<AccountStep />);
    await userEvent.click(screen.getByRole('button', { name: /Sign in with Microsoft/ }));
    expect(devopsMicrosoftSignIn).toHaveBeenCalledWith('buma');
    expect(await screen.findByText('Rama Sugiyanto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open BSpace SDLC/ })).toBeEnabled();
  });

  it('shows why Azure DevOps refused the token', async () => {
    vi.mocked(devopsSignIn).mockRejectedValue("Azure DevOps didn't accept that token for this organization.");
    render(<AccountStep />);
    await userEvent.type(screen.getByLabelText('Personal access token'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("didn't accept that token");
    expect(screen.getByRole('button', { name: /Open BSpace SDLC/ })).toBeDisabled();
  });

  it('opens the token page of the organization', async () => {
    render(<AccountStep />);
    await userEvent.click(screen.getByRole('button', { name: /Create a token/ }));
    expect(openUrl).toHaveBeenCalledWith('https://dev.azure.com/buma/_usersSettings/tokens');
  });

  it('goes back to the tools step', async () => {
    render(<AccountStep />);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(useApp.getState().route).toEqual({ name: 'requirements' });
  });

  it('the header counts four steps', () => {
    render(<OnboardingHeader step={2} bars />);
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
  });
});
