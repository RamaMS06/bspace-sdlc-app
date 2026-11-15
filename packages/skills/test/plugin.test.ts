import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSessionPreamble, languageHint, sessionFacts } from '../src/preamble';
import { PLUGIN_SKILLS, PLUGIN_VERSION } from '../src/sdlcSkills.generated';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-plugin');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text.replace(/^\uFEFF/, ''));
  if (!m) throw new Error('no frontmatter');
  return Object.fromEntries(
    m[1]!.split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}

describe('bundled agent plugin (bspace-sdlc-skills)', () => {
  const skills = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  it('is the bspace-sdlc-skills plugin, at the version the index was generated from', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(manifest.name).toBe('bspace-sdlc-skills');
    expect(manifest.version).toBe(PLUGIN_VERSION);
  });

  it('has the SDLC skills, ideate to verify', () => {
    for (const name of ['using-bspace-sdlc', 'stakeholder-intake', 'blueprint-ftsd', 'wireframe-lofi', 'figma-generate-screen', 'flutter-slice-screen', 'vue-slice-screen', 'flutter-run-verify']) {
      expect(skills).toContain(name);
    }
    expect(skills).not.toContain('bspace-sdlc-app');
  });

  it.each(readdirSync(join(root, 'skills')).filter((n) => existsSync(join(root, 'skills', n, 'SKILL.md'))))('%s SKILL.md has valid frontmatter', (name) => {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    expect(fm.name).toBe(name);
    expect(fm.description!.length).toBeGreaterThan(20);
  });

  it('the generated index lists every SKILL.md', () => {
    expect(Object.keys(PLUGIN_SKILLS).sort()).toEqual(skills.filter((n) => existsSync(join(root, 'skills', n, 'SKILL.md'))).sort());
  });
});

describe('session preamble (agents that cannot load the plugin)', () => {
  it('carries the SDLC entry skill without its frontmatter', () => {
    const p = buildSessionPreamble();
    expect(p).toContain('You are running inside BSpace SDLC');
    expect(p).toContain('# Using bspace SDLC');
    expect(p).not.toContain('name: using-bspace-sdlc');
    expect(p).not.toMatch(/hyperframes|remotion|renders\//i);
  });

  it('applies the skill only when asked: /using-bspace-sdlc or a feature chat, never for an ordinary message', () => {
    const p = buildSessionPreamble();
    expect(p).toMatch(/Apply it only when the user types \/using-bspace-sdlc, or when this chat is already a feature/);
    expect(p).toMatch(/answer normally: do not follow it, do not start or restart an SDLC workflow/);
    expect(p).not.toContain('Follow these instructions for the whole session');
  });

  it('adds the Indonesian hint only for the id language', () => {
    expect(languageHint('en')).toBe('');
    expect(buildSessionPreamble('id')).toContain('The user reads Indonesian. Reply in Indonesian unless they write in another language.');
    expect(buildSessionPreamble('en')).not.toContain('The user reads Indonesian');
  });

  it("states the user's time zone and the feature id", () => {
    const facts = { timeZone: 'Asia/Jakarta', offset: '+07:00', localNow: 'Wednesday 2026-11-04 17:55', projectId: 'p1' };
    const text = sessionFacts(facts);
    expect(text).toContain('Asia/Jakarta (UTC+07:00)');
    expect(text).toContain("This feature's Buma id is p1.");
    expect(buildSessionPreamble(null, facts)).toContain('Asia/Jakarta');
    expect(sessionFacts(null)).toBe('');
  });
});

describe("the plugin's other skills for agents that cannot load the plugin", () => {
  it('names where each skill is on disk and what each is for', () => {
    const p = buildSessionPreamble(null, null, '/Apps/BSpace/agent-plugin');
    expect(p).toContain('/Apps/BSpace/agent-plugin/skills/<skill>/SKILL.md');
    expect(p).toContain('"<plugin-root>" means /Apps/BSpace/agent-plugin');
    for (const id of ['stakeholder-intake', 'wireframe-lofi', 'blueprint-ftsd', 'figma-generate-screen', 'flutter-slice-screen', 'vue-slice-screen']) {
      expect(p).toMatch(new RegExp(`- ${id}: \\S`));
    }
    // The entry skill is already in the text; it isn't listed twice.
    expect(p).not.toMatch(/- using-bspace-sdlc:/);
  });

  it('without a known folder the preamble is what it was', () => {
    expect(buildSessionPreamble()).not.toContain('SKILL.md');
    expect(buildSessionPreamble(null, null, null)).toBe(buildSessionPreamble());
  });
});
