import { describe, expect, it } from 'vitest';
import type { Project, Settings, Style, SystemInfo } from '@bspace-sdlc-app/shared';
import {
  FRAME_CHECK_PROMPT,
  BUILTIN_SKILLS,
  userSkillsText,
  FRAMES_CHECKED_TOKEN,
  hasFramesChecked,
  stripFramesToken,
  buildInstallPrompt,
  buildProjectBrief,
  buildStudyStylePrompt,
  buildTopicIdeasPrompt,
  installCommands,
  NODE_DOWNLOAD_URL,
  WORD_DOWNLOAD_URL,
  FIGMA_DOWNLOAD_URL,
  FLUTTER_INSTALL_URL,
  FIGMA_MCP_URL,
  manualInstallUrl,
  needsSudo,
  parseStyleResult,
  parseTopicIdeas,
  topicIdeaFromAction,
  splitTopicJson,
} from '../src/index';

const mac: SystemInfo = { os: 'macos', osVersion: '26', packageManager: 'brew' };
const win: SystemInfo = { os: 'windows', osVersion: '11', packageManager: 'winget' };
const apt: SystemInfo = { os: 'linux', osVersion: '24.04', packageManager: 'apt' };

describe('install', () => {
  it('adds the Figma MCP server through the agent\'s own CLI', () => {
    expect(installCommands('figma-mcp', mac, 'claude')).toEqual([`claude mcp add --transport http --scope user figma ${FIGMA_MCP_URL}`]);
    expect(installCommands('figma-mcp', mac, 'codex')).toEqual([`codex mcp add figma --url ${FIGMA_MCP_URL}`]);
    expect(installCommands('figma-mcp', mac, 'opencode')).toEqual([]);
    const p = buildInstallPrompt('figma-mcp', mac, 'claude');
    expect(p).toContain('claude mcp add');
    expect(p).toContain('claude mcp list');
    expect(buildInstallPrompt('figma-mcp', mac, 'opencode')).toContain(FIGMA_MCP_URL);
  });

  it('git and python per system', () => {
    expect(installCommands('git', mac, 'claude')).toEqual(['brew install git']);
    expect(installCommands('git', win, 'claude')).toEqual(['winget install --id Git.Git -e']);
    expect(installCommands('python', apt, 'claude')).toEqual(['sudo apt install -y python3']);
    const bare: SystemInfo = { os: 'macos', osVersion: '15', packageManager: null };
    expect(installCommands('python', bare, 'claude')).toEqual(['xcode-select --install']);
    expect(buildInstallPrompt('git', mac, 'claude')).toContain('git --version');
  });

  it('linux sudo installs are handed to the user', () => {
    expect(needsSudo('git', apt)).toBe(true);
    expect(needsSudo('git', mac)).toBe(false);
    const p = buildInstallPrompt('python', apt, 'claude');
    expect(p).toContain('Do not run sudo yourself');
  });

  it('flutter mentions the BUMA pinned version', () => {
    expect(installCommands('flutter', mac, 'claude')).toEqual(['brew install --cask flutter']);
    expect(buildInstallPrompt('flutter', mac, 'claude')).toContain('3.27.4');
  });

  it('the user installs Node, Word, and Figma or Flutter without a package manager, from a page', () => {
    const bare: SystemInfo = { os: 'macos', osVersion: '15', packageManager: null };
    expect(manualInstallUrl('node', mac)).toBe(NODE_DOWNLOAD_URL);
    expect(manualInstallUrl('word', win)).toBe(WORD_DOWNLOAD_URL);
    expect(manualInstallUrl('figma', apt)).toBe(FIGMA_DOWNLOAD_URL);
    expect(manualInstallUrl('figma', mac)).toBeNull();
    expect(manualInstallUrl('flutter', bare)).toBe(FLUTTER_INSTALL_URL);
    expect(manualInstallUrl('git', bare)).toBeNull();
  });
});

