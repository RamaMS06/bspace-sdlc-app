import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * A dropdown field that looks like `Input`: transparent, thin border, the same focus ring, and a small
 * chevron. The browser's own dropdown is glossy white, so its look is turned off (`appearance-none`);
 * the list that opens uses the card colour. `size` sets the height: `md` like Input, `sm` for tight rows.
 */
function Select({ className, children, size = 'md', ...props }: Omit<React.ComponentProps<'select'>, 'size'> & { size?: 'sm' | 'md' }) {
  return (
    <span data-slot="select" className={cn('relative block min-w-0', className)}>
      <select
        className={cn(
          'w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-8 pl-3 text-text-1 shadow-xs transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
          '[&>option]:bg-card [&>option]:text-text-1',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-3" />
    </span>
  );
}

export { Select };
