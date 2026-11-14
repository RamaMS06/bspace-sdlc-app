import * as React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * React port of the BUMA Design System `BChips` (design-system/vue-source/src/components/ui/chips/).
 * A rounded tag: primary (grey), secondary (outlined), outline (quiet) or color (green), optionally
 * removable. Clicks do nothing while disabled.
 */
export type BumaChipsVariant = 'primary' | 'secondary' | 'outline' | 'color';

export interface BumaChipsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onClick'> {
  label?: string;
  variant?: BumaChipsVariant;
  small?: boolean;
  removable?: boolean;
  disabled?: boolean;
  onClick?(): void;
  onRemove?(): void;
  children?: React.ReactNode;
}

const VARIANT: Record<BumaChipsVariant, { base: string; hover: string; disabled: string }> = {
  primary: {
    base: 'border-transparent bg-[var(--buma-background-neutral-300)] text-[var(--buma-text-dark)]',
    hover: 'hover:bg-[var(--buma-background-dark)] hover:text-[var(--buma-text-white)]',
    disabled: 'bg-[var(--buma-background-dark)] text-[var(--buma-text-white)] opacity-50',
  },
  secondary: {
    base: 'border-[var(--buma-stroke-light-dark)] bg-transparent text-[var(--buma-text-light-dark)]',
    hover: 'hover:border-transparent hover:bg-[var(--buma-background-neutral-300)] hover:text-[var(--buma-text-dark)]',
    disabled: 'border-[var(--buma-stroke-dark)] bg-transparent text-[var(--buma-text-dark)] opacity-50',
  },
  outline: {
    base: 'border-[var(--buma-stroke-light)] bg-transparent text-[var(--buma-text-light-dark)]',
    hover: '',
    disabled: 'border-[var(--buma-stroke-light)] bg-transparent text-[var(--buma-text-dark)] opacity-50',
  },
  color: {
    base: 'border-transparent bg-[var(--buma-background-success-500)] text-[var(--buma-text-white)]',
    hover: 'hover:bg-[var(--buma-background-success-600)]',
    disabled: 'bg-[var(--buma-background-success-500)] text-[var(--buma-text-white)] opacity-50',
  },
};

export function BumaChips({
  label,
  variant = 'primary',
  small = false,
  removable = false,
  disabled = false,
  onClick,
  onRemove,
  className,
  children,
  ...rest
}: BumaChipsProps) {
  const { t } = useTranslation();
  const v = VARIANT[variant];
  const text = children ?? label;
  return (
    <div
      data-testid="chips"
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onClick?.()}
      className={cn(
        'inline-flex h-fit w-fit cursor-default items-center justify-center gap-2 rounded-full border px-3 py-2 text-[12px] leading-4 font-medium whitespace-nowrap transition-colors',
        disabled ? v.disabled : cn(v.base, v.hover),
        small && 'h-6 rounded-[12px] px-2 py-1',
        className,
      )}
      {...rest}
    >
      {text}
      {removable && !disabled && (
        <button
          type="button"
          data-testid="chipsRemove"
          aria-label={label ? t('common.removeNamed', { name: label }) : t('common.remove')}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-current"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