describe('topics', () => {
  it('parses a json block', () => {
    const t = 'Here:\n```json\n[{"title":"A","kind":"promo","lengthSec":30},{"title":"B","kind":"quote","lengthSec":15},{"title":"C","kind":"news","lengthSec":45}]\n```';
    expect(parseTopicIdeas(t)).toHaveLength(3);
    expect(parseTopicIdeas('nothing')).toEqual([]);
    expect(parseTopicIdeas('```json\n{bad\n```')).toEqual([]);
  });
  it('prompt asks for 3 ideas through the agent\'s question tool, then POST /video, with the motion-only rules', () => {
    const p = buildTopicIdeasPrompt(['promo'], 'id');
    expect(p).toContain('exactly 3');
    expect(p).toContain('AskUserQuestion');
    expect(p).toContain('$BUMA_AI_URL/video');
    expect(p).toContain('lengthSec');
    expect(p).toContain('styleId');
    expect(p).toMatch(/one short, friendly sentence in Indonesian/);
    expect(p).toMatch(/Never suggest anything that needs filming/);
    expect(p).toMatch(/Never write JSON or markup for the choice/);
    expect(p).not.toContain('a2ui');
    expect(p).not.toContain('```json');
  });
  it('prompt lists the given styles, or the three defaults', () => {
    const p = buildTopicIdeasPrompt(['promo'], 'en', [{ id: 'x-style', name: 'X style' }]);
    expect(p).toContain('x-style');
    expect(p).toContain('X style');
    expect(p).toContain('English');
    const d = buildTopicIdeasPrompt(['promo'], 'en');
    expect(d).toContain('atlas-journey');
    expect(d).toContain('Cartoon 3D what-if');
    expect(buildTopicIdeasPrompt(['promo'], 'en', [])).toContain('cartoon-3d-world');
  });
  it('topicIdeaFromAction reads a pick_topic context', () => {
    expect(topicIdeaFromAction({ title: 'T', kind: 'explainer', lengthSec: 30, styleId: 'atlas-journey' })).toEqual({
      title: 'T', kind: 'explainer', lengthSec: 30, styleId: 'atlas-journey',
    });
    expect(topicIdeaFromAction({ title: 'T', kind: 'nope' })).toMatchObject({ kind: 'explainer', lengthSec: 30 });
    expect(topicIdeaFromAction({ kind: 'promo' })).toBeNull();
    // What the user asked for rides along, trimmed and capped; empty notes are left out.
    expect(topicIdeaFromAction({ title: 'T', notes: '  no voice-over  ' })!.notes).toBe('no voice-over');
    expect(topicIdeaFromAction({ title: 'T', notes: '' })).not.toHaveProperty('notes');
    expect(topicIdeaFromAction({ title: 'T', notes: 'x'.repeat(2000) })!.notes).toHaveLength(600);
    // An agent can't ask for a 1-second or a 3-hour video.
    expect(topicIdeaFromAction({ title: 'T', lengthSec: 1 })!.lengthSec).toBe(5);
    expect(topicIdeaFromAction({ title: 'T', lengthSec: 10800 })!.lengthSec).toBe(600);
    expect(topicIdeaFromAction({ title: 'T', lengthSec: '45' })!.lengthSec).toBe(45);
    expect(parseTopicIdeas('```json\n[{"title":"A","kind":"promo","lengthSec":9999}]\n```')[0]!.lengthSec).toBe(600);
  });
  it('splitTopicJson hides a json block that parses as topic ideas', () => {
    const j = '```json\n[{"title":"A","kind":"promo","lengthSec":30}]\n```';
    expect(splitTopicJson(`Halo\n${j}`)).toEqual({ text: 'Halo', ideas: [{ title: 'A', kind: 'promo', lengthSec: 30 }] });
    const other = 'x\n```json\n{"a":1}\n```';
    expect(splitTopicJson(other)).toEqual({ text: other, ideas: [] });
  });
});

describe('style', () => {
  it('parseStyleResult', () => {
    const ok = JSON.stringify({ name: 'X', notes: { camera: 'c' }, prompt: 'p' });
    expect(parseStyleResult(ok, 'https://x')).toMatchObject({ source: 'copied', sourceUrl: 'https://x', name: 'X' });
    expect(parseStyleResult(JSON.stringify({ name: 'X', notes: {} }), 'u')).toBeNull();
    expect(parseStyleResult('nope', 'u')).toBeNull();
  });
  it('study prompt', () => {
    const p = buildStudyStylePrompt('https://v', '/out');
    expect(p).toContain('yt-dlp');
    expect(p).toContain('`"/out/style.json"`');
  });
  it('study prompt downloads to a source.* file and leaves it for Buma', () => {
    const p = buildStudyStylePrompt('https://v', '/Users/a b/x');
    expect(p).toContain('-o "/Users/a b/x/source.%(ext)s"');
    expect(p).toContain('-f "bv*[height<=1080]+ba/b[height<=1080]/b"');
    expect(p).toContain('Leave source.* in place; Buma makes its own contact sheets and a short preview from it, then deletes it.');
    expect(p).not.toContain('Delete the downloaded video');
    expect(p).toContain('Copy the look, never the footage');
    expect(buildStudyStylePrompt('https://v', 'C:\\Users\\a b\\x')).toContain('-o "C:\\Users\\a b\\x\\source.%(ext)s"');
  });
  it('study prompt quotes folders with spaces', () => {
    const p = buildStudyStylePrompt('https://v', '/Users/a b/Buma/.buma/style-study/x');
    expect(p).toContain('into the folder `"/Users/a b/Buma/.buma/style-study/x"`');
    expect(p).toContain('Write `"/Users/a b/Buma/.buma/style-study/x/style.json"`');
    const w = buildStudyStylePrompt('https://v', 'C:\\Users\\a b\\x');
    expect(w).toContain('`"C:\\Users\\a b\\x\\style.json"`');
  });
});

