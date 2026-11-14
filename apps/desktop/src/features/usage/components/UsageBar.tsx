import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/i18n';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { Skeleton } from '@/shared/ui/Loading';
import { UsagePopover } from '@/features/usage/components/UsagePopover';
import { AGENT_NAMES } from '@/shared/lib/agents';
import { formatResetIn } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';
import { useUsage } from '@/features/usage/state/usage';
import { useAuth } from '@/features/usage/state/auth';
import { BUMA_USAGE_EVERY_MS, useBumaUsage } from '@/features/usage/state/bumaUsage';
import type { AgentUsage, Spend } from '@bspace-sdlc-app/shared';

export const pct = (n: number) => `${Math.round(n)}%`;

/** $0.00, or more decimals for a small but not zero cost ($0.0042). */
export function formatCost(usd: number): string {
  const digits = usd > 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(i18n.language || 'en', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
}

/** 186K, 1.2M: in the interface language. */
export const formatTokens = (n: number) => new Intl.NumberFormat(i18n.language || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** `$0.00 · 262.3K tokens`; the reply count goes in `spendTitle`, so the row fits the popover. */
export const spendRow = (s: Spend) => i18n.t('usage.spendRow', { cost: formatCost(s.costUsd), tokens: formatTokens(s.tokens) });
export const spendTitle = (s: Spend) => i18n.t('usage.spendTitle', { count: s.replies });

/** Why there is no usage, in the interface language (the agent's own words only for errors). */
export function usageMessage(u: AgentUsage): string {
  if (u.status === 'unavailable') return i18n.t('usage.notYet', { agent: AGENT_NAMES[u.agentId] });
  return u.message ?? i18n.t('usage.unavailable');
}

/** `33% used 1h 41m · 48% used 3d 13h · 26% used Fable` */
export function usageLine(u: AgentUsage, now: Date = new Date()): string {
  const t = i18n.t;
  if (u.status !== 'ok') return usageMessage(u);
  if (u.spend) return t('usage.spendLine', { cost: formatCost(u.spend.today.costUsd), tokens: formatTokens(u.spend.today.tokens) });
  const parts: string[] = [];
  if (u.session) parts.push(t('usage.used', { pct: pct(u.session.usedPercent), what: formatResetIn(u.session.resetsAt, now) }).trim());
  if (u.weekly) parts.push(t('usage.used', { pct: pct(u.weekly.usedPercent), what: formatResetIn(u.weekly.resetsAt, now) }).trim());
  if (u.modelWeekly) parts.push(t('usage.used', { pct: pct(u.modelWeekly.window.usedPercent), what: u.modelWeekly.label }));
  return parts.join(' · ') || t('usage.none');
}

export function UsageMeter({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-raised', className)}
    >
      <div className={cn('h-full rounded-full', p >= 80 ? 'bg-primary' : 'bg-text-2')} style={{ width: `${p}%` }} />
    </div>
  );
}

/**
 * The Buma account's AI credits left, in the status bar;
 * opens Settings › Usage. Nothing signed out, or before the first answer.
 */
export function BumaCreditsCompact() {
  const { t } = useTranslation();
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const usage = useBumaUsage((s) => s.usage);
  const navigate = useApp((s) => s.navigate);

  useEffect(() => {
    if (!signedIn) {
      useBumaUsage.getState().clear();
      return;
    }
    const load = () => void useBumaUsage.getState().load();
    load();
    const every = setInterval(load, BUMA_USAGE_EVERY_MS);
    return () => clearInterval(every);
  }, [signedIn]);

  if (!signedIn) return null;
  // The first answer is on its way: hold its place, so the bar doesn't jump when it lands.
  if (!usage) {
    return (
      <span role="status" aria-label={t('usage.credits')} className="flex h-6 items-center gap-1.5 px-1.5">
        <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-primary-text" />
        <Skeleton className="h-2.5 w-20" />
      </span>
    );
  }
  const line = t('usage.creditsLine', { count: usage.credits.remaining });
  return (
    <button
      type="button"
      aria-label={`${t('usage.credits')}: ${line}`}
      title={t('usage.credits')}
      onClick={() => navigate({ name: 'agents', tab: 'usage' })}
      className="flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded px-1.5 text-left hover:bg-raised/50"
    >
      <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-primary-text" />
      <span className="min-w-0 truncate">{line}</span>
    </button>
  );
}
