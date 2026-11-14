import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentInfo } from '@bspace-sdlc-app/shared';

vi.mock('@/shared/lib/ipc', () => ({
  agentSignIn: vi.fn().mockResolvedValue(undefined),
  agentInstall: vi.fn().mockResolvedValue(undefined),
}));

import * as ipc from '@/shared/lib/ipc';
import { AddConnectionDialog } from '@/features/agents/components/AddConnectionDialog';
import { isConnected } from '@/features/agents/state/connections';

const info = (installed: boolean): AgentInfo => ({ id: 'codex', name: 'Codex', installed, version: installed ? '0.9' : null, acpCommand: [], recommended: false });

describe('Add connection', () => {
  it('Codex has nothing to install: one Sign in with ChatGPT (OAuth), no commands to copy', async () => {
    const user = userEvent.setup();
    render(<AddConnectionDialog agent="codex" info={info(true)} onOpenChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Install/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    expect(ipc.agentSignIn).toHaveBeenCalledWith('codex');
    expect(await screen.findByText('Signed in.')).toBeInTheDocument();
    expect(screen.queryByText(/npm install/)).toBeNull();
  });

  it('installs a CLI agent with one click, then signs in through the browser', async () => {
    const onCheck = vi.fn();
    const gemini = (installed: boolean): AgentInfo => ({ ...info(installed), id: 'gemini', name: 'Gemini CLI' });
    const user = userEvent.setup();
    const { rerender } = render(<AddConnectionDialog agent="gemini" info={gemini(false)} onOpenChange={vi.fn()} onCheck={onCheck} />);
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Install Gemini CLI' }));
    expect(ipc.agentInstall).toHaveBeenCalledWith('gemini');
    expect(onCheck).toHaveBeenCalled();
    rerender(<AddConnectionDialog agent="gemini" info={gemini(true)} onOpenChange={vi.fn()} onCheck={onCheck} />);
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(ipc.agentSignIn).toHaveBeenCalledWith('gemini');
  });

  it('shows why a sign-in failed', async () => {
    vi.mocked(ipc.agentSignIn).mockRejectedValueOnce(new Error('This agent has no sign-in to start from Buma'));
    const user = userEvent.setup();
    render(<AddConnectionDialog agent="gemini" info={{ ...info(true), id: 'gemini' }} onOpenChange={vi.fn()} onCheck={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no sign-in to start from Buma');
  });

  it('a connected agent only says so', () => {
    render(<AddConnectionDialog agent="codex" info={info(true)} connected onOpenChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByTestId('connection-connected')).toHaveTextContent('Connected');
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});

describe('isConnected', () => {
  it('needs the agent to run and be signed in', () => {
    expect(isConnected(info(true), false, [])).toBe(false);
    expect(isConnected({ ...info(true), signedIn: true }, false, [])).toBe(true);
    expect(isConnected(info(true), false, ['codex'])).toBe(true);
    expect(isConnected({ ...info(false), signedIn: true }, false, [])).toBe(false);
    expect(isConnected({ ...info(true), id: 'claude' }, true, [])).toBe(true);
    expect(isConnected({ ...info(true), id: 'claude', signedIn: true }, false, [])).toBe(false);
  });
});

describe('cleanError', () => {
  it('drops terminal colour codes, also when the escape character was lost', async () => {
    const { cleanError } = await import('@/shared/lib/cleanError');
    expect(cleanError('\u001b[91m\u001b[1mError: \u001b[0mConfiguration is invalid')).toBe('Error: Configuration is invalid');
    expect(cleanError('�[91m�[1mError: �[0mbad')).toBe('Error: bad');
    expect(cleanError('[91m[1mError: [0mbad')).toBe('Error: bad');
  });
});
