import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/shared/lib/utils';

/**
 * React port of the BUMA Design System tab bar (`UITabBar` in buma-registry's Flutter `tab` component;
 * the Vue registry has none). A 46px bar on a full-width hairline; each tab is a label with 8px sides, the
 * active one in the primary colour and semibold, the others in the quiet text colour and medium; under the
 * active tab a 2px underline with rounded top corners (danger colour when the tab is in error). A tab's
 * width never changes between its two weights: the wider one is reserved under the label.
 *
 * It is the bar only: the screen shows the content of the selected tab itself.
 */
export interface BumaTabItem {
  value: string;
  label: string;
  /** Before the label (16px). */
  icon?: React.ReactNode;
  /** After the label, such as a count. */
  suffix?: React.ReactNode;
  /** The tab has a problem: its colour and underline turn to the danger colour while it is selected. */
  error?: boolean;
  disabled?: boolean;
}

export interface BumaTabsProps extends Omit<React.ComponentProps<typeof TabsPrimitive.Root>, 'children' | 'onValueChange'> {
  items: BumaTabItem[];
  value: string;
  onValueChange(value: string): void;
  /** The bar's accessible name. */
  'aria-label': string;
}

export function BumaTabs({ items, value, onValueChange, className, 'aria-label': label, ...rest }: BumaTabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cn('w-full', className)} {...rest}>
      <TabsPrimitive.List
        data-testid="buma-tabs"
        aria-label={label}
        className="relative flex h-[46px] w-full items-stretch gap-0 overflow-x-auto border-b border-[var(--buma-stroke-light)]"
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              data-error={item.error || undefined}
              className={cn(
                'relative flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-[14px] outline-none',
                // No box around the selected tab: keyboard focus shows as the label turning to the full text colour.
                'focus-visible:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active ? (item.error ? 'text-[var(--buma-text-error-500)]' : 'text-primary-text focus-visible:text-primary-text') : 'text-[var(--buma-text-light-dark)] hover:text-foreground',
              )}
            >
              {item.icon && <span className="inline-flex size-4 items-center justify-center [&_svg]:size-4">{item.icon}</span>}
              {/* The label, with the semibold (wider) form reserved under it, so the tab keeps its width when it is
                  selected. The reserved copy is a pseudo-element: it is not in the page's text. */}
              <span
                data-label={item.label}
                className={cn(
                  'inline-flex flex-col items-center',
                  "after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]",
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {item.label}
              </span>
              {item.suffix}
              {active && (
                <span
                  aria-hidden="true"
                  data-testid="buma-tab-indicator"
                  className={cn('absolute inset-x-2 bottom-[-1px] h-0.5 rounded-t-[4px]', item.error ? 'bg-[var(--buma-background-error-500)]' : 'bg-primary')}
                />
              )}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
