import { useEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import chartLoad from './loading/Chart-Load.json';
import dataLoad from './loading/Data-Load.json';
import pageProcess from './loading/Page-Process-Table-Load.json';
import refresh from './loading/Refresh.json';
import syncData from './loading/Sync-Data.json';

/**
 * React port of the BUMA Design System `BLoading` (Vue, pulled with `pnpm buma:pull loading`; source in
 * design-system/vue-source/src/components/ui/loading/). The same Lottie animations and props. The
 * animation is tinted with `color` / `strokeColor` (default: BUMA's success green from the tokens, so it
 * follows light and dark). Differences from the Vue source: the label is translated, the animation
 * holds still for people who ask for less motion, and the label is the accessible status text.
 */
export type BumaLoadingVariant = 'data' | 'sync' | 'refresh' | 'process' | 'chart';

export interface BumaLoadingProps {
  variant?: BumaLoadingVariant;
  /** Show the label next to the animation ("Loading" with moving dots). */
  label?: boolean;
  labelText?: string;
  /** Overrides the variant's animation. */
  animationData?: unknown;
  autoPlay?: boolean;
  loop?: boolean;
  speed?: number;
  direction?: 1 | -1;
  /** Square size (px number or CSS length); overrides width / height. */
  size?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
  strokeColor?: string;
  className?: string;
  extraClass?: string;
}

const ANIMATION: Record<BumaLoadingVariant, unknown> = {
  data: dataLoad,
  sync: syncData,
  refresh,
  process: makeColorable(pageProcess),
  chart: chartLoad,
};

/** The variant's own size when none is given (from _loading.scss). */
const DEFAULT_SIZE: Record<BumaLoadingVariant, number> = { data: 24, sync: 24, refresh: 24, process: 40, chart: 40 };

/** Page-Process animates its colors; like the Vue source, neutralise them so the tint applies. */
function makeColorable(animation: unknown) {
  const clone = JSON.parse(JSON.stringify(animation)) as { layers?: { shapes?: unknown[] }[] };
  const visit = (shapes: unknown[]) => {
    for (const s of shapes as { ty?: string; it?: unknown[]; c?: { a: number; k: unknown } }[]) {
      if (!s || typeof s !== 'object') continue;
      if (s.ty === 'gr' && Array.isArray(s.it)) visit(s.it);
      if ((s.ty === 'fl' || s.ty === 'st') && s.c) {
        s.c.a = 0;
        s.c.k = [0, 0, 0, 1];
      }
    }
  };
  for (const layer of clone.layers ?? []) if (Array.isArray(layer.shapes)) visit(layer.shapes);
  return clone;
}

const css = (v?: number | string) => (v === undefined ? undefined : typeof v === 'number' || /^\d+$/.test(v) ? `${v}px` : v);

function reducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function BumaLoading({
  variant = 'data',
  label = true,
  labelText,
  animationData,
  autoPlay = true,
  loop = true,
  speed = 1,
  direction = 1,
  size,
  width,
  height,
  color = 'var(--buma-icon-success)',
  strokeColor = 'var(--buma-icon-success)',
  className,
  extraClass,
}: BumaLoadingProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const data = animationData ?? ANIMATION[variant];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let anim: { destroy(): void; setSpeed(n: number): void; setDirection(d: 1 | -1): void; goToAndStop(f: number, isFrame?: boolean): void } | null = null;
    let gone = false;
    // The player loads on demand; where it can't run (tests, an old webview) the label still shows.
    import('lottie-web/build/player/lottie_light')
      .then(({ default: lottie }) => {
        if (gone) return;
        const still = reducedMotion();
        anim = lottie.loadAnimation({
          container: el,
          renderer: 'svg',
          loop: still ? false : loop,
          autoplay: still ? false : autoPlay,
          animationData: JSON.parse(JSON.stringify(data)),
        });
        anim.setSpeed(speed);
        anim.setDirection(direction);
        if (still) anim.goToAndStop(0, true);
      })
      .catch(() => {});
    return () => {
      gone = true;
      anim?.destroy();
    };
  }, [data, loop, autoPlay, speed, direction]);

  const side = css(size) ?? (width === undefined && height === undefined ? `${DEFAULT_SIZE[variant]}px` : undefined);
  const style = {
    width: side ?? css(width),
    height: side ?? css(height),
    '--b-loader-fill': color,
    '--b-loader-stroke': strokeColor,
  } as CSSProperties;
  const text = labelText ?? t('common.loading');

  return (
    <div role="status" aria-label={label ? undefined : text} className={cn('b-loader inline-flex items-center justify-center gap-1', className)}>
      <div ref={box} data-testid="loading" aria-hidden="true" className={cn('b-loader__animation shrink-0', extraClass)} style={style} />
      {label && (
        <p data-testid="loadingLabel" className="m-0 text-[12px] leading-4 font-medium text-text-2">
          {text}
          <span className="b-loader__dots" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
