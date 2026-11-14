/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project token (public, write-only); unset means no analytics. */
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The app version from package.json, set at build time (vite.config.ts `define`). */
declare const __APP_VERSION__: string;
