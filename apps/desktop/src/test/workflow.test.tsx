import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Project } from '@bspace-sdlc-app/shared';
import { DEFAULT_SETTINGS } from '@bspace-sdlc-app/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  projectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  createProject: vi.fn(),
  createChat: vi.fn(),
  listChats: vi.fn(),
  listJobs: vi.fn().mockResolvedValue([]),
  showVideoInFolder: vi.fn(),
}));
vi.mock('@/state/chat', () => ({ useChat: { getState: () => ({ send: vi.fn() }) } }));

import * as ipc from '@/lib/ipc';
import { stagesFrom } from '@/lib/sdlcState';
import { Workflow } from '@/screens/Workflow';
import { useApp } from '@/state/app';

const none = { intent: null, intake: false, blueprintGate: null, blueprint: false, wireframe: null, design: null, spec: false, plan: null, close: false };

describe('SDLC state from the files on disk', () => {
  it('a new feature is on Ideate with nothing started', () => {
    expect(stagesFrom(none)).toEqual({ stages: Array(7).fill('todo'), current: 0, awaitingApproval: false });
  });

  it('an intent without approval waits for a person', () => {
    const s = stagesFrom({ ...none, intent: '# Attendance\nStatus: draft\n' });
    expect(s.stages[0]).toBe('started');
    expect(s.awaitingApproval).toBe(true);
  });

  it('follows the gates in order: approved intent, gate B, approved wireframe, reviewed design', () => {
    const s = stagesFrom({
      ...none,
      intent: 'Status: approved\nApproved-by: Rama 2026-11-14\n',
      blueprintGate: '{"B":{"hash":"abc","dates":[]}}',
      blueprint: true,
      wireframe: 'Status: approved\nApproved-by: PM 2026-11-15\n',
      design: 'Reviewed-by: Designer 2026-11-16\n',
      spec: true,
      plan: '- [x] slice\n- [ ] states\n',
    });
    expect(s.stages.slice(0, 4)).toEqual(['done', 'done', 'done', 'done']);
    expect(s.stages[4]).toBe('started');
    expect(s.current).toBe(4);
  });

  it('a passing run and close.md finish the feature', () => {
    const s = stagesFrom({
      ...none,
      intent: 'Status: approved\nApproved-by: R\n',
      blueprintGate: '{"B":{}}',
      wireframe: 'Status: approved',
      design: 'Reviewed-by: D',
      spec: true,
      plan: '- [x] slice\n- run: PASS iPhone 16\n',
      close: true,
    });
    expect(s.stages.every((x) => x === 'done')).toBe(true);
    expect(s.current).toBe(7);
  });
});

const project = (id: string, title: string): Project =>
  ({ id, title, slug: id, folder: `/w/${id}`, status: 'draft', updatedAt: '2026-11-14T00:00:00Z', createdAt: '' }) as Project;

describe('Workflow screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({ settings: { ...DEFAULT_SETTINGS, workingFolder: '/w', defaultAgent: 'claude' }, route: { name: 'workflow' } });
    vi.mocked(ipc.projectFiles).mockResolvedValue([]);
  });

  it('asks to start the first feature when there is none', async () => {
    vi.mocked(ipc.listProjects).mockResolvedValue([]);
    render(<Workflow />);
    expect(await screen.findByText('No features yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /New feature/ })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Start a new feature' })).toBeInTheDocument();
  });

  it('lists the features and shows the open one on its current stage', async () => {
    vi.mocked(ipc.listProjects).mockResolvedValue([project('p1', 'Attendance')]);
    render(<Workflow />);
    const section = await screen.findByRole('region', { name: 'Attendance' });
    await waitFor(() => expect(within(section).getByTestId('stage-ideate')).toHaveAttribute('aria-current', 'step'));
    expect(within(section).getByRole('button', { name: 'Run Ideate' })).toHaveTextContent('Continue');
    expect(within(section).getByText('0 of 7 stages done')).toBeInTheDocument();
  });

  it('creating a feature makes its project and chat', async () => {
    vi.mocked(ipc.listProjects).mockResolvedValue([]);
    vi.mocked(ipc.createProject).mockResolvedValue(project('p2', 'Payroll'));
    vi.mocked(ipc.listChats).mockResolvedValue([]);
    vi.mocked(ipc.createChat).mockResolvedValue({ id: 'c2', projectId: 'p2', agentId: 'claude', title: 'Payroll' } as never);
    render(<Workflow />);
    await userEvent.click((await screen.findAllByRole('button', { name: /New feature/ }))[0]!);
    await userEvent.type(screen.getByRole('textbox', { name: 'Feature name' }), 'Payroll');
    await userEvent.click(screen.getByRole('button', { name: 'Create and start' }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ title: 'Payroll' });
    expect(vi.mocked(ipc.createProject).mock.calls[0]![1]).toContain('using-bspace-sdlc');
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c2' }));
  });
});

describe('Agent Office in Workflow', () => {
  it('shows the state the plugin hook sent: rooms, agents, what the manager says, the log', async () => {
    const { useOffice } = await import('@/state/office');
    const { AgentOffice } = await import('@/components/AgentOffice');
    useOffice.setState({
      byProject: {
        p1: {
          intent: 'ATT-attendance',
          t: Date.now() / 1000,
          phases: { brainstorm: 'done', design: 'active', slice: 'todo', verify: 'todo', close: 'todo' },
          units: [{ id: 'SCR-01', who: 'Designer', status: 'awaiting-human', ask: 'review the frames (G2)' }],
          agents: [
            { id: 'SCR-01', role: 'designer', room: 'design', unit: 'SCR-01' },
            { id: 'mgr', role: 'manager', say: 'next: 2 Design' },
          ],
          log: [['00:12', 'Manager', 'next: 2 Design', false]],
        },
      },
    });
    render(<AgentOffice projectId="p1" />);
    const office = screen.getByTestId('agent-office');
    expect(within(office).getByText('Live')).toBeInTheDocument();
    expect(within(office).getByTestId('office-room-brainstorm')).toHaveAttribute('data-state', 'done');
    const design = within(office).getByTestId('office-room-design');
    expect(design).toHaveAttribute('data-state', 'active');
    expect(design).toHaveTextContent('Designer');
    expect(design).toHaveTextContent('review the frames (G2)');
    expect(office).toHaveTextContent('Manager: next: 2 Design');
    expect(within(screen.getByRole('list', { name: 'Activity' })).getByText('00:12')).toBeInTheDocument();
  });

  it('says what it will show before the feature starts', async () => {
    const { useOffice } = await import('@/state/office');
    const { AgentOffice } = await import('@/components/AgentOffice');
    useOffice.setState({ byProject: {} });
    render(<AgentOffice projectId="p9" />);
    expect(screen.getByRole('region', { name: 'Agent Office' })).toHaveTextContent('Shows the agents at work once the feature starts.');
  });
});
