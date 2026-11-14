import type { ChatMessage, MessagePart, Project } from '@bspace-sdlc-app/shared';
import { buildProjectBrief } from '@bspace-sdlc-app/skills';

/** The features the user mentioned in the chat so far: the agent already has their briefs. */
export const mentionedIn = (messages: ChatMessage[]): string[] => [
  ...new Set(messages.flatMap((m) => (m.role === 'user' ? m.parts.flatMap((p) => (p.type === 'mention' ? [p.projectId] : [])) : []))),
];

/** What the agent gets in front of a message for each feature it mentions for the first time: its folder and brief. */
export function mentionContext(parts: MessagePart[], seen: string[], projects: Project[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    if (part.type !== 'mention' || seen.includes(part.projectId)) continue;
    const p = projects.find((x) => x.id === part.projectId);
    if (!p) continue;
    out.push({
      type: 'text',
      // i18n-ignore: this goes to the agent, not the user
      text: `The user attached the feature "${p.title}". Its Buma id is ${p.id}. Its project folder is ${p.folder}.\n\n${buildProjectBrief(p)}`,
    });
  }
  return out;
}
