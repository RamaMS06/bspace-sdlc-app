import { vi } from 'vitest';
import type { Project, ProjectStatus } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  setProjectStatus: vi.fn(),
}));

import { setProjectStatus } from '@/lib/ipc';
import { advanceProject, isWorkTool, resetProjectStatus } from '@/lib/projectStatus';
import { useApp } from '@/state/app';

const proj = (id: string, status: ProjectStatus): Project => ({ id, title: id, slug: id, folder: `/w/${id}`, status, createdAt: 'c', updatedAt: 'u' });

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectStatus();
  vi.mocked(setProjectStatus).mockImplementation(async (id, status) => proj(id, status));
});

describe('isWorkTool', () => {
  it('is a finished edit, delete, move or command', () => {
    for (const k of ['edit', 'delete', 'move', 'execute'] as const) {
      expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done', toolKind: k })).toBe(true);
    }
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'running', toolKind: 'edit' })).toBe(false);
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done', toolKind: 'read' })).toBe(false);
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done' })).toBe(false);
    expect(isWorkTool({ type: 'text', text: 'edit' })).toBe(false);
  });
});

describe('advanceProject', () => {
  it('moves a project once and refreshes the project lists; never asks to go back', async () => {
    const before = useApp.getState().projectsVersion;
    await advanceProject('p1', 'building');
    await advanceProject('p1', 'building');
    expect(setProjectStatus).toHaveBeenCalledTimes(1);
    expect(setProjectStatus).toHaveBeenCalledWith('p1', 'building');
    expect(useApp.getState().projectsVersion).toBe(before + 1);
  });

  it('two calls at once ask once; a failed call can be tried again', async () => {
    await Promise.all([advanceProject('p1', 'building'), advanceProject('p1', 'building')]);
    expect(setProjectStatus).toHaveBeenCalledTimes(1);
    vi.mocked(setProjectStatus).mockRejectedValueOnce(new Error('db busy'));
    await advanceProject('p2', 'building');
    await advanceProject('p2', 'building');
    expect(setProjectStatus).toHaveBeenCalledTimes(3);
  });
});
