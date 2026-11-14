import { slugify, type Project, type Settings, type Style, type VideoLanguage } from '@bspace-sdlc-app/shared';
import { AI_ASSETS_RULE, FOREGROUND_RULE, POST_RULE, RENDERS_RULE, STYLE_REFS_DIR, frameCheckPrompt } from './frameCheck';

const LANGUAGE: Record<VideoLanguage, string> = { id: 'Indonesian', en: 'English' };

/** Sent before a project chat's prompt when the frame check is turned off in Settings. */
export const SKIP_FRAME_CHECK = 'Skip the frame check this time.';

const NOTE_LABELS: [keyof Style['notes'], string][] = [
  ['camera', 'Camera'],
  ['pacing', 'Pacing'],
  ['type', 'Type'],
  ['color', 'Color'],
  ['captions', 'Captions'],
  ['transitions', 'Transitions'],
];

/** The style's prompt followed by one `Label: note` line per non-empty aspect. */
/** Where Buma copies a style's reference frames in the project: style-refs/<file name>. */
export const projectRefs = (style: Style | null): string[] =>
  (style?.references ?? []).map((p) => `${STYLE_REFS_DIR}/${p.split(/[\\/]/).pop()}`);

function styleSection(style: Style): string {
  const notes = NOTE_LABELS.flatMap(([k, label]) => {
    const v = style.notes[k]?.trim();
    return v ? [`${label}: ${v}`] : [];
  });
  const refs = projectRefs(style);
  return [
    `Style: ${style.name}`,
    style.prompt,
    ...notes,
    ...(style.build?.trim() ? [`How to build this look: ${style.build.trim()}`] : []),
    ...(style.palette?.length ? [`Palette: ${style.palette.join(', ')}`] : []),
    ...(refs.length
      ? [
          `Reference contact sheets: ${refs.join(', ')}. Each is a 4x3 grid of frames from the source video in time order (left to right, top to bottom); together they show the whole video. Open them all before you start and keep them open: your frames must look like them (rendering technique, characters, palette, lighting, camera, captions, pacing). Match the look, never copy their content.`,
        ]
      : []),
  ].join('\n');
}

/** The project's AGENTS.md. The quality loop is only included when `settings.frameCheck` is on. */
/**
 * The AGENTS.md brief of a feature's folder: what the feature is and how to work on it with the
 * bspace-sdlc-skills plugin. The skills route by the files on disk (intent/, sdlc/, specs/), so the brief
 * only points the agent at the entry skill. `style` and `settings` are kept for callers; unused.
 */
export function buildProjectBrief(
  p: Project,
  _style?: Style | null,
  _settings?: Pick<Settings, 'fps' | 'frameCheck'>,
): string {
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
