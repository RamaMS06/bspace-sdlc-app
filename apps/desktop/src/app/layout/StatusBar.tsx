import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { UsagePopover, UsageMeter, usageLine, useUsage } from '@/features/usage';
import { AGENT_NAMES } from '@/shared/lib/agents';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';
import { VersionTag } from '@/app/layout/VersionTag';
import { ThemeToggle } from '@/app/layout/ThemeToggle';
import { BumaBadge } from '@/shared/ui/buma/Badge';
import { useIsAdmin } from '@/features/devops';
import { Spinner } from '@/shared/ui/Loading';

/**
 * The bar along the bottom of the window: the usage of the agent in use (the open chat's, else the
 * default one), its first account: logo, a small meter of its 5 hour window, `56% used 4h 39m ·
 * 7% used 6d 17h`; then a refresh button, and the light/dark switch on the right. Clicking the usage
 * opens the popover with every agent and every account.
 */
export function StatusBar() {
  const { t } = useTranslation();
  const usage = useUsage((s) => s.usage);
  const loaded = useUsage((s) => s.loaded);
  const loading = useUsage((s) => s.loading);
  const chatAgent = useUsage((s) => s.chatAgent);
  const admin = useIsAdmin();
  const defaultAgent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const first = chatAgent ?? defaultAgent;

  useEffect(() => {
    useUsage.getState().start();
  }, []);

  // Only the agent in use, and only its first account (the top one); the popover lists every agent
  // and every account.
  const shown = usage.filter((u) => u.agentId === first).slice(0, 1);

  return (
    <footer
      aria-label={t('usage.statusBar')}
      className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-background px-2 text-[12px] text-text-2"
    >
      <UsagePopover>
        <button
          type="button"
          aria-label={t('usage.aria', { agent: AGENT_NAMES[first] })}
          className="flex h-6 min-w-0 cursor-pointer items-center overflow-hidden rounded px-1.5 text-left hover:bg-raised/50"
        >
          <span data-testid="status-agent" className="flex min-w-0 items-center gap-2">
            <AgentLogo id={first} size={14} />
            {shown.length === 0 && <span className="truncate">{loaded ? t('usage.unavailable') : t('usage.loading')}</span>}
            {shown.map((u, i) => (
              <span key={u.accountId ?? i} className="flex min-w-0 items-center gap-2" data-testid="status-account">
                {/* An agent without plan limits (opencode) has nothing to fill a meter with. */}
                {u.status === 'ok' && !u.spend && (
                  <UsageMeter percent={u.session?.usedPercent ?? 0} label={t('usage.aria', { agent: AGENT_NAMES[first] })} className="w-14 shrink-0" />
                )}
                <span className="truncate">{usageLine(u)}</span>
              </span>
            ))}
          </span>
        </button>
      </UsagePopover>
      <button
        type="button"
        aria-label={t('usage.refresh')}
        title={t('usage.refresh')}
        onClick={() => void useUsage.getState().refresh(true)}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-raised/50 hover:text-foreground"
      >
        {loading ? <Spinner size={13} /> : <RefreshCw size={13} aria-hidden="true" />}
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {admin && (
          <span data-testid="admin-badge" title={t('admin.title')}>
            {/* Small enough for the 28px bar: the same colors as BUMA's badge, at a footer's size. */}
            <BumaBadge variant="success" label={t('admin.label')} className="h-[18px] rounded-[4px] px-1.5 py-0 text-[10px] leading-none font-semibold tracking-[0.02em]" />
          </span>
        )}
        <VersionTag />
        <ThemeToggle />
      </div>
    </footer>
  );
}
