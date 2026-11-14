import { useEffect, useState } from 'react';
import { projectFiles, readProjectFile, type ProjectFile } from '@/shared/lib/ipc';

/**
 * Where a feature stands in the SDLC, read from the files the bspace-sdlc-skills write in its folder
 * (the same artifacts the using-bspace-sdlc router reads; nothing is kept in the app):
 *
 * | Stage     | Done when                                                                 |
 * |-----------|---------------------------------------------------------------------------|
 * | Ideate    | intent/<ID>-<slug>/intent.md has `Status: approved` and an `Approved-by:` |
 * | Blueprint | sdlc/Blueprint.gate.json has gate B                                       |
 * | Wireframe | intent/…/wireframe.md has `Status: approved`                              |
 * | Design    | intent/…/design.md has `Reviewed-by:`                                     |
 * | Build     | a specs/<…>/spec.md exists and its plan.md has no open `- [ ]` item       |
 * | Verify    | that plan.md has `- run: PASS`                                            |
 * | Deploy    | intent/…/close.md exists                                                  |
 *
 * A stage that has started (its file exists) but isn't done is waiting for a person's approval.
 */
export type StageState = 'done' | 'started' | 'todo';

export interface FeatureState {
  stages: StageState[];
  /** The first stage not done; `stages.length` when every stage is done. */
  current: number;
  /** The current stage has its file but no approval yet: a person has to sign it off. */
  awaitingApproval: boolean;
  /** The intent folder, such as `intent/ATT-attendance`, once there is one. */
  intentDir: string | null;
}

const has = (files: ProjectFile[], name: string) => files.some((f) => !f.dir && f.name === name);

async function list(projectId: string, dir: string): Promise<ProjectFile[]> {
  try {
    return await projectFiles(projectId, dir);
  } catch {
    return [];
  }
}

async function read(projectId: string, path: string): Promise<string | null> {
  try {
    const f = await readProjectFile(projectId, path);
    return f.kind === 'text' ? f.text : null;
  } catch {
    return null;
  }
}

/** `Status: approved` (any case, any spacing), as the skills write it at the top of a Markdown file. */
const approved = (text: string | null) => !!text && /^\s*Status:\s*approved\b/im.test(text);
const line = (text: string | null, key: string) => !!text && new RegExp(`^\\s*${key}:\\s*\\S`, 'im').test(text);

export function stagesFrom(facts: {
  intent: string | null;
  intake: boolean;
  blueprintGate: string | null;
  blueprint: boolean;
  wireframe: string | null;
  design: string | null;
  spec: boolean;
  plan: string | null;
  close: boolean;
}): Pick<FeatureState, 'stages' | 'current' | 'awaitingApproval'> {
  const gateB = (() => {
    try {
      return !!facts.blueprintGate && 'B' in (JSON.parse(facts.blueprintGate) as Record<string, unknown>);
    } catch {
      return false;
    }
  })();
  const pairs: [done: boolean, started: boolean][] = [
    [approved(facts.intent) && line(facts.intent, 'Approved-by'), facts.intake || !!facts.intent],
    [gateB, facts.blueprint],
    [approved(facts.wireframe), !!facts.wireframe],
    [line(facts.design, 'Reviewed-by'), !!facts.design],
    [facts.spec && !!facts.plan && !/^\s*- \[ \]/m.test(facts.plan), facts.spec],
    [!!facts.plan && /^\s*- run:\s*PASS\b/im.test(facts.plan), !!facts.plan && /^\s*- run:/im.test(facts.plan)],
    [facts.close, false],
  ];
  const stages = pairs.map(([done, started]): StageState => (done ? 'done' : started ? 'started' : 'todo'));
  const current = stages.findIndex((s) => s !== 'done');
  const at = current === -1 ? stages.length : current;
  return { stages, current: at, awaitingApproval: stages[at] === 'started' };
}

/** Reads a feature's folder and places it in the SDLC. Missing folders and files simply count as not done. */
export async function readFeatureState(projectId: string): Promise<FeatureState> {
  const root = await list(projectId, '');
  const intentDirs = (await list(projectId, 'intent')).filter((f) => f.dir);
  const intentDir = intentDirs[0]?.path ?? null;
  const intentFiles = intentDir ? await list(projectId, intentDir) : [];
  const sdlc = await list(projectId, 'sdlc');
  const specDirs = (await list(projectId, 'specs')).filter((f) => f.dir);
  const specDir = specDirs.at(-1)?.path ?? null;
  const specFiles = specDir ? await list(projectId, specDir) : [];
  const facts = {
    intent: intentDir && has(intentFiles, 'intent.md') ? await read(projectId, `${intentDir}/intent.md`) : null,
    intake: root.some((f) => f.dir && f.name === 'stakeholder-input'),
    blueprintGate: has(sdlc, 'Blueprint.gate.json') ? await read(projectId, 'sdlc/Blueprint.gate.json') : null,
    blueprint: has(sdlc, 'Blueprint.docx') || has(sdlc, 'Blueprint.md') || has(sdlc, 'project.md'),
    wireframe: intentDir && has(intentFiles, 'wireframe.md') ? await read(projectId, `${intentDir}/wireframe.md`) : null,
    design: intentDir && has(intentFiles, 'design.md') ? await read(projectId, `${intentDir}/design.md`) : null,
    spec: has(specFiles, 'spec.md'),
    plan: specDir && has(specFiles, 'plan.md') ? await read(projectId, `${specDir}/plan.md`) : null,
    close: has(intentFiles, 'close.md'),
  };
  return { ...stagesFrom(facts), intentDir };
}

/** How often the open feature's folder is read again (the agent writes its files while it works). */
const REFRESH_MS = 5000;

/** The feature's state read from its files, kept fresh while the caller is mounted; undefined until the first read. */
export function useFeatureState(projectId: string | undefined): FeatureState | undefined {
  const [state, setState] = useState<FeatureState>();
  useEffect(() => {
    setState(undefined);
    if (!projectId) return;
    let alive = true;
    const load = () => void readFeatureState(projectId).then((s) => alive && setState(s)).catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);
  return state;
}

/** The 7 stages as the header's 5 steps: Wireframe and Design are both "Design"; Deploy done is every step done. */
export const STEP_OF_STAGE = [0, 1, 2, 2, 3, 4, 5] as const;
