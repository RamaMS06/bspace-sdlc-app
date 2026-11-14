import * as React from 'react';
import { cn } from '@/lib/utils';
import { BumaButton, type BumaButtonVariant } from './Button';

/**
 * React port of the BUMA Design System `BButtonGroup` (design-system/vue-source/src/components/ui/button-group/).
 * Buttons joined into one bar: inner corners squared, borders overlapping by a pixel. An item with
 * `clickable: false` shows as a label (no press shadow, no click).
 */
export interface BumaButtonGroupItem {
  label: string;
  clickable?: boolean;
  click?(): void;
  disabled?: boolean;
  /** Shown before the label (the Vue version takes an icon name; here any element). */
  icon?: React.ReactNode;
  variant?: Extract<BumaButtonVariant, 'primary' | 'secondary' | 'tertiary'>;
}

export interface BumaButtonGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  items: BumaButtonGroupItem[];
  /** Every button the same width. */
  equalWidth?: boolean;
  onClick?(event: { item: BumaButtonGroupItem; index: number }): void;
}

export function BumaButtonGroup({ items, equalWidth = false, onClick, className, ...rest }: BumaButtonGroupProps) {
  return (
    <div role="group" data-testid="button-group" className={cn('inline-flex', className)} {...rest}>
      {items.map((item, index) => (
        <BumaButton
          key={`${item.label}-${index}`}
          variant={item.variant}
          disabled={item.disabled}
          className={cn(
            index > 0 && '-ml-px rounded-l-none',
            index < items.length - 1 && 'rounded-r-none',
            item.clickable === false && 'cursor-default shadow-none active:shadow-none',
            equalWidth && 'flex-1',
          )}
          onClick={() => {
            if (item.clickable === false) return;
            item.click?.();
            onClick?.({ item, index });
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </BumaButton>
      ))}
    </div>
  );
}
