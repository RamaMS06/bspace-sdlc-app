import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/shared/lib/ipc', () => ({
  projectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  readProjectDocx: vi.fn(),
  assetUrl: (p: string) => `asset://${p}`,
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/sdlc/components/DevicePanel', () => ({ DevicePanel: () => <div>device panel</div> }));
vi.mock('@/shared/lib/highlight', () => ({ highlightFence: vi.fn(async () => null) }));

import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '@/shared/lib/ipc';
import { StageDocs } from '@/features/sdlc/components/StageDocs';
import { figmaLink, stageDocs } from '@/features/sdlc/lib/stageDocs';
import '@/i18n';

const f = (path: string, dir = false) => ({ name: path.split('/').pop()!, path, dir, size: 1, dim: false });

/** A feature folder: path of a folder → what it holds. */
const tree: Record<string, ReturnType<typeof f>[]> = {
  '': [f('sdlc', true), f('intent', true)],
  sdlc: [f('sdlc/project.md'), f('sdlc/Blueprint.docx'), f('sdlc/Blueprint.md'), f('sdlc/FTSD.md'), f('sdlc/openapi.yaml'), f('sdlc/Blueprint.gate.json')],
  intent: [f('intent/ATT-attendance', true)],
  'intent/ATT-attendance': [f('intent/ATT-attendance/intent.md'), f('intent/ATT-attendance/design.md'), f('intent/ATT-attendance/design-evidence', true)],
  'intent/ATT-attendance/design-evidence': [f('intent/ATT-attendance/design-evidence/SCR-01.png'), f('intent/ATT-attendance/design-evidence/notes.json')],
};
const texts: Record<string, string> = {
  'sdlc/project.md': '# Attendance project',
  'sdlc/FTSD.md': '# FTSD',
  'sdlc/openapi.yaml': 'openapi: 3.0.0',
  'intent/ATT-attendance/design.md': 'Frames: https://www.figma.com/design/AbC123/Attendance?node-id=1-2 (G2)',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.projectFiles).mockImplementation(async (_id, dir = '') => (tree[dir] ?? []) as never);
  vi.mocked(ipc.readProjectFile).mockImplementation(async (_id, path) => ({ kind: path.endsWith('.png') ? 'image' : 'text', absPath: `/w/p1/${path}`, size: 1, text: texts[path] ?? null }) as never);
  vi.mocked(ipc.readProjectDocx).mockResolvedValue('# Blueprint\n\n| Field | Source |\n| --- | --- |\n| NRP | SAP |');
});

describe('stage documents', () => {
  it('Blueprint: the .docx (not its .md snapshot), the FTSD and the API contract; never the gate file', async () => {
    const { docs } = await stageDocs('p1', 1);
    expect(docs.map((d) => `${d.kind}:${d.name}`)).toEqual(['markdown:project.md', 'docx:Blueprint.docx', 'markdown:FTSD.md', 'text:openapi.yaml']);
  });

  it('Design: design.md, its screenshots, and the Figma link inside it', async () => {
    const { docs, figma } = await stageDocs('p1', 3);
    expect(docs.map((d) => d.name)).toEqual(['design.md', 'design-evidence']);
    expect(docs[1]).toMatchObject({ kind: 'images', paths: ['intent/ATT-attendance/design-evidence/SCR-01.png'] });
    expect(figma).toBe('https://www.figma.com/design/AbC123/Attendance?node-id=1-2');
    expect(figmaLink('see http://figma.com/design/x')).toBeNull();
  });

  it('shows a Word document as text with its table, switches documents, and opens Figma', async () => {
    const user = userEvent.setup();
    render(<StageDocs projectId="p1" stage={1} onClose={() => {}} />);
    const region = await screen.findByRole('region', { name: 'Blueprint documents' });
    expect(await within(region).findByText('Attendance project')).toBeInTheDocument();
    await user.click(within(region).getByRole('tab', { name: /Blueprint\.docx/ }));
    expect(await within(region).findByRole('table')).toHaveTextContent('NRP');
    expect(ipc.readProjectDocx).toHaveBeenCalledWith('p1', 'sdlc/Blueprint.docx');
    await user.click(within(region).getByRole('tab', { name: /openapi\.yaml/ }));
    expect(await within(region).findByText(/openapi: 3\.0\.0/)).toBeInTheDocument();
  });

  it('design screenshots show as pictures, and Open in Figma opens the link', async () => {
    const user = userEvent.setup();
    render(<StageDocs projectId="p1" stage={3} onClose={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /design-evidence/ }));
    expect(await screen.findByRole('img', { name: 'SCR-01.png' })).toHaveAttribute('src', 'asset:///w/p1/intent/ATT-attendance/design-evidence/SCR-01.png');
    await user.click(screen.getByRole('button', { name: 'Open in Figma' }));
    expect(openUrl).toHaveBeenCalledWith('https://www.figma.com/design/AbC123/Attendance?node-id=1-2');
  });

  it('Build opens on the live device preview, before the spec and plan', async () => {
    const { docs } = await stageDocs('p1', 4);
    expect(docs[0]).toMatchObject({ kind: 'device' });
    render(<StageDocs projectId="p1" stage={4} onClose={() => {}} />);
    expect(await screen.findByText('device panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Preview/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a stage with nothing yet says so', async () => {
    render(<StageDocs projectId="p1" stage={6} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("This stage hasn't made any documents yet.")).toBeInTheDocument());
  });
});
