import { projectFiles, readProjectFile, type ProjectFile } from '@/shared/lib/ipc';

/**
 * The documents each SDLC stage makes, found in the feature's folder where the bspace-sdlc-skills write
 * them, so they can be read in the app without Word, Finder or Figma:
 *
 * | Stage     | Documents                                                                          |
 * |-----------|------------------------------------------------------------------------------------|
 * | Ideate    | stakeholder-input/<feature>/intake.md, intent/<ID>/intent.md                       |
 * | Blueprint | sdlc/project.md, data.md, Blueprint.docx (or .md), FTSD.docx (or .md), openapi.yaml |
 * | Wireframe | intent/<ID>/wireframe.md, wireframe-evidence/ pictures                             |
 * | Design    | intent/<ID>/design.md, design-evidence/ pictures, the Figma link in design.md      |
 * | Build     | the Android emulator, live; specs/<slice>/spec.md, plan.md                         |
 * | Verify    | specs/<slice>/plan.md (its run lines), renders/ and device-shots/ pictures         |
 * | Deploy    | intent/<ID>/close.md                                                               |
 */
export type StageDoc =
  | { kind: 'markdown' | 'text' | 'docx'; path: string; name: string }
  | { kind: 'images'; path: string; name: string; paths: string[] }
  /** The Android emulator, live (see DevicePanel). */
  | { kind: 'device'; path: string; name: string };

export interface StageDocs {
  docs: StageDoc[];
  /** A Figma design link found in the stage's documents. */
  figma: string | null;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

async function list(projectId: string, dir: string): Promise<ProjectFile[]> {
  try {
    return await projectFiles(projectId, dir);
  } catch {
    return [];
  }
}

const file = (files: ProjectFile[], name: string) => files.find((f) => !f.dir && f.name.toLowerCase() === name.toLowerCase());
const dir = (files: ProjectFile[], name: string) => files.find((f) => f.dir && f.name === name);

function doc(f: ProjectFile | undefined, docs: StageDoc[]) {
  if (!f) return;
  const ext = f.name.split('.').pop()?.toLowerCase();
  docs.push({ kind: ext === 'docx' ? 'docx' : ext === 'md' ? 'markdown' : 'text', path: f.path, name: f.name });
}

async function pictures(projectId: string, folder: ProjectFile | undefined, docs: StageDoc[]) {
  if (!folder) return;
  const paths = (await list(projectId, folder.path)).filter((f) => !f.dir && IMAGE.test(f.name)).map((f) => f.path);
  if (paths.length) docs.push({ kind: 'images', path: folder.path, name: folder.name, paths });
}

/** The first Figma design link in `text`. */
export function figmaLink(text: string | null): string | null {
  return text?.match(/https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[^\s)>\]"'`]+/)?.[0] ?? null;
}

/** The documents of stage `stage` (0 Ideate … 6 Deploy) in the feature's folder. */
export async function stageDocs(projectId: string, stage: number): Promise<StageDocs> {
  const docs: StageDoc[] = [];
  let figma: string | null = null;
  const intentDir = (await list(projectId, 'intent')).find((f) => f.dir)?.path ?? null;
  const intent = intentDir ? await list(projectId, intentDir) : [];
  const specDir = (await list(projectId, 'specs')).filter((f) => f.dir).at(-1)?.path ?? null;
  const spec = specDir ? await list(projectId, specDir) : [];

  switch (stage) {
    case 0: {
      for (const d of (await list(projectId, 'stakeholder-input')).filter((f) => f.dir)) doc(file(await list(projectId, d.path), 'intake.md'), docs);
      doc(file(intent, 'intent.md'), docs);
      break;
    }
    case 1: {
      const sdlc = await list(projectId, 'sdlc');
      doc(file(sdlc, 'project.md'), docs);
      doc(file(sdlc, 'data.md'), docs);
      // The .docx is the source once it exists; the .md beside it is only its snapshot.
      doc(file(sdlc, 'Blueprint.docx') ?? file(sdlc, 'Blueprint.md') ?? file(sdlc, 'blueprint.draft.md'), docs);
      doc(file(sdlc, 'FTSD.docx') ?? file(sdlc, 'FTSD.md'), docs);
      doc(file(sdlc, 'openapi.yaml'), docs);
      break;
    }
    case 2: {
      doc(file(intent, 'wireframe.md'), docs);
      await pictures(projectId, dir(intent, 'wireframe-evidence'), docs);
      break;
    }
    case 3: {
      const design = file(intent, 'design.md');
      doc(design, docs);
      await pictures(projectId, dir(intent, 'design-evidence'), docs);
      if (design) {
        try {
          const f = await readProjectFile(projectId, design.path);
          figma = figmaLink(f.text);
        } catch {
          figma = null;
        }
      }
      if (!figma) {
        const catalog = file(await list(projectId, 'sdlc'), 'figma-reference-catalog.md');
        if (catalog) figma = figmaLink((await readProjectFile(projectId, catalog.path).catch(() => null))?.text ?? null);
      }
      break;
    }
    case 4: {
      docs.push({ kind: 'device', path: 'device', name: 'Preview' });
      doc(file(spec, 'spec.md'), docs);
      doc(file(spec, 'plan.md'), docs);
      break;
    }
    case 5: {
      doc(file(spec, 'plan.md'), docs);
      await pictures(projectId, dir(spec, 'renders'), docs);
      // Screenshots taken from the device preview.
      await pictures(projectId, dir(await list(projectId, ''), 'device-shots'), docs);
      break;
    }
    case 6: {
      doc(file(intent, 'close.md'), docs);
      break;
    }
  }
  return { docs, figma };
}
