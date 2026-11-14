import { beforeEach, describe, expect, it } from 'vitest';
import { forceLight, initTheme, setTheme, themeChoice, toggleTheme } from '@/lib/theme';

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

  it('stays light while onboarding forces it, then goes back to the choice', () => {
    setTheme('dark');
    forceLight(true);
    expect(isDark()).toBe(false);
    forceLight(false);
    expect(isDark()).toBe(true);
  });
});
