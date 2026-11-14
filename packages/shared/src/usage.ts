// AI credits (images), metered per cycle. This file has the rules and the wire shapes.

export const MAX_IMAGES_PER_REQUEST = 4;
export const USAGE_CYCLE_DAYS = 30;

/** All at or under 1 megapixel. */
export const IMAGE_ASPECTS = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 960, height: 960 },
} as const;
export type ImageAspect = keyof typeof IMAGE_ASPECTS;

const DAY_MS = 86_400_000;

/**
 * The usage cycle `now` falls in: 30-day steps from `anchor` (the running subscription's start),
 * or the UTC calendar month with no anchor. An anchor in the future starts the cycle at the anchor.
 */
export function usageCycle(anchor: string | null, now: Date): { start: string; end: string } {
  const t = now.getTime();
  const a = anchor === null ? NaN : Date.parse(anchor);
  if (Number.isNaN(a)) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    };
  }
  const step = USAGE_CYCLE_DAYS * DAY_MS;
  const start = a + Math.max(0, Math.floor((t - a) / step)) * step;
  return { start: new Date(start).toISOString(), end: new Date(start + step).toISOString() };
}

export interface UsageMeter {
  allowance: number;
  used: number;
  remaining: number;
}

/** GET /v1/usage (Bearer). */
export interface UsageResponse {
  plan: string;
  cycleStart: string;
  cycleEnd: string;
  credits: UsageMeter;
}

/** POST /v1/ai/image body. */
export interface ImageRequest {
  prompt: string;
  aspect?: ImageAspect;
  count?: number;
  clientRequestId?: string;
}

export interface ImageResponse {
  images: { url: string; width: number; height: number; flagged: boolean }[];
  creditsCharged: number;
  usage: UsageMeter;
}
