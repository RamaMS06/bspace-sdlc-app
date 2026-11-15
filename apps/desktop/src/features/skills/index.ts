/** Public API of the skills feature: other features and app/ import from here only. */
export { SLASH, SlashMenu, filterSkills, useSlashSkills } from './components/SlashMenu';
export type { SlashSkill } from './components/SlashMenu';
export { Skills } from './screens/Skills';
export { usePluginSync, usePluginUpdateWatch } from './state/pluginSync';
