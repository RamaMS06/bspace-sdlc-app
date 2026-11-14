// Light / dark theme. The BUMA tokens (styles/buma-tokens.css) hold Light on :root and Dark on `.dark`, so a
// theme is only the `dark` class on <html>. The choice defaults to the system's and follows it live.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'theme';
let media: MediaQueryList | null = null;
/** While set, the app is light whatever the choice (the onboarding screens are always white). */
let forcedLight = false;
const listeners = new Set<() => void>();
let snapshot: { choice: ThemeChoice; resolved: ResolvedTheme } = { choice: 'system', resolved: 'light' };

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** What the choice means right now: the system's theme for 'system'. Ignores the onboarding override. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return media?.matches ? 'dark' : 'light';
  return choice;
}

function apply(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  document.documentElement.classList.toggle('dark', !forcedLight && resolved === 'dark');
  if (snapshot.choice !== choice || snapshot.resolved !== resolved) {
    snapshot = { choice, resolved };
    listeners.forEach((l) => l());
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {}
  apply(choice);
}

/** Flips between light and dark from whatever is showing now (an explicit choice, not 'system'). */
export function toggleTheme() {
  setTheme(resolveTheme(themeChoice()) === 'dark' ? 'light' : 'dark');
}

/** Forces the light theme on the whole window (dialogs included) until called with `false`. */
export function forceLight(on: boolean) {
  forcedLight = on;
  apply(themeChoice());
}

export function initTheme() {
  media = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  media?.addEventListener?.('change', () => apply(themeChoice()));
  apply(themeChoice());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme choice and what it resolves to, re-rendering when either changes. */
export function useTheme() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
