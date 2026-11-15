import type { MaterialIconName } from '@/shared/ui/MaterialIcon';

/** What each stage's view button opens (stage 0 Ideate … 6 Deploy): its Material icon and i18n key. */
export const STAGE_VIEWS: readonly { icon: MaterialIconName; key: 'ideate' | 'blueprint' | 'wireframe' | 'design' | 'build' | 'verify' | 'deploy' }[] = [
  { icon: 'idea', key: 'ideate' },
  { icon: 'document', key: 'blueprint' },
  { icon: 'wireframe', key: 'wireframe' },
  { icon: 'design', key: 'design' },
  { icon: 'preview', key: 'build' },
  { icon: 'results', key: 'verify' },
  { icon: 'release', key: 'deploy' },
];
