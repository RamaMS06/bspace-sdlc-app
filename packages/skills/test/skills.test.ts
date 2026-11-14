import { describe, expect, it } from 'vitest';
import type { SystemInfo } from '@bspace-sdlc-app/shared';
import {
  BUILTIN_SKILLS,
  FOREGROUND_RULE,
  userSkillsText,
  buildInstallPrompt,
  buildProjectBrief,
  installCommands,
  NODE_DOWNLOAD_URL,
  WORD_DOWNLOAD_URL,
  FIGMA_DOWNLOAD_URL,
  FLUTTER_INSTALL_URL,
  FIGMA_MCP_URL,
  manualInstallUrl,
  needsSudo,
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

describe('brief', () => {
  const p = { title: 'Attendance', folder: '/w/attendance', slug: 'attendance' } as Parameters<typeof buildProjectBrief>[0];

  it('points the agent at the SDLC entry skill and keeps work in the folder', () => {
    const b = buildProjectBrief(p);
    expect(b.startsWith('# Attendance')).toBe(true);
    expect(b).toContain('using-bspace-sdlc');
    expect(b).toContain('/w/attendance');
    expect(b).toContain('Keep all files in this folder');
    expect(b).toMatch(/never write an Approved-by line/);
  });

  it('uses the skills for work on the feature, and gives a message about anything else a normal answer', () => {
    const b = buildProjectBrief(p);
    expect(b).toMatch(/when the user works on this feature or types a skill/);
    expect(b).toMatch(/nothing to do with the feature gets a normal answer; do not start a workflow or a skill/);
  });

  it('has nothing about videos', () => {
    const b = buildProjectBrief(p);
    expect(b).not.toMatch(/video|render|hyperframes|remotion/i);
  });
});

describe('foreground rule', () => {
  it('keeps long work inside the turn', () => {
    expect(FOREGROUND_RULE).toMatch(/foreground/);
    expect(FOREGROUND_RULE).not.toMatch(/video|render/i);
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
