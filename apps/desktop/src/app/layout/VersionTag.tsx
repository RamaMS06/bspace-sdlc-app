import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

/** `v0.0.10`, plus `dev` in development builds. */
export function appVersionLabel(): string {
  return `v${__APP_VERSION__}${import.meta.env.DEV ? '-dev' : ''}`;
}

/**
 * The app's version, always in view: in the status bar of the main window, and floating in the corner of
 * the onboarding screens (`floating`).
 */
export function VersionTag({ floating = false, className }: { floating?: boolean; className?: string }) {
  const { t } = useTranslation();
  const label = appVersionLabel();
  return (
    <span
      data-testid="version-tag"
      title={t('app.version', { version: label })}
      className={cn(
        'shrink-0 font-mono text-[11px] text-text-3 tabular-nums select-text',
        floating && 'pointer-events-auto fixed right-4 bottom-3 z-40 rounded-md border border-border bg-card/90 px-2 py-0.5 backdrop-blur-sm',
        className,
      )}
    >
      {/* i18n-ignore: product name */}
      BSpace SDLC {label}
    </span>
  );
}
