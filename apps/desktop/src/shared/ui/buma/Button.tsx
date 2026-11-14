import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * React port of the BUMA Design System `BButton` (Vue, from buma-registry via `pnpm buma:pull button`;
 * source in design-system/vue-source/src/components/ui/button/). Same props and variants; colors come from
 * the BUMA tokens (--buma-*), so it follows light and dark. Differences from the Vue source:
 * - `onClick` instead of the `click` emit, and `children` instead of the default slot.
 * - A visible focus ring for keyboard users (keyboard focus only; nothing else changes).
 * Colors, sizes and hover states are the Vue source's exactly, including what its class names really match:
 * a filled primary keeps its condition color on hover, and among outline conditions only approve fills.
 */
export type BumaButtonVariant = 'primary' | 'secondary' | 'secondary-white' | 'tertiary' | 'hover-card';
export type BumaButtonCondition = 'approve' | 'reject' | 'revise' | 'outstanding';

export interface BumaButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Text when there are no children. */
  label?: string;
  variant?: BumaButtonVariant;
  /** Color of a primary button: approve (green), reject (red), revise (orange), outstanding (blue). */
  condition?: BumaButtonCondition;
  /** Outline style; primary and secondary only. */
  outline?: boolean;
  small?: boolean;
  block?: boolean;
  pill?: boolean;
  iconOnly?: boolean;
  children?: React.ReactNode;
}

// .b-btn-approve / -reject / -revise / -outstanding: the color, and the same color on hover.
const FILLED: Record<BumaButtonCondition, string> = {
  approve: 'bg-[var(--buma-background-success-500)]',
  reject: 'bg-[var(--buma-background-error-500)]',
  revise: 'bg-[var(--buma-background-secondary-500)]',
  outstanding: 'bg-[var(--buma-background-info-500)]',
};

// .b-btn-outline-primary--<condition>: only approve has hover and disabled rules.
const OUTLINE: Record<BumaButtonCondition, string> = {
  approve:
    'border-[var(--buma-stroke-success-500)] text-[var(--buma-text-success-500)] hover:border-[var(--buma-stroke-success-600)] hover:bg-[var(--buma-background-success-600)] hover:text-[var(--buma-text-white)] active:border-[var(--buma-stroke-success-600)] active:bg-[var(--buma-background-success-600)] active:text-[var(--buma-text-white)] disabled:border-[var(--buma-stroke-success-500)] disabled:bg-transparent disabled:text-[var(--buma-text-success-500)]',
  reject: 'border-[var(--buma-stroke-error-500)] text-[var(--buma-text-error-500)]',
  revise: 'border-[var(--buma-stroke-secondary-500)] text-[var(--buma-text-secondary-500)]',
  outstanding: 'border-[var(--buma-stroke-info-500)] text-[var(--buma-text-info-500)]',
};

const VARIANT: Record<Exclude<BumaButtonVariant, 'primary'>, string> = {
  secondary:
    'border border-[var(--buma-stroke-light)] bg-[var(--buma-background-light)] text-[var(--buma-text-dark)] hover:border-[var(--buma-background-neutral-300)] hover:bg-[var(--buma-background-neutral-200)] active:border-[var(--buma-stroke-light)]',
  'secondary-white':
    'border border-[var(--buma-stroke-light)] bg-[var(--buma-background-white)] text-[var(--buma-text-dark)] hover:border-[var(--buma-background-neutral-300)] hover:bg-[var(--buma-background-neutral-300)] active:border-[var(--buma-stroke-light)]',
  tertiary: 'bg-transparent text-[var(--buma-text-success-500)] hover:text-[var(--buma-text-success-600)]',
  'hover-card':
    'h-6 bg-[var(--buma-background-dark)] p-1 text-[var(--buma-text-white)] hover:bg-[#191d22]',
};

const OUTLINE_SECONDARY =
  'border border-[var(--buma-stroke-dark)] bg-transparent text-[var(--buma-text-dark)] hover:bg-[var(--buma-background-dark)] hover:text-[var(--buma-text-white)]';

/** The class list for a BUMA button, for elements that must look like one without being a BumaButton. */
export function bumaButtonClass({
  variant = 'primary',
  condition = 'approve',
  outline = false,
  small = false,
  block = false,
  pill = false,
  iconOnly = false,
}: Pick<BumaButtonProps, 'variant' | 'condition' | 'outline' | 'small' | 'block' | 'pill' | 'iconOnly'> = {}) {
  const outlined = outline && (variant === 'primary' || variant === 'secondary');
  return cn(
    // .b-btn: body typography (12/16, 500), 40px tall, padding sm md, radius small.
    'inline-flex h-10 w-fit cursor-pointer items-center justify-center gap-1 rounded-[5px] border-0 px-4 py-3 text-[12px] leading-4 font-medium transition-colors',
    'active:shadow-[inset_0_4px_4px_var(--buma-shadow-25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:shadow-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    variant === 'primary' && !outlined && cn('text-[var(--buma-text-white)]', FILLED[condition]),
    variant === 'primary' && outlined && cn('border border-solid bg-transparent', OUTLINE[condition]),
    variant === 'secondary' && outlined && OUTLINE_SECONDARY,
    variant !== 'primary' && !outlined && VARIANT[variant],
    iconOnly && variant !== 'hover-card' && 'w-10 px-3',
    small && 'h-6 px-2 py-1',
    small && iconOnly && variant !== 'hover-card' && 'w-6',
    block && 'w-full',
    pill && 'rounded-[30px]',
  );
}

export const BumaButton = React.forwardRef<HTMLButtonElement, BumaButtonProps>(function BumaButton(
  // i18n-ignore: the Vue default label, only shown when a caller passes neither label nor children
  { label = 'Button', variant, condition, outline, small, block, pill, iconOnly, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-testid="button"
      className={cn(bumaButtonClass({ variant, condition, outline, small, block, pill, iconOnly }), className)}
      {...rest}
    >
      {children ?? (label ? <span>{label}</span> : null)}
    </button>
  );
});
