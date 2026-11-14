import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { AgentUsage, UsageWindow } from '@bspace-sdlc-app/shared';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { UsageMeter, pct, spendRow, spendTitle, usageMessage } from '@/features/usage/components/UsageBar';
import { Button } from '@/shared/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { AGENT_NAMES } from '@/shared/lib/agents';
import { formatResetIn } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';
import { Spinner } from '@/shared/ui/Loading';
import { useUsage } from '@/features/usage/state/usage';

/** One limit: label, meter, then `48% · 3h 33m` (used, and when it resets). */
function Row({ label, w }: { label: string; w: UsageWindow }) {
  const { t } = useTranslation();
  const reset = formatResetIn(w.resetsAt ?? null);
  return (
    <div className="flex items-center gap-buma-xs">
      <span className="w-10 shrink-0 truncate text-xs text-text-2">{label}</span>
      <UsageMeter percent={w.usedPercent} label={t('usage.rowAria', { label })} />
      <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap">
        {pct(w.usedPercent)}
        {reset && <span className="text-text-3"> · {reset}</span>}
      </span>
    </div>
  );
}

/** Nothing to show for it: usage not available, or a spend agent that spent nothing this week. */
export const untracked = (u: AgentUsage) =>
  u.status === 'unavailable' || (u.status === 'ok' && !!u.spend && u.spend.week.tokens === 0 && u.spend.week.costUsd === 0);

/** One account of an agent: logo, name and the account under it, then its limits (or spend, or why not). */
export function AgentBlock({ u }: { u: AgentUsage }) {
  const { t } = useTranslation();
  const name = AGENT_NAMES[u.agentId];
  const ok = u.status === 'ok';
  return (
    <div className="flex flex-col gap-buma-xs" data-testid="usage-row">
      <div className="flex min-w-0 items-center gap-buma-xs">
        <AgentLogo id={u.agentId} size={16} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] leading-4 font-medium">{name}</span>
          {u.account && <span className="truncate text-[11px] leading-4 text-text-3">{u.account}</span>}
        </div>
      </div>
      {ok && u.spend ? (
        [
          { label: t('usage.today'), s: u.spend.today },
          { label: t('usage.lastWeek'), s: u.spend.week },
        ].map(({ label, s }) => (
          <div key={label} className="flex items-center gap-buma-xs" title={spendTitle(s)}>
            <span className="w-14 shrink-0 text-xs text-text-2">{label}</span>
            <span className="truncate font-mono text-xs">{spendRow(s)}</span>
          </div>
        ))
      ) : ok ? (
        <>
          {u.session && <Row label={t('usage.five')} w={u.session} />}
          {u.weekly && <Row label={t('usage.week')} w={u.weekly} />}
          {u.modelWeekly && <Row label={u.modelWeekly.label} w={u.modelWeekly.window} />}
        </>
      ) : (
        <span className="text-xs text-text-2">{usageMessage(u)}</span>
      )}
    </div>
  );
}

export function UsagePopover({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const usage = useUsage((s) => s.usage);
  const loading = useUsage((s) => s.loading);
  const refresh = useUsage((s) => s.refresh);
  const navigate = useApp((s) => s.navigate);
  const shown = usage.filter((u) => !untracked(u));
  // Agents with nothing to show share one line at the end.
  const quiet = [...new Set(usage.filter(untracked).map((u) => AGENT_NAMES[u.agentId]))];

  const go = (route: Parameters<typeof navigate>[0]) => {
    setOpen(false);
    navigate(route);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 bg-card p-0">
        <div className="flex items-center gap-buma-xs border-b border-border px-buma-md py-buma-sm">
          <span className="text-[14px] font-semibold">{t('usage.title')}</span>
          <span className="text-xs text-text-3">{t('usage.allAgents')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            aria-label={t('usage.refresh')}
            onClick={() => void refresh(true)}
          >
            {loading ? <Spinner size={16} /> : <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />}
          </Button>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-buma-md overflow-y-auto px-buma-md py-buma-sm">
          {usage.length === 0 && <span className="text-xs text-text-2">{t('usage.noAgents')}</span>}
          {shown.map((u) => (
            <AgentBlock key={`${u.agentId}/${u.accountId ?? ''}`} u={u} />
          ))}
          {quiet.length > 0 && <span className="text-[11px] text-text-3">{t('usage.untracked', { agents: quiet.join(', ') })}</span>}
        </div>
        <div className="flex flex-col border-t border-border p-1">
          {[
            { label: t('usage.details'), route: { name: 'agents', tab: 'usage' } as const },
            { label: t('usage.manage'), route: { name: 'settings' } as const },
          ].map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => go(r.route)}
              className="flex h-8 items-center justify-between rounded-md px-3 text-[13px] text-text-2 hover:bg-raised hover:text-foreground"
            >
              {r.label}
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
