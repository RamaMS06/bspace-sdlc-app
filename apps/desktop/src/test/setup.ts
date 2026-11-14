import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setUiLanguage } from '@/i18n';
import { DEFAULT_CHAIN, useFailover } from '@/state/failover';

// Failover moves a failed chat to another agent; tests turn it on when they test it.
beforeEach(() => useFailover.setState({ on: false, chain: DEFAULT_CHAIN, models: {}, extra: {}, accounts: {}, incompatible: {}, cooldown: {}, combos: [{ id: 'default', name: 'Default', steps: [{ agent: 'claude', model: null }] }], defaultCombo: 'default', chatPick: {}, ready: [] }));

// Existing tests assert English copy; tests that want Indonesian switch inside the test.
setUiLanguage('en');
afterEach(() => {
  cleanup();
  setUiLanguage('en');
});

// jsdom lacks these; Radix popovers and cmdk rely on them.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no media playback.
HTMLMediaElement.prototype.play = () => Promise.resolve();
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.load = () => {};

// The app needs an Azure DevOps sign-in to open; tests start signed in unless they mock it otherwise.
vi.mock('@/lib/devops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/devops')>();
  const signedIn = { signedIn: true, profile: { org: 'buma', id: 'u-1', displayName: 'Test User', email: 'test@buma.co.id' } };
  return {
    ...actual,
    devopsStatus: vi.fn().mockResolvedValue(signedIn),
    devopsSignIn: vi.fn().mockResolvedValue(signedIn),
    devopsMicrosoftSignIn: vi.fn().mockResolvedValue(signedIn),
    devopsSignOut: vi.fn().mockResolvedValue({ signedIn: false, profile: null }),
  };
});
