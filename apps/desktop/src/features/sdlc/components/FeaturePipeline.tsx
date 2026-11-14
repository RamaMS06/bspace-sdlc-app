import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { Project } from '@bspace-sdlc-app/shared';
import { useFeatureState } from '@/features/sdlc/lib/sdlcState';
import { SDLC_STAGES } from '@/features/sdlc/components/SdlcWorkflow';
import { cn } from '@/shared/lib/utils';

/**
 * Where a feature stands in the SDLC, ideate to deploy, read from the files in its folder (the same
 * artifacts the skills write). Until they are read, the first stage is shown as the current one.
 */

export function FeaturePipeline({ project }: { project: Project }) {
  const { t } = useTranslation();
  const active = useFeatureState(project.id)?.current ?? 0;
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">{project.title}</span>
        <span className="text-xs text-text-3">{t('pipeline.subtitle')}</span>
      </div>
      <ol aria-label={t('pipeline.aria')} className="relative m-0 flex list-none flex-col p-0">
        <span aria-hidden="true" className="absolute top-4 bottom-4 left-[15px] w-px bg-border" />
        {SDLC_STAGES.map(({ icon: Icon, name, detail, gate }, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'todo';
          return (
            <li key={name} aria-current={state === 'active' ? 'step' : undefined} className="relative flex items-center gap-3 py-2">
              <span
                className={cn(
                  'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border',
                  state === 'done' && 'border-transparent bg-primary text-primary-foreground',
                  state === 'active' && 'border-primary bg-card text-primary-text',
                  state === 'todo' && 'border-border bg-card text-text-3',
                )}
              >
                {state === 'done' ? <Check size={15} strokeWidth={2.5} aria-hidden="true" /> : <Icon size={15} strokeWidth={1.75} aria-hidden="true" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-[13px] font-semibold', state === 'todo' && 'text-text-2')}>{t(`pipeline.stages.${name.toLowerCase()}` as 'pipeline.stages.ideate')}</span>
                <span className="truncate text-[11px] text-text-2">{detail}</span>
              </div>
              <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-2">{gate}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
