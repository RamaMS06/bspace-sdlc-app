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
