import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * React port of the BUMA Design System `BButtonLink` (design-system/vue-source/src/components/ui/button-link/).
 * A text-only action that underlines its label on hover. `modifier` (dark / white) applies to secondary only.
 */
export interface BumaButtonLinkProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label?: string;
  variant?: 'primary' | 'secondary';
  modifier?: 'dark' | 'white';
  children?: React.ReactNode;
}

const TONE = {
  primary: 'text-[var(--buma-text-success-500)] hover:text-[var(--buma-text-success-600)] active:text-[var(--buma-text-light-dark)]',
  secondary: 'text-[var(--buma-text-light-dark)] hover:text-[var(--buma-text-dark)] active:text-[var(--buma-text-dark)]',
  'secondary-dark': 'text-[var(--buma-text-dark)] active:text-[var(--buma-text-light-dark)]',
  'secondary-white': 'text-[var(--buma-text-white)] active:text-[var(--buma-text-light)]',
} as const;

export const BumaButtonLink = React.forwardRef<HTMLButtonElement, BumaButtonLinkProps>(function BumaButtonLink(
  { label, variant = 'primary', modifier, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const tone = modifier && variant === 'secondary' ? (`secondary-${modifier}` as const) : variant;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      data-testid="buttonLink"
      className={cn(
        'group inline-flex w-fit cursor-pointer items-center justify-center gap-2 border-0 bg-transparent p-0 text-[12px] leading-4 font-medium',
        '[&:hover:not(:disabled)>span]:font-semibold [&:hover:not(:disabled)>span]:underline',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        TONE[tone],
        disabled && 'cursor-default opacity-50',
        className,
      )}
      {...rest}
    >
      {children ?? (label ? <span>{label}</span> : null)}
    </button>
  );
});
