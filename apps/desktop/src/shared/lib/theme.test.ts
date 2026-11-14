import { beforeEach, describe, expect, it } from 'vitest';
import { forceLight, initTheme, setTheme, themeChoice, toggleTheme } from '@/shared/lib/theme';

const isDark = () => document.documentElement.classList.contains('dark');

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    forceLight(false);
    initTheme();
  });

  it('defaults to the system theme', () => {
    expect(themeChoice()).toBe('system');
  });

  it('puts .dark on <html> for dark and takes it off for light, remembering the choice', () => {
    setTheme('dark');
    expect(isDark()).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    setTheme('light');
    expect(isDark()).toBe(false);
    setTheme('system');
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('toggles between light and dark', () => {
    setTheme('light');
    toggleTheme();
    expect(themeChoice()).toBe('dark');
    toggleTheme();
    expect(themeChoice()).toBe('light');
  });

  it('starts light while onboarding when the user has not chosen, and keeps a choice made with the switch', () => {
    setTheme('system');
    forceLight(true);
    expect(isDark()).toBe(false);
    // The switch on the onboarding screens makes an explicit choice, which holds there and after.
    toggleTheme();
    expect(themeChoice()).toBe('dark');
    expect(isDark()).toBe(true);
    toggleTheme();
    expect(isDark()).toBe(false);
    forceLight(false);
    expect(themeChoice()).toBe('light');
    expect(isDark()).toBe(false);
  });
});
