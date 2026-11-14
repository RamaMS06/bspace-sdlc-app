import { useTranslation } from 'react-i18next';
import type { ProjectStatus } from '@bspace-sdlc-app/shared';
import { cn } from '@/shared/lib/utils';

export const STEPS = ['ideate', 'blueprint', 'design', 'build', 'verify'] as const;

/**
 * Index of the SDLC step a feature is on: draft → Ideate; building → Build (Blueprint and Design done);
 * finished → every step done, none current. `verifying` puts it on Verify.
 */
export function currentStep(status: ProjectStatus, verifying = false): number {
  if (verifying) return 4;
  if (status === 'draft') return 0;
  if (status === 'building') return 3;
  return STEPS.length;
}

type Props =
  | {
      status: ProjectStatus;
      /** The step read from the feature's files; the stored status is only a guess until it is known. */
      step?: number;
    }
  | {
      /** Visible step names, in order. */
      steps: string[];
      current: number;
      /** The list's accessible name. */
      label: string;
      /** When given, every step is a button that jumps to it. */
      onPick?: (index: number) => void;
    };

/** A project's progress (`status`), or any numbered steps (`steps`). */
export function StepBar(props: Props) {
  const { t } = useTranslation();
  const own = 'steps' in props;
  const names = own ? props.steps : STEPS.map((s) => t(`stepBar.${s}`));
  const cur = own ? props.current : (props.step ?? currentStep(props.status));
  const onPick = own ? props.onPick : undefined;
  return (
    // A project's steps sit in the chat header: one line always, and when its container (`@container/steps`)
    // is narrow, only the current step keeps its name.
    <ol
      aria-label={own ? props.label : t('stepBar.aria')}
      className={cn('m-0 flex list-none items-center gap-2 p-0', own ? 'flex-wrap' : 'flex-nowrap')}
    >
      {names.map((name, i) => {
        const done = i < cur;
        const active = i === cur;
        const body = (
          <>
            <span
              aria-hidden="true"
              data-step-mark
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-full font-mono text-[11px]',
                done && 'bg-primary-border text-primary-text',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'border border-hairline text-text-3',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              data-step-name
              className={cn(
                'text-[13px] whitespace-nowrap',
                active ? 'font-medium text-foreground' : 'text-text-2',
                !own && !active && '@max-[34rem]/steps:sr-only',
              )}
            >
              {name}
            </span>
          </>
        );
        return (
          <li key={name} title={name} aria-current={!onPick && active ? 'step' : undefined} className="flex shrink-0 items-center gap-2">
            {onPick ? (
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => onPick(i)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {body}
              </button>
            ) : (
              body
            )}
            {i < names.length - 1 && <span aria-hidden="true" className={cn('h-px w-4 shrink-0 bg-hairline', !own && '@max-[34rem]/steps:w-2')} />}
          </li>
        );
      })}
    </ol>
  );
}
