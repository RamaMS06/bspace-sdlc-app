import type { UiLanguage } from '@bspace-sdlc-app/shared';
import { PLUGIN_SKILLS } from './sdlcSkills.generated';

const usingBspaceSdlc = PLUGIN_SKILLS['using-bspace-sdlc'] ?? '';

/** Agents can't speak after their turn ends: long work must run inside the turn, where Buma shows it. */
export const FOREGROUND_RULE =
  "Never end your turn by saying what you will do next (\"I'll run the tests next\"): do it in the same turn. End your turn only when the work is done, or when you need the user to answer or allow something. Run installs, builds, tests and pipelines in the foreground and wait for them to finish before you reply. Never start a long job in the background and end your turn: you can't message the user after your turn ends, and Buma shows the user that you're still working while your turn runs. If a command needs more than a few minutes, say so first, then run it and wait. Keep command output short: use the command's quiet flag, or end a long install or build with `2>&1 | tail -n 30` and read those last lines for errors; progress bars and install logs only fill your context.";

/** A SKILL.md may start with a UTF-8 byte order mark; frontmatter parsing ignores it. */
const noBom = (text: string) => text.replace(/^\uFEFF/, '');
const stripFrontmatter = (text: string): string => noBom(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '').trim();

/** One line telling the agent which language the user reads; empty for English, the default. */
export function languageHint(language?: UiLanguage | null): string {
  return language === 'id'
    ? 'The user reads Indonesian. Reply in Indonesian unless they write in another language. Keep code, commands and file names as they are.'
    : '';
}

/** What the agent can't know by itself: the user's clock, and which feature a project chat is about. */
export interface SessionFacts {
  /** IANA name, such as `Asia/Jakarta`. */
  timeZone: string;
  /** UTC offset as RFC 3339 writes it, such as `+07:00`. */
  offset: string;
  /** The user's local date and time when the chat started, such as `Wednesday 2026-11-04 17:55`. */
  localNow: string;
  /** The Buma id of the feature a project chat is about. */
  projectId?: string;
}

/** The time zone line, and the project id line for a project chat. Empty without facts. */
export function sessionFacts(facts?: SessionFacts | null): string {
  if (!facts) return '';
  return [
    `The user's local time zone is ${facts.timeZone} (UTC${facts.offset}). It was ${facts.localNow} when this chat started.`,
    facts.projectId ? `This feature's Buma id is ${facts.projectId}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The SDLC entry skill (using-bspace-sdlc) as plain text, for agents that cannot load the Claude Code
 * plugin. Put it in front of the first prompt of a session.
 */
export function buildSessionPreamble(language?: UiLanguage | null, facts?: SessionFacts | null): string {
  return [
    'You are running inside BSpace SDLC. Below is the using-bspace-sdlc skill. Apply it only when the user types /using-bspace-sdlc, or when this chat is already a feature (its folder has an AGENTS.md brief). For anything else (a question, a quick task, a chat) answer normally: do not follow it, do not start or restart an SDLC workflow, and do not run any skill the user did not ask for.',
    stripFrontmatter(usingBspaceSdlc),
    languageHint(language),
    sessionFacts(facts),
    '---',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A skill the user added on the Skills screen. */
export interface UserSkill {
  id: string;
  description: string;
  enabled: boolean;
  /** Its SKILL.md on disk. */
  path: string;
  /** The GitHub link it was added from, when it came from one. */
  source?: string | null;
}

/**
 * The user's own skills that are on, for agents that can't load them as a plugin: each one's name,
 * when to use it and where its SKILL.md is. Empty when none are on.
 */
export function userSkillsText(skills: readonly UserSkill[]): string {
  const on = skills.filter((s) => s.enabled);
  if (!on.length) return '';
  return [
    'The user added these skills of their own. When a task matches one, read its SKILL.md first and follow it:',
    ...on.map((s) => `- ${s.id}: ${s.description.replace(/\s+/g, ' ').trim()} (${s.path})`),
  ].join('\n');
}

const field = (text: string, name: string) => new RegExp(`^---\\r?\\n[\\s\\S]*?^${name}:\\s*(.*?)\\r?$`, 'm').exec(noBom(text))?.[1]?.trim() ?? '';

/** The skills Buma ships, always on: the bspace-sdlc-skills plugin, shown read-only on the Skills screen. */
export const BUILTIN_SKILLS: readonly { id: string; description: string; body: string }[] = Object.entries(PLUGIN_SKILLS)
  .map(([path, text]) => ({
    id: field(text, 'name') || path,
    description: field(text, 'description').replace(/^["']|["']$/g, ''),
    body: stripFrontmatter(text),
  }))
  // The entry skill first, then by name.
  .sort((a, b) => (a.id === 'using-bspace-sdlc' ? -1 : b.id === 'using-bspace-sdlc' ? 1 : a.id.localeCompare(b.id)));
