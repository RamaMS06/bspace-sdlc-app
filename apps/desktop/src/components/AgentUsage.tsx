import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChartColumn, RefreshCw, Table2 } from 'lucide-react';
import type { AgentId } from '@bspace-sdlc-app/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { BumaLoading } from '@/components/buma/Loading';
import { BumaBadge } from '@/components/buma/Badge';
import { AGENT_NAMES } from '@/lib/agents';
import { agentActivity } from '@/lib/ipc';
import { stepKey, useFailover, type FailoverReason, type Step } from '@/state/failover';
import { cn } from '@/lib/utils';

export const RANGES = ['today', '24h', '7d', '30d', '60d', 'all'] as const;
export type Range = (typeof RANGES)[number];

/** One agent turn from `agent-usage.jsonl`. */
export interface Turn {
  at: number;
  chat: string;
  agent: AgentId;
  model: string;
  input: number;
  cached: number;
  output: number;
  /** What this turn cost, from the agent's own running session cost; 0 when it reports none. */
  cost: number;
}

export interface Failover {
  at: number;
  chat: string;
  from: AgentId;
  to: AgentId;
  /** The models of the two steps, when the route names one. */
  fromModel: string | null;
  toModel: string | null;
  reason: FailoverReason;
}

/** `claude/claude-opus-5-5` (a route step) or `claude` → agent and model. */
const splitStep = (v: unknown): [string, string | null] => {
  const [head = '', ...rest] = String(v ?? '').split('/');
  // `claude@<account id>/model`: the account is not shown here.
  return [head.split('@')[0]!, rest.join('/') || null];
};

/**
 * The token split's colors, BUMA hues checked for color-blind separation and contrast on the light and
 * dark cards (dataviz validator): output primary green, input info blue, cache secondary orange 600.
 */
const SPLIT = [
  { key: 'output', color: 'var(--buma-background-success-500)' },
  { key: 'input', color: 'var(--buma-background-info-500)' },
  { key: 'cached', color: 'var(--buma-background-secondary-600)' },
] as const;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isAgent = (v: unknown): v is AgentId => typeof v === 'string' && v in AGENT_NAMES;
const tokensOf = (x: Turn) => x.input + x.cached + x.output;

/**
 * The log lines as turns and failovers. Agents report the session's running cost, so a turn's cost is the
 * rise since the chat's previous turn (a drop means a new session, whose cost starts over).
 */
export function parseActivity(lines: Record<string, unknown>[]): { turns: Turn[]; failovers: Failover[] } {
  const turns: Turn[] = [];
  const failovers: Failover[] = [];
  const lastCost = new Map<string, number>();
  for (const l of lines) {
    const at = Date.parse(String(l.at ?? ''));
    if (Number.isNaN(at)) continue;
    const chat = String(l.chat ?? '');
    if (l.event === 'failover') {
      const [from, fromModel] = splitStep(l.from);
      const [to, toModel] = splitStep(l.to);
      if (isAgent(from) && isAgent(to)) failovers.push({ at, chat, from, to, fromModel, toModel, reason: (l.reason as FailoverReason) ?? 'down' });
      continue;
    }
    if (!isAgent(l.agent)) continue;
    const u = (l.usage ?? {}) as Record<string, unknown>;
    const total = num((l.cost as Record<string, unknown> | undefined)?.amount);
    const prev = lastCost.get(chat) ?? 0;
    lastCost.set(chat, total || prev);
    turns.push({
      at,
      chat,
      agent: l.agent,
      model: typeof l.model === 'string' && l.model ? l.model : AGENT_NAMES[l.agent],
      input: num(u.inputTokens) + num(u.cachedWriteTokens),
      cached: num(u.cachedReadTokens),
      output: num(u.outputTokens),
      cost: total ? (total >= prev ? total - prev : total) : 0,
    });
  }
  return { turns, failovers };
}

/** How often Usage reads the activity log again while it is open. */
export const LIVE_MS = 5_000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Where a range starts (ms since the epoch); 0 for all. */
export function rangeStart(range: Range, now = Date.now()): number {
  switch (range) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case '24h':
      return now - DAY;
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    case '60d':
      return now - 60 * DAY;
    default:
      return 0;
  }
}

