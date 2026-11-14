import type { OsKind } from './types';

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface Entitlements {
  /** The account's plan, as the API names it (`free` without one). */
  plan: string;
  features: string[];
  /** AI credits a month that come with the plan. */
  credits: number;
}

/** POST /v1/telemetry/ping (public, no auth). Nothing here identifies a person: no IP, name or path is stored. */
export interface TelemetryPing {
  /** Random uuid v4, generated once on the computer. */
  installId: string;
  platform: OsKind;
  osVersion: string;
  arch: string;
  appVersion: string;
}

/** GET /v1/stats (Bearer ADMIN_TOKEN). */
export interface InstallStats {
  total: number;
  byPlatform: Record<OsKind, number>;
  byArch: Record<string, number>;
  byAppVersion: Record<string, number>;
  active7d: number;
  active30d: number;
  newLast7d: number;
}
