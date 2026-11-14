import { invoke } from '@tauri-apps/api/core';
import type { UsageResponse } from '@bspace-sdlc-app/shared';

/** What a cloud call can fail with: the kebab-case `CloudError` from Rust, or `other`. */
export type CloudErrorCode =
  | 'signed-out'
  | 'plan-required'
  | 'quota-exceeded'
  | 'unavailable'
  | 'provider'
  | 'not-found'
  | 'in-progress'
  | 'invalid'
  | 'network'
  | 'server'
  | 'bad-url'
  | 'too-large'
  | 'rate-limited'
  | 'other';

const CODES = new Set<CloudErrorCode>([
  'signed-out', 'plan-required', 'quota-exceeded', 'unavailable', 'provider', 'not-found', 'in-progress',
  'invalid', 'network', 'server', 'bad-url', 'too-large', 'rate-limited',
]);

/** `cloud:plan-required` → `plan-required`; anything else is `other`. */
export function cloudErrorCode(e: unknown): CloudErrorCode {
  const m = /^cloud:([a-z-]+)$/.exec(e instanceof Error ? e.message : String(e));
  return m && CODES.has(m[1] as CloudErrorCode) ? (m[1] as CloudErrorCode) : 'other';
}

export const cloudUsage = () => invoke<UsageResponse>('cloud_usage');
