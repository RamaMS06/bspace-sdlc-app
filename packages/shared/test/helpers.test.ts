import { describe, expect, it } from 'vitest';
import {
  parseVersion,
  requiredMissing,
  slugify,
  uniqueSlug,
  versionAtLeast,
  type ToolStatus,
} from '../src/index';

describe('slugify', () => {
  it('handles basic titles', () => {
    expect(slugify('Kenapa Rupiah Melemah?')).toBe('kenapa-rupiah-melemah');
    expect(slugify('Kopi "Senja" ÉLAN')).toBe('kopi-senja-elan');
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });
  it('falls back to feature', () => {
    expect(slugify('???')).toBe('feature');
    expect(slugify('')).toBe('feature');
  });
  it('caps at 48 chars without trailing dash', () => {
    const s = slugify('a'.repeat(47) + ' bbbb');
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith('-')).toBe(false);
    expect(slugify('x'.repeat(100)).length).toBe(48);
  });
});

describe('uniqueSlug', () => {
  it('suffixes on collision', () => {
    expect(uniqueSlug('promo', [])).toBe('promo');
    expect(uniqueSlug('promo', ['promo'])).toBe('promo-2');
    expect(uniqueSlug('promo', ['promo', 'promo-2'])).toBe('promo-3');
  });
});

describe('parseVersion', () => {
  it('parses real-world strings', () => {
    expect(parseVersion('v22.12.0')).toBe('22.12.0');
    expect(parseVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
    expect(parseVersion('Python 3.12.1')).toBe('3.12.1');
    expect(parseVersion('2026.10.22')).toBe('2026.10.22');
    expect(parseVersion('nope')).toBeNull();
  });
});

describe('versionAtLeast', () => {
  it('compares major', () => {
    expect(versionAtLeast('22.12.0', 22)).toBe(true);
    expect(versionAtLeast('20.1.0', 22)).toBe(false);
    expect(versionAtLeast(null, 22)).toBe(false);
  });
});

describe('requiredMissing', () => {
  it('returns required and not ok', () => {
    const t = (id: ToolStatus['id'], required: boolean, ok: boolean): ToolStatus => ({
      id, name: id, required, found: ok, version: null, ok, detail: '',
    });
    const r = requiredMissing([t('node', true, false), t('git', true, true), t('figma', false, false)]);
    expect(r.map((x) => x.id)).toEqual(['node']);
  });
});
