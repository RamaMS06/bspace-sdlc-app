/** Public API of the chat feature: other features and app/ import from here only. */
export { NewFeatureDialog } from './components/NewFeatureDialog';
export { featureChat, runStage } from './lib/featureChat';
export { recentChats } from './lib/recentChats';
export { ChatRoute, useSoloChat } from './screens/ChatRoute';
export { useChat } from './state/chat';
export { useFolders } from './state/folders';
export { refreshJobs, useJobs } from './state/jobs';