export interface Bucket {
  start: number;
  tokens: number;
  turns: number;
}

/** The turns as columns: hours for a day, days for up to 90 days, weeks beyond. */
export function bucketize(turns: Turn[], range: Range, now = Date.now()): { unit: 'hour' | 'day' | 'week'; buckets: Bucket[] } {
  const first = range === 'all' ? Math.min(now, ...turns.map((x) => x.at)) : rangeStart(range, now);
  const span = now - first;
  const unit = span <= DAY ? 'hour' : span <= 90 * DAY ? 'day' : 'week';
  const step = unit === 'hour' ? HOUR : unit === 'day' ? DAY : 7 * DAY;
  const floor = (t: number) => {
    const d = new Date(t);
    if (unit === 'hour') d.setMinutes(0, 0, 0);
    else d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const start = floor(first);
  const count = Math.max(1, Math.floor((floor(now) - start) / step) + 1);
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({ start: start + i * step, tokens: 0, turns: 0 }));
  for (const x of turns) {
    const i = Math.floor((x.at - start) / step);
    const b = buckets[Math.min(Math.max(i, 0), count - 1)]!;
    b.tokens += tokensOf(x);
    b.turns += 1;
  }
  return { unit, buckets };
}

function useFormat() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const lang = i18n.language;
    const n = new Intl.NumberFormat(lang);
    const compact = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
    const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'narrow' });
    const ago = (at: number) => {
      const s = Math.round((at - Date.now()) / 1000);
      const a = Math.abs(s);
      if (a < 60) return rtf.format(s, 'second');
      if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
      if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
      return rtf.format(Math.round(s / 86400), 'day');
    };
    const time = (t: number) => new Date(t).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    const date = (t: number) => new Date(t).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    return { n, compact, pct, usd, ago, time, date };
  }, [i18n.language]);
}

const card = 'rounded-xl border border-border bg-card';
const eyebrow = 'text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase';

function Tile({ label, value, hint, "data-testid": testId }: { label: string; value: string; hint: string; "data-testid": string }) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-raised/60 px-3 py-2.5">
      <span className={eyebrow}>{label}</span>
      <span className="font-mono text-[20px] font-semibold text-foreground">{value}</span>
      <span className="truncate text-[11px] text-text-3">{hint}</span>
    </div>
  );
}

