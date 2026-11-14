import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FolderOpen, MessageCircle, Plus } from 'lucide-react';
import type { Job, Project } from '@bspace-sdlc-app/shared';
import { AgentOffice } from '@/features/workflow/components/AgentOffice';
import { BumaBadge } from '@/shared/ui/buma/Badge';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import { Button } from '@/shared/ui/Button';
import { NewFeatureDialog, featureChat, runStage, refreshJobs, useJobs } from '@/features/chat';
import { SDLC_STAGES } from '@/features/sdlc';
import { StatusIcon } from '@/shared/ui/StatusIcon';
import { listProjects, openProjectFolder } from '@/shared/lib/ipc';
import { readFeatureState, type FeatureState } from '@/features/workflow/lib/sdlcState';
import { ago } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';

/** How often the open feature's folder is read again (the agent writes its files while it works). */
const REFRESH_MS = 5000;

type StageKey = 'ideate' | 'blueprint' | 'wireframe' | 'design' | 'build' | 'verify' | 'deploy';
const stageKey = (i: number) => SDLC_STAGES[i]!.name.toLowerCase() as StageKey;

/** The newest job of a feature: what its agent is doing now. */
function jobOf(jobs: Job[], projectId: string): Job | undefined {
  return jobs.filter((j) => j.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

const needsYou = (job?: Job) => !!job && (job.status === 'needs-you' || job.status === 'failed');

/**
 * The SDLC in one place: every feature (app) on the left with the stage it is on, and the open one on
 * the right with its pipeline read from its files, what its agent is doing, and a button to run each
 * stage's skill. New feature starts one.
 */
export function Workflow() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const version = useApp((s) => s.projectsVersion);
  const jobs = useJobs((s) => s.jobs);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, FeatureState>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    void refreshJobs().catch(() => {});
    listProjects()
      .then((p) => {
        if (!alive) return;
        const sorted = [...p].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setProjects(sorted);
        setSelected((s) => (s && sorted.some((x) => x.id === s) ? s : (sorted[0]?.id ?? null)));
        for (const x of sorted) void readFeatureState(x.id).then((st) => alive && setStates((m) => ({ ...m, [x.id]: st })));
      })
      .catch(() => alive && setProjects((l) => l ?? []));
    return () => {
      alive = false;
    };
  }, [version]);

  // The open feature's files change while its agent works: read them again every few seconds.
  const reload = useCallback((id: string) => void readFeatureState(id).then((st) => setStates((m) => ({ ...m, [id]: st }))), []);
  useEffect(() => {
    if (!selected) return;
    reload(selected);
    const timer = setInterval(() => reload(selected), REFRESH_MS);
    return () => clearInterval(timer);
  }, [selected, reload]);

  const project = useMemo(() => projects?.find((p) => p.id === selected) ?? null, [projects, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 md:px-6">
        <div className="mr-auto flex flex-col">
          <h1 className="m-0 text-[17px] font-semibold">{t('workflow.title')}</h1>
          <span className="text-xs text-text-3">{t('workflow.subtitle')}</span>
        </div>
        <Button className="gap-1.5" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" />
          {t('workflow.new')}
        </Button>
      </header>

      {projects === null ? (
        <div className="flex flex-1 items-center justify-center">
          <BumaLoading variant="process" labelText={t('workflow.loading')} />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <StatusIcon kind="info" size={40} />
          <span className="text-base font-medium">{t('workflow.emptyTitle')}</span>
          <span className="max-w-[420px] text-sm text-text-2">{t('workflow.emptyBody')}</span>
          <Button className="mt-2 gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            {t('workflow.new')}
          </Button>
        </div>
      ) : (
        // Side by side when there is room; the list goes on top in a narrow window.
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul
            aria-label={t('workflow.listAria')}
            className="m-0 flex max-h-44 w-full shrink-0 list-none flex-col gap-1 overflow-y-auto border-b border-border p-3 md:max-h-none md:w-72 md:border-r md:border-b-0"
          >
            {projects.map((p) => {
              const st = states[p.id];
              const job = jobOf(jobs, p.id);
              const stage = st ? (st.current < SDLC_STAGES.length ? t(`pipeline.stages.${stageKey(st.current)}`) : t('workflow.allDone')) : '…';
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={p.id === selected ? 'true' : undefined}
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-1 rounded-md border-0 bg-transparent px-3 py-2 text-left hover:bg-raised/60',
                      p.id === selected && 'bg-raised',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                      {needsYou(job) && <span aria-label={t('workflow.needsYou')} className="size-2 shrink-0 rounded-full bg-primary" />}
                      {job?.status === 'working' && <StatusIcon kind="working" size={14} />}
                    </span>
                    <span className="text-xs text-text-3">
                      {stage}
                      {st?.awaitingApproval ? ` · ${t('workflow.awaitingApproval')}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {project && settings ? (
            <FeatureDetail key={project.id} project={project} state={states[project.id]} job={jobOf(jobs, project.id)} agent={settings.defaultAgent} />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      )}
      <NewFeatureDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function FeatureDetail({ project, state, job, agent }: { project: Project; state?: FeatureState; job?: Job; agent: NonNullable<ReturnType<typeof useApp.getState>['settings']>['defaultAgent'] }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const [busy, setBusy] = useState<number | null>(null);
  const done = state ? state.stages.filter((s) => s === 'done').length : 0;
  const percent = Math.round((done / SDLC_STAGES.length) * 100);

  const run = async (i: number) => {
    setBusy(i);
    try {
      const approve = state?.current === i && state.awaitingApproval;
      await runStage(project, i, agent, t(approve ? 'workflow.approveAsk' : 'workflow.runAsk', { stage: t(`pipeline.stages.${stageKey(i)}`) }));
    } finally {
      setBusy(null);
    }
  };
  const openChat = async () => navigate({ name: 'chat', chatId: await featureChat(project, agent) });

  return (
    <section aria-label={project.title} className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <h2 className="m-0 truncate text-xl font-semibold">{project.title}</h2>
          <span className="truncate font-mono text-xs text-text-3" title={project.folder}>
            {state?.intentDir ?? project.folder}
          </span>
        </div>
        <Button variant="secondary" className="gap-1.5" onClick={() => void openProjectFolder(project.id).catch(() => {})}>
          <FolderOpen size={14} aria-hidden="true" />
          {t('workflow.openFolder')}
        </Button>
        <Button variant="secondary" className="gap-1.5" onClick={() => void openChat()}>
          <MessageCircle size={14} aria-hidden="true" />
          {t('workflow.openChat')}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-text-2">
          <span>{t('workflow.progress', { done, total: SDLC_STAGES.length })}</span>
          <span className="font-mono tabular-nums">{percent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {job && (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <StatusIcon kind={job.status === 'working' ? 'working' : job.status === 'done' ? 'success' : job.status === 'failed' ? 'error' : 'agent'} size={18} />
          <span className="mr-auto text-[13px]">
            {t(`workflow.agent.${job.status === 'failed' ? 'needs-you' : job.status}`)}
            <span className="text-text-3"> · {ago(job.updatedAt)}</span>
          </span>
          {needsYou(job) && (
            <Button small onClick={() => void openChat()}>
              {t('workflow.answer')}
            </Button>
          )}
        </div>
      )}

      <AgentOffice projectId={project.id} />

      <ol aria-label={t('pipeline.aria')} className="relative m-0 flex list-none flex-col gap-1 p-0">
        {SDLC_STAGES.map(({ icon: Icon, detail, gate, skill }, i) => {
          const s = state?.stages[i] ?? 'todo';
          const current = state?.current === i;
          const label = t(`pipeline.stages.${stageKey(i)}`);
          return (
            <li
              key={skill + i}
              aria-current={current ? 'step' : undefined}
              data-testid={`stage-${stageKey(i)}`}
              className={cn('flex items-center gap-3 rounded-lg border px-4 py-3', current ? 'border-primary-border bg-primary-soft' : 'border-border bg-card')}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border',
                  s === 'done' && 'border-transparent bg-primary text-primary-foreground',
                  s !== 'done' && current && 'border-primary bg-card text-primary-text',
                  s !== 'done' && !current && 'border-border bg-card text-text-3',
                )}
              >
                {s === 'done' ? <Check size={15} strokeWidth={2.5} aria-hidden="true" /> : <Icon size={15} strokeWidth={1.75} aria-hidden="true" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {label}
                  {s === 'done' && <BumaBadge variant="success" label={t('workflow.state.done')} />}
                  {s === 'started' && <BumaBadge variant="waiting" label={t('workflow.state.started')} />}
                </span>
                <span className="truncate text-xs text-text-3">
                  {detail} · <span className="font-mono">{skill}</span> · {gate}
                </span>
              </div>
              <Button
                small
                variant={current ? 'primary' : 'secondary'}
                disabled={busy !== null || job?.status === 'working'}
                aria-label={t('workflow.runStage', { stage: label })}
                onClick={() => void run(i)}
              >
                {busy === i
                  ? t('workflow.starting')
                  : current
                    ? state?.awaitingApproval
                      ? t('workflow.review')
                      : t('workflow.continue')
                    : s === 'done'
                      ? t('workflow.redo')
                      : t('workflow.run')}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
