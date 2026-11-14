import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, LogIn } from 'lucide-react';
import type { AgentId, AgentInfo } from '@bspace-sdlc-app/shared';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { Button } from '@/shared/ui/Button';
import { ClaudeAccountControl } from '@/features/agents/components/ClaudeAccountControl';
import { StatusIcon } from '@/shared/ui/StatusIcon';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { AGENT_INSTALL_URL, AGENT_NAMES } from '@/shared/lib/agents';
import { agentInstall, agentSignIn } from '@/shared/lib/ipc';
import { useClaudeAccount } from '@/features/agents/state/claudeAccount';
import { cleanError } from '@/shared/lib/cleanError';
import { useConnections } from '@/features/agents/state/connections';

type Provider = Exclude<AgentId, 'custom'>;

/**
 * How each provider is set up. `npx`: it runs through npx (Node is enough), so there is nothing to
 * install, only a sign-in. `npm`: Buma installs its CLI (npm, or the agent's own installer script for Cursor). Sign-in is always in the browser.
 */
export const SETUP: Record<Provider, { npx?: boolean; npm: boolean; signIn: 'claude' | 'chatgpt' | 'google' | 'provider' | 'cursor' }> = {
  claude: { npx: true, npm: false, signIn: 'claude' },
  codex: { npx: true, npm: false, signIn: 'chatgpt' },
  gemini: { npm: true, signIn: 'google' },
  opencode: { npm: true, signIn: 'provider' },
  antigravity: { npm: false, signIn: 'google' },
  cursor: { npm: true, signIn: 'cursor' },
};

const errorText = (e: unknown) => cleanError(e instanceof Error ? e.message : String(e));

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[11px] font-semibold text-text-2">
        {done ? <StatusIcon kind="success" size={16} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * "Add connection": set up one AI provider in two clicks, without a terminal. Install (Buma runs npm),
 * then sign in: the provider's own browser sign-in (OAuth with Claude, ChatGPT or Google) opens and the
 * popup waits for it to finish.
 */
export function AddConnectionDialog({
  agent,
  info,
  connected = false,
  onOpenChange,
  onCheck,
}: {
  agent: AgentId | null;
  info?: AgentInfo;
  /** Already connected: the popup only says so. */
  connected?: boolean;
  onOpenChange(open: boolean): void;
  onCheck(): Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'install' | 'sign-in' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<Provider | null>(null);
  const claude = useClaudeAccount((s) => s.account);
  const claudeIn = !!claude?.signedIn;
  const mark = useConnections((s) => s.mark);
  const provider: Provider | null = agent && agent !== 'custom' ? agent : null;
  const setup = provider ? SETUP[provider] : null;
  const installed = !!info?.installed;

  const run = async (kind: 'install' | 'sign-in', task: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await task();
      await onCheck();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const install = () => provider && void run('install', () => agentInstall(provider));
  const signIn = () =>
    agent &&
    void run('sign-in', async () => {
      if (!provider) return;
      await agentSignIn(provider);
      mark(provider);
      setSignedIn(provider);
    });
  const close = (o: boolean) => {
    if (o || busy === 'install') return onOpenChange(o);
    setError(null);
    setSignedIn(null);
    onOpenChange(false);
  };
  const isSignedIn = agent === 'claude' ? claudeIn : signedIn === agent;

  return (
    <Dialog open={!!agent} onOpenChange={close}>
      <DialogContent className="sm:max-w-[520px]">
        {agent && connected && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AgentLogo id={agent} size={20} />
                {AGENT_NAMES[agent]}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('connection.connectedTitle')}</DialogDescription>
            </DialogHeader>
            <div data-testid="connection-connected" className="flex items-center gap-3 rounded-lg bg-primary-soft px-4 py-3">
              <StatusIcon kind="success" size={22} />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{t('connection.connectedTitle')}</span>
                <span className="truncate text-[12px] text-text-2">
                  {(agent === 'claude' ? claude?.email : info?.account) ?? ''}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('connection.done')}</Button>
            </DialogFooter>
          </>
        )}
        {provider && setup && !connected && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AgentLogo id={provider} size={20} />
                {t('connection.title', { name: AGENT_NAMES[provider] })}
              </DialogTitle>
              <DialogDescription>{t(`connection.intro.${provider}`)}</DialogDescription>
            </DialogHeader>
            <ol className="m-0 flex list-none flex-col gap-5 p-0">
              {!setup.npx && (
                <Step n={1} title={t('connection.install')} done={installed}>
                {installed ? (
                  <span className="text-[12px] text-text-3">{t('connection.installed')}</span>
                ) : setup.npm ? (
                  <Button className="w-fit" disabled={!!busy} onClick={install}>
                    {busy === 'install' ? t('connection.installing') : t('connection.installButton', { name: AGENT_NAMES[provider] })}
                  </Button>
                ) : (
                  <a href={AGENT_INSTALL_URL[provider]} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-primary-text">
                    <ExternalLink size={13} aria-hidden="true" />
                    {t('connection.installGuide')}
                  </a>
                )}
              </Step>
              )}
              <Step n={setup.npx ? 1 : 2} title={t('connection.signIn')} done={isSignedIn}>
                {provider === 'claude' ? (
                  <div className="flex">
                    <ClaudeAccountControl showSignOut />
                  </div>
                ) : busy === 'sign-in' ? (
                  <BumaLoading variant="process" labelText={t('connection.waiting')} className="self-start" />
                ) : isSignedIn ? (
                  <span className="text-[12px] text-text-3">{t('connection.signedIn')}</span>
                ) : (
                  <Button variant={installed ? 'primary' : 'secondary'} className="w-fit gap-1.5" disabled={!!busy || !installed} onClick={signIn}>
                    <LogIn size={14} aria-hidden="true" />
                    {t(`connection.with.${setup.signIn}`)}
                  </Button>
                )}
                <span className="text-[12px] text-text-3">{t('connection.browserHint')}</span>
              </Step>
            </ol>
            {error && (
              <p role="alert" className="m-0 rounded-md border border-error/40 px-3 py-2 font-mono text-[12px] break-words whitespace-pre-wrap text-error">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" disabled={busy === 'install'} onClick={() => close(false)}>
                {installed && isSignedIn ? t('connection.done') : t('common.close')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
