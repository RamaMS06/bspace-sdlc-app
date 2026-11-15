import { stageChips } from '@/features/sdlc/lib/stageChips';
import en from '@/i18n/en';
import id from '@/i18n/id';

describe('quick replies by stage', () => {
  it('every stage starts with "What\'s next?" and has its own replies', () => {
    for (let s = 0; s <= 6; s++) expect(stageChips(s)[0]).toBe('next');
    expect(stageChips(0)).toContain('ideateSummary');
    expect(stageChips(3)).toContain('designReview');
    expect(stageChips(4)).toContain('buildEmulator');
    // No two stages share their specific replies.
    const specific = [0, 1, 2, 3, 4, 5, 6].flatMap((s) => stageChips(s).slice(1));
    expect(new Set(specific).size).toBe(specific.length);
  });

  it('a finished feature (past Deploy) and a bad index get a sensible set', () => {
    expect(stageChips(7)).toEqual(stageChips(6));
    expect(stageChips(-1)).toEqual(stageChips(0));
  });

  it('every key is written in English and Indonesian, and none is left from the video app', () => {
    const keys = [...new Set([0, 1, 2, 3, 4, 5, 6].flatMap((s) => stageChips(s)))];
    for (const lang of [en, id] as const) {
      const chips = lang.composer.chips as Record<string, string>;
      for (const k of keys) expect(chips[k], k).toBeTruthy();
      expect(Object.keys(chips).sort()).toEqual([...keys].sort());
    }
  });
});
