import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useOffice, type OfficeAgent, type OfficePhase, type OfficePhaseState, type OfficeUnit } from '@/state/office';

const ROOMS: OfficePhase[] = ['brainstorm', 'design', 'slice', 'verify', 'close'];

const ROOM_TONE: Record<OfficePhaseState, string> = {
  done: 'border-primary-border bg-primary-soft',
  active: 'border-primary bg-card',
  blocked: 'border-error/50 bg-error-soft',
  todo: 'border-border bg-card opacity-70',
};

const initial = (role: string) => role.slice(0, 1).toUpperCase();

/** One agent at its desk: its role, the unit it works on, and what it waits for. */
function Desk({ agent, unit }: { agent: OfficeAgent; unit?: OfficeUnit }) {
  const { t } = useTranslation();
  const waiting = unit?.status === 'awaiting-human' || unit?.status === 'needs-context';
  const working = unit?.status === 'running' || unit?.status === 'awaiting-verify';
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          agent.err || unit?.status === 'blocked'
            ? 'bg-error text-primary-foreground'
            : waiting
              ? 'bg-brand-secondary text-primary-foreground'
              : 'bg-primary text-primary-foreground',
          working && 'buma-pulse',
        )}
      >
        {initial(agent.role)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[12px] font-medium">{t(`office.roles.${agent.role}`, { defaultValue: agent.role })}</span>
        {unit && <span className="truncate font-mono text-[10px] text-text-3">{unit.id}</span>}
        {(unit?.ask || agent.err) && <span className={cn('text-[11px]', agent.err ? 'text-error' : 'text-text-2')}>{agent.err || unit?.ask}</span>}
      </span>
    </li>
  );
}

/**
 * The Agent Office inside Workflow: the plugin's live view of a feature, as rooms per phase with the
 * agents at work, what the manager says next, and the activity log. Updates arrive from the hook as they
 * happen; the saved copy is read when the screen opens.
 */
export function AgentOffice({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const office = useOffice((s) => s.byProject[projectId]);

  useEffect(() => {
    useOffice.getState().listen();
    void useOffice.getState().load(projectId);
    const timer = setInterval(() => void useOffice.getState().load(projectId), 5000);
    return () => clearInterval(timer);
  }, [projectId]);

  if (!office) {
    return (
      <section aria-label={t('office.title')} className="rounded-xl border border-dashed border-border p-4 text-[13px] text-text-3">
        <span className="font-medium text-text-2">{t('office.title')}</span> · {t('office.empty')}
      </section>
    );
  }

  const units = new Map((office.units ?? []).map((u) => [u.id, u]));
  const manager = office.agents?.find((a) => a.role === 'manager');
  const live = office.t ? Date.now() / 1000 - office.t < 120 : false;

  return (
    <section aria-label={t('office.title')} data-testid="agent-office" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{t('office.title')}</span>
        {office.intent && <span className="font-mono text-xs text-text-3">{office.intent}</span>}
        <span className={cn('ml-auto inline-flex items-center gap-1.5 text-[11px]', live ? 'text-success' : 'text-text-3')}>
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'buma-pulse bg-success' : 'bg-text-3')} />
          {live ? t('office.live') : t('office.idle')}
        </span>
      </div>
      {manager?.say && (
        <p className="m-0 rounded-md bg-raised px-3 py-2 text-[13px]">
          <span className="font-medium">{t('office.roles.manager')}:</span> {manager.say}
        </p>
      )}
      <ol aria-label={t('office.rooms')} className="m-0 grid list-none grid-cols-5 gap-2 p-0">
        {ROOMS.map((room) => {
          const state = office.phases[room] ?? 'todo';
          const agents = (office.agents ?? []).filter((a) => a.room === room);
          return (
            <li key={room} data-testid={`office-room-${room}`} data-state={state} className={cn('flex min-h-28 min-w-0 flex-col gap-2 rounded-lg border p-2.5', ROOM_TONE[state])}>
              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-[12px] font-semibold">{t(`office.phases.${room}`)}</span>
                <span className="shrink-0 text-[10px] text-text-3">{t(`office.state.${state}`)}</span>
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {agents.map((a) => (
                  <Desk key={a.id} agent={a} unit={a.unit ? units.get(a.unit) : undefined} />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {!!office.log?.length && (
        <ol aria-label={t('office.log')} className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto border-t border-border p-0 pt-2">
          {[...office.log].reverse().slice(0, 12).map(([time, who, text, bad], i) => (
            <li key={`${time}-${i}`} className="flex gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-text-3">{time}</span>
              <span className="shrink-0 font-medium">{who}</span>
              <span className={cn('min-w-0 truncate', bad ? 'text-error' : 'text-text-2')}>{text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
