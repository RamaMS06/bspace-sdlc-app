import { slugify, type Project } from '@bspace-sdlc-app/shared';

/**
 * The AGENTS.md brief of a feature's folder: what the feature is and how to work on it with the
 * bspace-sdlc-skills plugin. The skills route by the files on disk (intent/, sdlc/, specs/), so the brief
 * only points the agent at the entry skill.
 */
export function buildProjectBrief(p: Pick<Project, 'title' | 'folder'>): string {
  return [
    `# ${p.title}`,
    '',
    '## Feature',
    `- A BUMA feature (app) being built in BSpace SDLC. Its folder: ${p.folder || slugify(p.title)}.`,
    '',
    '## How to work',
    '- Use the bspace-sdlc-skills plugin. Start with the using-bspace-sdlc skill: it reads the files on disk (stakeholder-input/, sdlc/, intent/<ID>-<slug>/, specs/) and names the next step.',
    '- Every gate is approved by a person (analyst, designer, developer, QA). Ask for the approval; never write an Approved-by line the user did not give.',
    '- Keep all files in this folder. Do not write outside it.',
    '- Designs use the BUMA Design System in Figma through the Figma MCP; Flutter and Vue code use the BUMA Design System packages.',
    '',
  ].join('\n');
}
