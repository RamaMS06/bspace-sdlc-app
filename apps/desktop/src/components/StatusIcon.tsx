import { Bot, CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react';
import { BumaLoading } from '@/components/buma/Loading';
import { cn } from '@/lib/utils';

/** What a status icon says: the agent itself, done, working or waiting, something went wrong, or a note. */
export type StatusKind = 'agent' | 'success' | 'working' | 'error' | 'info';

const ICON: Record<Exclude<StatusKind, 'working'>, { icon: LucideIcon; className: string }> = {
  agent: { icon: Bot, className: 'text-text-2' },
  success: { icon: CircleCheck, className: 'text-success' },
  error: { icon: CircleAlert, className: 'text-error' },
  info: { icon: Info, className: 'text-text-2' },
};

/** A plain status icon (lucide), in place of a mascot. Decoration: the text next to it says the same. */
export function StatusIcon({ kind, size = 28, className }: { kind: StatusKind; size?: number; className?: string }) {
  // Working is the BUMA Design System loader, like every loader in the app.
  if (kind === 'working')
    return (
      // Decoration: the text beside it is the status, so the loader stays out of the accessibility tree.
      <span aria-hidden="true" className={cn('inline-flex shrink-0', className)}>
        <BumaLoading variant="sync" label={false} size={size} />
      </span>
    );
  const { icon: Icon, className: tone } = ICON[kind];
  return <Icon aria-hidden="true" size={size} strokeWidth={1.5} className={cn('shrink-0', tone, className)} />;
}
