import { invoke } from '@tauri-apps/api/core';

/** A Claude Code plugin in the app (src-tauri/src/plugins.rs): the bundled one or an installed one. */
export interface PluginInfo {
  name: string;
  version: string | null;
  description: string;
  source: 'bundled' | 'installed';
  enabled: boolean;
  /** The bundled plugin is replaced by an installed one of the same name. */
  replaced: boolean;
  skills: { id: string; description: string }[];
  /** The commands its hooks run on this computer. */
  hooks: string[];
  path: string;
}

/** What an install found, waiting for the user's OK. */
export interface StagedPlugins {
  id: string;
  plugins: PluginInfo[];
}

export const pluginsList = () => invoke<PluginInfo[]>('plugins_list');
export const pluginStageFolder = (path: string) => invoke<StagedPlugins>('plugin_stage_folder', { path });
export const pluginStageZip = (path: string) => invoke<StagedPlugins>('plugin_stage_zip', { path });
export const pluginStageGithub = (url: string) => invoke<StagedPlugins>('plugin_stage_github', { url });
export const pluginInstall = (id: string) => invoke<PluginInfo[]>('plugin_install', { id });
export const pluginDiscard = (id: string) => invoke<void>('plugin_discard', { id });
export const pluginRemove = (name: string) => invoke<PluginInfo[]>('plugin_remove', { name });
export const pluginSetEnabled = (name: string, enabled: boolean) => invoke<PluginInfo[]>('plugin_set_enabled', { name, enabled });

/** `1.0.9` against `1.0.10`: numbers part by part; a pre-release (`1.1.0-beta`) is below its release; none is lowest. */
export function compareVersions(a: string | null, b: string | null): number {
  if (!a || !b) return a === b ? 0 : a ? 1 : -1;
  const parse = (v: string) => {
    const [main = '', pre] = v.replace(/^v/i, '').split('-', 2);
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  return x.pre ? -1 : y.pre ? 1 : 0;
}

/** What installing a staged plugin would do to the one with its name that is in use now. */
export interface UpdatePlan {
  name: string;
  from: string | null;
  to: string | null;
  /** The staged version is higher: a proper bump. Equal or lower is refused. */
  newer: boolean;
  added: string[];
  removed: string[];
}

/** One plan per staged plugin that has the name of a plugin already in use; `current` is what is in use now. */
export function updatePlans(staged: PluginInfo[], current: PluginInfo[]): UpdatePlan[] {
  return staged.flatMap((s) => {
    const old = current.find((c) => c.name === s.name && !c.replaced);
    if (!old) return [];
    const was = new Set(old.skills.map((k) => k.id));
    const now = new Set(s.skills.map((k) => k.id));
    return [
      {
        name: s.name,
        from: old.version,
        to: s.version,
        newer: compareVersions(s.version, old.version) > 0,
        added: [...now].filter((id) => !was.has(id)),
        removed: [...was].filter((id) => !now.has(id)),
      },
    ];
  });
}

/** What `main` of the plugin's repo has against the version in use (src-tauri/src/domain/plugin_sync.rs). */
export interface SyncStatus {
  current: string | null;
  latest: string | null;
  commit: string;
  /** `main` is ahead of what is in use. */
  newer: boolean;
}

export const pluginSyncCheck = () => invoke<SyncStatus>('plugin_sync_check');
export const pluginSyncApply = () => invoke<PluginInfo[]>('plugin_sync_apply');