const STYLE: Style = {
  id: 'copied-1',
  name: 'Bold explainer',
  source: 'copied',
  sourceUrl: null,
  notes: {},
  prompt: 'Navy background, white heavy sans.',
  createdAt: '2026-11-04T00:00:00Z',
};

describe('brief', () => {
  const p = { title: 'Attendance', folder: '/w/attendance', slug: 'attendance' } as Parameters<typeof buildProjectBrief>[0];

  it('points the agent at the SDLC entry skill and keeps work in the folder', () => {
    const b = buildProjectBrief(p, null, { fps: 30, frameCheck: true });
    expect(b.startsWith('# Attendance')).toBe(true);
    expect(b).toContain('using-bspace-sdlc');
    expect(b).toContain('/w/attendance');
    expect(b).toContain('Keep all files in this folder');
    expect(b).toMatch(/never write an Approved-by line/);
  });

  it('has nothing about videos', () => {
    const b = buildProjectBrief(p);
    expect(b).not.toMatch(/video|render|hyperframes|remotion/i);
  });
});

describe('frames-checked marker', () => {
  it('is found as the token or as the old English phrase, in any language around it', () => {
    expect(hasFramesChecked('Semua frame beres. [buma:frames-checked]')).toBe(true);
    expect(hasFramesChecked('Frames checked, all good')).toBe(true);
    expect(hasFramesChecked('Semua frame sudah dicek')).toBe(false);
  });
  it('is stripped from what the reader sees', () => {
    expect(stripFramesToken(`${FRAMES_CHECKED_TOKEN}\nDua teks diperbaiki.`)).toBe('Dua teks diperbaiki.');
    expect(stripFramesToken('Frames checked, all good')).toBe('Frames checked, all good');
    expect(stripFramesToken('Selesai.\n\n[buma:frames-checked]')).toBe('Selesai.');
  });
  it('leaves no empty code span when the agent wraps the token in backticks', () => {
    expect(stripFramesToken('Selesai `[buma:frames-checked]` ya')).toBe('Selesai ya');
    expect(stripFramesToken('Selesai.\n\n`[buma:frames-checked]`')).toBe('Selesai.');
    expect(stripFramesToken('Ok ``[buma:frames-checked]``')).toBe('Ok');
  });
  it('hides a partial token at the very end of streaming text', () => {
    expect(stripFramesToken('Selesai. [buma:fra')).toBe('Selesai.');
    expect(stripFramesToken('Selesai.\n`[buma:frames-chec')).toBe('Selesai.');
    expect(stripFramesToken('Selesai. [')).toBe('Selesai.');
    expect(stripFramesToken('Selesai [buma:other] kok')).toBe('Selesai [buma:other] kok');
    expect(stripFramesToken('Array [1] x')).toBe('Array [1] x');
  });
});

describe('user skills', () => {
  const skill = (id: string, enabled: boolean) => ({ id, description: `Use for ${id}.\n  More.`, enabled, path: `/data/user-skills/skills/${id}/SKILL.md` });

  it('lists only the skills that are on, with where to read them', () => {
    const text = userSkillsText([skill('hooks', true), skill('off', false)]);
    expect(text).toContain('- hooks: Use for hooks. More. (/data/user-skills/skills/hooks/SKILL.md)');
    expect(text).not.toContain('off');
  });

  it('says nothing when none are on', () => {
    expect(userSkillsText([skill('off', false)])).toBe('');
  });

  it('shows the bundled bspace-sdlc skills, entry skill first, with descriptions and no frontmatter', () => {
    const [entry] = BUILTIN_SKILLS;
    expect(entry!.id).toBe('using-bspace-sdlc');
    expect(entry!.description).toMatch(/^Entry point for a BUMA feature/);
    expect(entry!.body.startsWith('---')).toBe(false);
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['stakeholder-intake', 'blueprint-ftsd', 'wireframe-lofi', 'figma-generate-screen', 'flutter-slice-screen', 'vue-slice-screen', 'flutter-run-verify']));
    expect(BUILTIN_SKILLS.every((s) => s.description.length > 20)).toBe(true);
  });
});
