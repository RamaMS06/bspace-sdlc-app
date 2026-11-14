import { describe, expect, it } from 'vitest';
import { IMAGE_ASPECTS, usageCycle } from '../src/index';

describe('usage rules', () => {
  it('cycles run 30 days from the anchor', () => {
    const a = '2026-11-04T12:00:00.000Z';
    expect(usageCycle(a, new Date('2026-11-04T12:00:00.000Z'))).toEqual({ start: a, end: '2026-12-04T12:00:00.000Z' });
    expect(usageCycle(a, new Date('2026-12-04T11:59:59.999Z')).start).toBe(a);
    expect(usageCycle(a, new Date('2026-12-04T12:00:00.000Z'))).toEqual({ start: '2026-12-04T12:00:00.000Z', end: '2027-01-03T12:00:00.000Z' });
  });
  it('without an anchor the cycle is the UTC month', () => {
    expect(usageCycle(null, new Date('2026-11-15T03:00:00Z'))).toEqual({ start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' });
    expect(usageCycle(null, new Date('2026-12-31T23:59:59Z')).end).toBe('2027-01-01T00:00:00.000Z');
  });
  it('an anchor in the future (clock skew) starts the cycle at the anchor', () => {
    expect(usageCycle('2026-11-05T00:00:00.000Z', new Date('2026-11-04T23:59:00Z')).start).toBe('2026-11-05T00:00:00.000Z');
  });
  it('image sizes stay at or under 1 megapixel', () => {
    for (const s of Object.values(IMAGE_ASPECTS)) expect(s.width * s.height).toBeLessThanOrEqual(1_000_000);
  });
});