/** The hero: total tokens, how they split (one bar, three parts, labeled), and the four headline figures. */
function Summary({ turns, failovers }: { turns: Turn[]; failovers: number }) {
  const { t } = useTranslation();
  const f = useFormat();
  const parts = { output: 0, input: 0, cached: 0 };
  let cost = 0;
  for (const x of turns) {
    parts.output += x.output;
    parts.input += x.input;
    parts.cached += x.cached;
    cost += x.cost;
  }
  const total = parts.output + parts.input + parts.cached;
  const context = parts.input + parts.cached;
  return (
    <section aria-label={t('agentUsage.tokensUsed')} className={cn(card, 'flex flex-wrap gap-6 p-4 sm:p-5')}>
      <div className="flex min-w-0 flex-[3_1_280px] flex-col gap-3">
        <span className={eyebrow}>{t('agentUsage.tokensUsed')}</span>
        <span data-testid="usage-total" className="font-mono text-[34px] leading-none sm:text-[44px] font-semibold tracking-[-0.02em] text-foreground">
          {f.n.format(total)}
        </span>
        <div role="img" aria-label={t('agentUsage.split')} className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-raised">
          {total > 0 &&
            SPLIT.map((p) =>
              parts[p.key] > 0 ? <span key={p.key} style={{ flexGrow: parts[p.key], background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" /> : null,
            )}
        </div>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 p-0">
          {SPLIT.map((p) => (
            <li key={p.key} data-testid={`split-${p.key}`} className="flex items-start gap-2">
              <span aria-hidden="true" style={{ background: p.color }} className="mt-1 size-2.5 shrink-0 rounded-sm" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[12px] font-medium text-foreground">
                  {t(`agentUsage.${p.key}`)} <span className="font-normal text-text-3">{total ? f.pct.format(parts[p.key] / total) : '–'}</span>
                </span>
                <span className="font-mono text-[13px] text-foreground">{f.n.format(parts[p.key])}</span>
                <span className="text-[11px] text-text-3">{t(`agentUsage.${p.key}Hint`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 flex-[2_1_240px] grid-cols-2 gap-2 self-start">
        <Tile data-testid="tile-turns" label={t('agentUsage.turns')} value={f.n.format(turns.length)} hint={t('agentUsage.turnsHint')} />
        <Tile data-testid="tile-cost" label={t('agentUsage.cost')} value={`~${f.usd.format(cost)}`} hint={t('agentUsage.costNote')} />
        <Tile data-testid="tile-cache" label={t('agentUsage.cacheRate')} value={context ? f.pct.format(parts.cached / context) : '–'} hint={t('agentUsage.cacheRateHint')} />
        <Tile data-testid="tile-failovers" label={t('agentUsage.failovers')} value={f.n.format(failovers)} hint={t('agentUsage.failoversHint')} />
      </div>
    </section>
  );
}

/** Tokens per hour, day or week: one hue (BUMA primary), a tooltip per column, and a table view. */
function Activity({ turns, range }: { turns: Turn[]; range: Range }) {
  const { t } = useTranslation();
  const f = useFormat();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const { unit, buckets } = bucketize(turns, range);
  const max = Math.max(1, ...buckets.map((b) => b.tokens));
  const label = (b: Bucket) => (unit === 'hour' ? f.time(b.start) : f.date(b.start));
  const ticks = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const tip = (b: Bucket) => `${label(b)} · ${t('agentUsage.barTip', { tokens: f.n.format(b.tokens), turns: f.n.format(b.turns) })}`;

  return (
    <section aria-label={t('agentUsage.activity')} className={cn(card, 'flex flex-col gap-3 p-4 sm:p-5')}>
      <div className="flex items-center gap-2">
        <span className={eyebrow}>{t('agentUsage.activity')}</span>
        <span className="text-[11px] text-text-3">· {t(`agentUsage.unit.${unit}`)}</span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 text-[12px] text-text-2 hover:bg-raised hover:text-foreground"
        >
          {asTable ? <ChartColumn size={13} aria-hidden="true" /> : <Table2 size={13} aria-hidden="true" />}
          {asTable ? t('agentUsage.chart') : t('agentUsage.table')}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-[200px] overflow-y-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-text-2">
                <th className="py-1 font-medium">{t('agentUsage.when')}</th>
                <th className="py-1 text-right font-medium">{t('agentUsage.tokens')}</th>
                <th className="py-1 text-right font-medium">{t('agentUsage.turns')}</th>
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => b.turns)
                .map((b) => (
                  <tr key={b.start} className="border-t border-border">
                    <td className="py-1">{label(b)}</td>
                    <td className="py-1 text-right font-mono">{f.n.format(b.tokens)}</td>
                    <td className="py-1 text-right font-mono">{f.n.format(b.turns)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          <div aria-hidden="true" className="flex h-[150px] flex-col justify-between py-0.5 text-right font-mono text-[10px] text-text-3">
            <span>{f.compact.format(max)}</span>
            <span>0</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              role="list"
              aria-label={t('agentUsage.activityAria', { unit: t(`agentUsage.unit.${unit}`) })}
              className="relative flex h-[150px] items-end gap-[2px] border-b border-border"
              onMouseLeave={() => setHover(null)}
            >
              {/* Recessive guide at the top of the scale. */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
              {buckets.map((b, i) => (
                <div
                  key={b.start}
                  role="listitem"
                  tabIndex={0}
                  aria-label={tip(b)}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="relative flex h-full min-w-0 flex-1 cursor-default items-end outline-none"
                >
                  <span
                    style={{ height: b.tokens ? `max(3px, ${(b.tokens / max) * 100}%)` : 0 }}
                    className={cn('w-full rounded-t-[4px] bg-primary transition-opacity', hover !== null && hover !== i && 'opacity-40')}
                  />
                  {hover === i && (
                    <span
                      role="tooltip"
                      className={cn(
                        'pointer-events-none absolute bottom-full z-10 mb-1.5 rounded-md border border-border bg-popover px-2 py-1 text-[11px] whitespace-nowrap text-foreground shadow-md',
                        i < buckets.length / 2 ? 'left-0' : 'right-0',
                      )}
                    >
                      {tip(b)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="flex justify-between font-mono text-[10px] text-text-3">
              {ticks.map((i) => (
                <span key={i} className="whitespace-nowrap">
                  {label(buckets[i]!)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** The failover route: numbered stops (an agent on a model), each one's state and its share of the tokens. */
function Route({ turns, active, onEdit }: { turns: Turn[]; active: Turn | null; onEdit?(): void }) {
  const { t } = useTranslation();
  const f = useFormat();
  const on = useFailover((s) => s.on);
  // Re-read when the route or the cooldowns change.
  useFailover((s) => s.combos);
  useFailover((s) => s.defaultCombo);
  useFailover((s) => s.cooldown);
  const fo = useFailover.getState();
  const steps = fo.steps();
  const total = turns.reduce((n, x) => n + tokensOf(x), 0);
  // A turn counts for the step on its model, else the agent's first step.
  const stepOf = (x: Turn) => steps.find((s) => s.agent === x.agent && s.model === x.model) ?? steps.find((s) => s.agent === x.agent);
  const off = [...new Set(turns.filter((x) => !stepOf(x)).map((x) => x.agent))].map((agent): Step => ({ agent, model: null }));
  const rows = [...steps, ...off];
  const activeKey = active ? stepKey(stepOf(active) ?? { agent: active.agent, model: null }) : null;

  return (
    <section aria-label={t('agentUsage.route')} className={cn(card, 'flex min-w-0 flex-[1_1_260px] flex-col gap-3 p-4 sm:p-5')}>
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={eyebrow}>{t('agentUsage.route')}</span>
          <span className="text-[12px] text-text-3">{t('agentUsage.routeHint')}</span>
        </div>
        {onEdit && (
          <button type="button" onClick={onEdit} className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium whitespace-nowrap text-primary-text hover:underline">
            {t('agentUsage.editRoute')}
          </button>
        )}
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((step, i) => {
          const key = stepKey(step);
          const inRoute = on && i < steps.length;
          const until = fo.restingUntil(step);
          const mine = turns.filter((x) => stepKey(stepOf(x) ?? { agent: x.agent, model: null }) === key).reduce((n, x) => n + tokensOf(x), 0);
          const share = total ? mine / total : 0;
          const status = !inRoute ? 'off' : until ? 'resting' : key === activeKey ? 'active' : 'ready';
          return (
            <li key={key} data-testid={`route-${key}`} data-status={status} className="relative flex gap-3 pb-4 last:pb-0">
              {/* The line down to the next stop. */}
              {i < rows.length - 1 && <span aria-hidden="true" className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />}
              <span
                aria-hidden="true"
                className={cn(
                  'z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold',
                  status === 'active' ? 'border-primary bg-primary text-primary-foreground' : status === 'resting' ? 'border-warning bg-warning-soft text-warning' : 'border-border bg-card text-text-2',
                )}
              >
                {inRoute ? i + 1 : '–'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <AgentLogo id={step.agent} size={16} />
                  <span className="text-[13px] font-medium">{AGENT_NAMES[step.agent]}</span>
                  {step.model && <span className="truncate font-mono text-[11px] text-text-2">{step.model}</span>}
                  <BumaBadge variant={status === 'active' ? 'success' : status === 'resting' ? 'draft' : 'neutral'} label={t(`agentUsage.status.${status}`, { time: f.time(until) })} />
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                    <span style={{ width: `${share * 100}%` }} className="block h-full rounded-full bg-primary" />
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-text-3">
                    {f.compact.format(mine)} · {t('agentUsage.share', { share: f.pct.format(share) })}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Turns and failovers together, newest first. */
function Recent({ turns, failovers }: { turns: Turn[]; failovers: Failover[] }) {
  const { t } = useTranslation();
  const f = useFormat();
  type Row = { kind: 'turn'; at: number; turn: Turn } | { kind: 'failover'; at: number; failover: Failover };
  const rows: Row[] = [
    ...turns.map((turn) => ({ kind: 'turn' as const, at: turn.at, turn })),
    ...failovers.map((failover) => ({ kind: 'failover' as const, at: failover.at, failover })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  return (
    <section aria-label={t('agentUsage.recent')} className={cn(card, 'flex min-w-0 flex-[1_1_260px] flex-col gap-3 p-4 sm:p-5')}>
      <span className={eyebrow}>{t('agentUsage.recent')}</span>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r, i) =>
          r.kind === 'turn' ? (
            <li key={`t-${r.at}-${i}`} data-testid="recent-turn" className="flex items-center gap-2.5 border-b border-border py-2 text-[12px] last:border-b-0">
              <AgentLogo id={r.turn.agent} size={16} />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{r.turn.model}</span>
              <span className="font-mono text-text-2">{t('agentUsage.turnLine', { tokens: f.compact.format(tokensOf(r.turn)) })}</span>
              <span className="w-[64px] shrink-0 text-right text-text-3">{f.ago(r.at)}</span>
            </li>
          ) : (
            <li key={`f-${r.at}-${i}`} data-testid="recent-failover" className="-mx-2 flex items-center gap-2.5 rounded-md border-b border-border bg-warning-soft px-2 py-2 text-[12px] last:border-b-0">
              <AgentLogo id={r.failover.from} size={16} />
              <ArrowRight size={13} aria-hidden="true" className="text-warning" />
              <AgentLogo id={r.failover.to} size={16} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{t('agentUsage.movedTo', { to: r.failover.toModel ? `${AGENT_NAMES[r.failover.to]} · ${r.failover.toModel}` : AGENT_NAMES[r.failover.to] })}</span>
                <span className="text-text-3"> · {t(`agentUsage.reason.${r.failover.reason}`)}</span>
              </span>
              <span className="w-[64px] shrink-0 text-right text-text-3">{f.ago(r.at)}</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * Settings › Agents › Usage: how many tokens the agents used and how they split, tokens over time, the
 * failover route with each agent's state and share, and the latest turns and failovers. Read from the
 * app's own log of agent turns, so it works for every agent, without a server.
 */
export function AgentUsage({ onEditRoute }: { onEditRoute?(): void }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const [lines, setLines] = useState<Record<string, unknown>[] | null>(null);

  const load = () => {
    agentActivity()
      .then(setLines)
      .catch(() => setLines([]));
  };
  useEffect(load, []);
  // Live: the log grows at the end of every agent turn, so it is read again every few seconds while
  // the screen is open (and not hidden), and at once when the window comes back.
  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load();
    };
    const timer = setInterval(tick, LIVE_MS);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => parseActivity(lines ?? []), [lines]);
  const since = rangeStart(range);
  const turns = all.turns.filter((x) => x.at >= since);
  const failovers = all.failovers.filter((x) => x.at >= since);
  const active = all.turns.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto min-w-0 basis-full text-[13px] text-text-2 sm:basis-auto sm:max-w-[460px]">{t('agentUsage.intro')}</span>
        <div role="radiogroup" aria-label={t('agentUsage.rangeAria')} className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              className={cn(
                'cursor-pointer rounded-[5px] border-0 px-2.5 py-1 text-[12px] font-medium',
                range === r ? 'bg-primary text-primary-foreground' : 'bg-transparent text-text-2 hover:bg-raised hover:text-foreground',
              )}
            >
              {t(`agentUsage.range.${r}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t('usage.refresh')}
          title={t('usage.refresh')}
          onClick={load}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-text-2 hover:bg-raised hover:text-foreground"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>

      {lines === null ? (
        <BumaLoading variant="data" labelText={t('usage.loading')} className="self-start" />
      ) : (
        <>
          <Summary turns={turns} failovers={failovers.length} />
          {turns.length === 0 ? <p className={cn(card, 'm-0 p-5 text-[13px] text-text-3')}>{t('agentUsage.none')}</p> : <Activity turns={turns} range={range} />}
          <div className="flex flex-wrap gap-4">
            <Route turns={turns} active={active} onEdit={onEditRoute} />
            {(turns.length > 0 || failovers.length > 0) && <Recent turns={turns} failovers={failovers} />}
          </div>
        </>
      )}
    </div>
  );
}
