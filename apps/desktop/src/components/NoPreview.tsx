import type { ReactNode } from 'react';
import { Film } from 'lucide-react';
import { cn } from '@/lib/utils';

// BUMA base palette pairs [fill, text]: primary/600, secondary/600, info/600, neutral/600, neutral/200, primary/100.
// Inline style backgrounds, so literal colors rather than CSS vars.
const SWATCHES: [string, string][] = [
  ['#06873D', '#FFFFFF'],
  ['#C67A17', '#FFFFFF'],
  ['#0363B1', '#FFFFFF'],
  ['#333F47', '#F5F8FA'],
  ['#E8ECF5', '#333F47'],
  ['#D5FADD', '#06873D'],
];

/** A colour pair picked from `id`, the same every time. */
export function swatch(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length]!;
}

/**
 * The calm panel shown when there is no picture: a film icon on the `swatchId`'s colour (a style), or on ink
 * (a video). `children` is the muted line under the icon; without it the panel is decoration only.
 */
export function NoPreview({
  swatchId,
  className,
  'data-testid': testId = 'no-preview',
  children,
}: {
  swatchId?: string;
  className?: string;
  'data-testid'?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-md border border-hairline',
        !swatchId && 'bg-ink',
        className,
      )}
      style={swatchId ? { background: swatch(swatchId)[0] } : undefined}
      aria-hidden={children ? undefined : 'true'}
    >
      <Film size={24} strokeWidth={1.5} aria-hidden="true" className="text-text-3" />
      {children && <span className="inline-flex items-center gap-1.5 text-xs text-text-3">{children}</span>}
    </div>
  );
}
