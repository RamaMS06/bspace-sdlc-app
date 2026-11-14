import { BumaLoading } from '@/components/buma/Loading';
import { cn } from '@/lib/utils';

/**
 * Work under way: the BUMA Design System loader (refresh animation, no label), beside the words that say
 * what is happening (or in a button). Still for people who ask for less motion.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden="true" data-testid="spinner" className={cn('inline-flex shrink-0', className)}>
      <BumaLoading variant="refresh" label={false} size={size} className="pointer-events-none" />
    </span>
  );
}

/** Where content will appear once the API answers: a soft pulsing block of its size. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" data-testid="skeleton" className={cn('block animate-pulse rounded-md bg-raised motion-reduce:animate-none', className)} />;
}
