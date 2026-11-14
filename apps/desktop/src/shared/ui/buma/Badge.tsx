import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * React port of the BUMA Design System `BBadge` (design-system/vue-source/src/components/ui/badge/).
 * A status label: success, waiting, draft, revise, reject or neutral, soft by default or filled with
 * `reverse`. Colors are the Vue source's exactly.
 */
export type BumaBadgeVariant = 'success' | 'waiting' | 'draft' | 'revise' | 'reject' | 'neutral';

export interface BumaBadgeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label?: string;
  variant?: BumaBadgeVariant;
  /** Filled: the tone as the background and white text. */
  reverse?: boolean;
  /** Full width, centered. */
  block?: boolean;
  children?: React.ReactNode;
}

const SOFT: Record<BumaBadgeVariant, string> = {
  success: 'bg-[var(--buma-background-success-100)] text-[var(--buma-text-success-500)]',
  waiting: 'bg-[var(--buma-background-secondary-100)] text-[var(--buma-text-secondary-500)]',
  revise: 'bg-[var(--buma-background-warning-100)] text-[var(--buma-text-warning-600)]',
  draft: 'bg-[var(--buma-background-info-100)] text-[var(--buma-text-info-500)]',
  reject: 'bg-[var(--buma-background-error-100)] text-[var(--buma-text-error-500)]',
  neutral: 'bg-[var(--buma-background-neutral-300)] text-[var(--buma-icon-dark)]',
};

const FILLED: Record<BumaBadgeVariant, string> = {
  success: 'bg-[var(--buma-background-success-500)]',
  waiting: 'bg-[var(--buma-background-secondary-500)]',
  revise: 'bg-[var(--buma-background-warning-600)]',
  draft: 'bg-[var(--buma-background-info-500)]',
  reject: 'bg-[var(--buma-background-error-500)]',
  neutral: 'bg-[var(--buma-background-light-dark)]',
};

export function BumaBadge({ label, variant = 'success', reverse = false, block = false, className, children, ...rest }: BumaBadgeProps) {
  return (
    <div
      data-testid="badge"
      className={cn(
        'inline-flex h-6 items-center rounded-[5px] px-[1em] py-[0.5em] text-[12px] leading-4 font-medium whitespace-nowrap',
        reverse ? cn(FILLED[variant], 'text-[var(--buma-text-white)]') : SOFT[variant],
        block && 'w-full justify-center',
        className,
      )}
      {...rest}
    >
      {children ?? <span>{label}</span>}
    </div>
  );
}
