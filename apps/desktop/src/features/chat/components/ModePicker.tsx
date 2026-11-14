import { useTranslation } from 'react-i18next';
import { ChevronDown, FilePen, Hand, ListChecks, ShieldOff, Zap, type LucideIcon } from 'lucide-react';
import type { AgentId } from '@bspace-sdlc-app/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import type { PermissionMode } from '@/shared/lib/ipc';
import { cn } from '@/shared/lib/utils';

const MODES: { id: PermissionMode; icon: LucideIcon }[] = [
  { id: 'ask', icon: Hand },
  { id: 'acceptEdits', icon: FilePen },
  { id: 'plan', icon: ListChecks },
  { id: 'auto', icon: Zap },
  { id: 'bypass', icon: ShieldOff },
];

/** Accept edits and Plan are Claude Code's own modes; every agent can ask, run in auto, or bypass. */
export const modeAvailable = (mode: PermissionMode, agent: AgentId) => agent === 'claude' || (mode !== 'acceptEdits' && mode !== 'plan');

/**
 * How the agent asks before acting, in the composer: Ask (every request shown), Accept edits, Plan
 * (read and plan only), Auto (runs without asking, installs still ask) and Bypass (nothing asks).
 */
export function ModePicker({
  mode,
  agent,
  disabled,
  onChange,
  className,
}: {
  mode: PermissionMode;
  agent: AgentId;
  disabled?: boolean;
  onChange(mode: PermissionMode): void;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const Icon = current.icon;
  const name = t(`composer.modes.${current.id}.name`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={t('composer.modeLabel', { mode: name })}
          title={t(`composer.modes.${current.id}.hint`)}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[12px] text-text-2 hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-50',
            mode === 'auto' && 'bg-primary-soft text-primary-text hover:bg-primary-soft hover:text-primary-text',
            mode === 'bypass' && 'bg-error-soft text-error hover:bg-error-soft hover:text-error',
            className,
          )}
        >
          <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{name}</span>
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-text-3">{t('composer.modeTitle')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onChange(v as PermissionMode)}>
          {MODES.map(({ id, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={id} value={id} disabled={!modeAvailable(id, agent)} className="items-start gap-2 py-2">
              <ItemIcon size={15} strokeWidth={1.5} aria-hidden="true" className={cn('mt-0.5 shrink-0', id === 'bypass' && 'text-error')} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">{t(`composer.modes.${id}.name`)}</span>
                <span className="text-[11px] leading-snug text-text-3">
                  {modeAvailable(id, agent) ? t(`composer.modes.${id}.hint`) : t('composer.modes.claudeOnly')}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
