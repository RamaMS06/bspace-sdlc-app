import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  listSkills: vi.fn(),
  pickFolder: vi.fn(),
  readSkill: vi.fn(),
  saveSkill: vi.fn(),
  setSkillEnabled: vi.fn(),
  deleteSkill: vi.fn(),
  importSkill: vi.fn(),
  fetchGithubSkills: vi.fn(),
  installGithubSkills: vi.fn(),
  discardGithubSkills: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/lib/plugins', () => ({
  pluginsList: vi.fn(),
  pluginStageFolder: vi.fn(),
  pluginStageZip: vi.fn(),
  pluginStageGithub: vi.fn(),
  pluginInstall: vi.fn(),
  pluginDiscard: vi.fn().mockResolvedValue(undefined),
  pluginRemove: vi.fn(),
  pluginSetEnabled: vi.fn(),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  deleteSkill,
  discardGithubSkills,
  fetchGithubSkills,
  importSkill,
  installGithubSkills,
  listSkills,
  readSkill,
  saveSkill,
  setSkillEnabled,
} from '@/lib/ipc';
import { Skills } from '@/screens/Skills';
import * as plugins from '@/lib/plugins';

const bundled = {
  name: 'bspace-sdlc-skills',
  version: '1.0.8',
  description: 'BUMA SDLC workflows',
  source: 'bundled' as const,
  enabled: true,
  replaced: false,
  skills: [
    { id: 'blueprint-ftsd', description: 'Blueprint and FTSD' },
    { id: 'using-bspace-sdlc', description: 'Entry point' },
  ],
  hooks: ['python3 office_state.py'],
  path: '/res/agent-plugin',
};

/** The Skills screen opens on Plugins: the user's own skills are on the Skills tab. */
async function renderSkills() {
  render(<Skills />);
  await userEvent.click(screen.getByRole('tab', { name: 'Skills' }));
}

const hooks = { id: 'hooks', description: 'Use when writing hooks', enabled: true, path: '/d/skills/hooks/SKILL.md' };

beforeEach(() => {
  vi.mocked(listSkills).mockReset().mockResolvedValue([hooks]);
  vi.mocked(plugins.pluginsList).mockReset().mockResolvedValue([bundled]);
  for (const fn of [plugins.pluginInstall, plugins.pluginDiscard, plugins.pluginStageFolder, plugins.pluginSetEnabled]) vi.mocked(fn).mockClear();
});

describe('Skills screen', () => {
  it("opens on Plugins with the bundled plugin folded to one card; Skills has the user's own", async () => {
    render(<Skills />);
    const card = await screen.findByTestId('plugin-bspace-sdlc-skills-bundled');
    expect(card).toHaveTextContent('v1.0.8');
    expect(card).toHaveTextContent('Bundled');
    expect(card).toHaveTextContent('2 skills');
    expect(within(card).queryByText('blueprint-ftsd')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: /2 skills/ }));
    expect(within(card).getByText('blueprint-ftsd')).toBeInTheDocument();
    expect(within(card).getByText('python3 office_state.py')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Skills' }));
    expect(await screen.findByText('hooks')).toBeInTheDocument();
    expect(screen.getByText('Use when writing hooks')).toBeInTheDocument();
  });

  it('installs a plugin from a folder only after showing its skills and hooks', async () => {
    const user = userEvent.setup();
    const { pickFolder } = await import('@/lib/ipc');
    vi.mocked(pickFolder).mockResolvedValue('/Users/rama/bspace-fe-skills');
    const update = { ...bundled, version: '1.0.9', source: 'installed' as const, path: '/data/plugins/bspace-sdlc-skills' };
    vi.mocked(plugins.pluginStageFolder).mockResolvedValue({ id: 's1', plugins: [update] });
    vi.mocked(plugins.pluginInstall).mockResolvedValue([{ ...bundled, enabled: false, replaced: true }, update]);
    render(<Skills />);
    await screen.findByTestId('plugin-bspace-sdlc-skills-bundled');
    await user.click(screen.getByRole('button', { name: 'Add plugin' }));
    await user.click(await screen.findByRole('menuitem', { name: 'From a folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install this plugin?' });
    expect(dialog).toHaveTextContent('v1.0.9');
    expect(within(dialog).getByRole('note')).toHaveTextContent('python3 office_state.py');
    expect(plugins.pluginInstall).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Install' }));
    expect(plugins.pluginInstall).toHaveBeenCalledWith('s1');
    const updated = await screen.findByTestId('plugin-bspace-sdlc-skills-installed');
    expect(updated).toHaveTextContent('Update');
    expect(within(updated).getByRole('button', { name: 'Use bundled version' })).toBeInTheDocument();
    expect(screen.getByTestId('plugin-bspace-sdlc-skills-bundled')).toHaveTextContent('Replaced by the installed version');
  });

  it('cancelling an install drops what was staged', async () => {
    const user = userEvent.setup();
    const { pickFolder } = await import('@/lib/ipc');
    vi.mocked(pickFolder).mockResolvedValue('/x');
    vi.mocked(plugins.pluginStageFolder).mockResolvedValue({ id: 's2', plugins: [{ ...bundled, source: 'installed' as const }] });
    render(<Skills />);
    await screen.findByTestId('plugin-bspace-sdlc-skills-bundled');
    await user.click(screen.getByRole('button', { name: 'Add plugin' }));
    await user.click(await screen.findByRole('menuitem', { name: 'From a folder' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(plugins.pluginDiscard).toHaveBeenCalledWith('s2'));
    expect(plugins.pluginInstall).not.toHaveBeenCalled();
  });

  it('turns a plugin off', async () => {
    vi.mocked(plugins.pluginSetEnabled).mockResolvedValue([{ ...bundled, enabled: false }]);
    render(<Skills />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Turn bspace-sdlc-skills on or off' }));
    expect(plugins.pluginSetEnabled).toHaveBeenCalledWith('bspace-sdlc-skills', false);
  });

  it('says how to start when there are none', async () => {
    vi.mocked(listSkills).mockResolvedValue([]);
    await renderSkills();
    expect(await screen.findByText('No skills of your own yet')).toBeInTheDocument();
  });

  it('turns a skill off', async () => {
    vi.mocked(setSkillEnabled).mockResolvedValue({ ...hooks, enabled: false });
    await renderSkills();
    await userEvent.click(await screen.findByRole('switch', { name: 'Use hooks' }));
    expect(setSkillEnabled).toHaveBeenCalledWith('hooks', false);
  });

  it('creates a skill from the editor', async () => {
    vi.mocked(saveSkill).mockResolvedValue(hooks);
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'New skill' }));
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add skill' });
    expect(add).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Captions');
    await userEvent.type(within(dialog).getByLabelText('When to use it'), 'Use for captions');
    await userEvent.type(within(dialog).getByLabelText('Instructions'), 'Short lines.');
    await userEvent.click(add);
    expect(saveSkill).toHaveBeenCalledWith({ name: 'Captions', description: 'Use for captions', body: 'Short lines.' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits a skill with what is on disk', async () => {
    vi.mocked(readSkill).mockResolvedValue({ skill: hooks, body: 'Ask a question.' });
    vi.mocked(saveSkill).mockResolvedValue(hooks);
    await renderSkills();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit hooks' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Name')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Instructions')).toHaveValue('Ask a question.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saveSkill).toHaveBeenCalledWith({ id: 'hooks', name: 'hooks', description: 'Use when writing hooks', body: 'Ask a question.' });
  });

  it('shows why a save was refused and keeps the editor open', async () => {
    vi.mocked(saveSkill).mockRejectedValue('Give the skill a name with letters or numbers');
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'New skill' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), '!!!');
    await userEvent.type(within(dialog).getByLabelText('When to use it'), 'd');
    await userEvent.type(within(dialog).getByLabelText('Instructions'), 'b');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add skill' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Give the skill a name');
  });

  it('asks before deleting', async () => {
    vi.mocked(deleteSkill).mockResolvedValue(undefined);
    await renderSkills();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete hooks' }));
    expect(deleteSkill).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteSkill).toHaveBeenCalledWith('hooks');
  });

  it('imports the picked SKILL.md, and does nothing when the picker is closed', async () => {
    vi.mocked(importSkill).mockResolvedValue(hooks);
    vi.mocked(openDialog).mockResolvedValueOnce(null).mockResolvedValueOnce('/x/SKILL.md');
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const pick = await screen.findByRole('button', { name: 'Pick a SKILL.md on this computer' });
    await userEvent.click(pick);
    expect(importSkill).not.toHaveBeenCalled();
    await userEvent.click(pick);
    await waitFor(() => expect(importSkill).toHaveBeenCalledWith('/x/SKILL.md'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  const download = {
    id: 'd1',
    skills: [
      { folder: 'skills/hooks', name: 'hooks', description: 'Use for hooks', scripts: [], scriptCount: 0, source: 'https://github.com/a/b/tree/HEAD/skills/hooks' },
      {
        folder: 'skills/pdf',
        name: 'pdf',
        description: 'Use for PDFs',
        scripts: ['scripts/a.py', 'scripts/b.py', 'scripts/c.py'],
        scriptCount: 5,
        source: 'https://github.com/a/b/tree/HEAD/skills/pdf',
      },
    ],
  };

  it('adds the chosen skills from a GitHub link, saying which run code', async () => {
    vi.mocked(fetchGithubSkills).mockResolvedValue(download);
    vi.mocked(installGithubSkills).mockResolvedValue({ added: [hooks], failed: [] });
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await userEvent.type(await screen.findByLabelText('From GitHub'), ' https://github.com/a/b ');
    await userEvent.click(screen.getByRole('button', { name: 'Find skills' }));
    expect(fetchGithubSkills).toHaveBeenCalledWith('https://github.com/a/b');
    expect(await screen.findByText('Found 2 skills')).toBeInTheDocument();
    expect(screen.getAllByText('Runs code')).toHaveLength(1);
    expect(screen.getByText(/scripts\/a\.py, scripts\/b\.py, scripts\/c\.py \+2 more/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick a skill to add' })).toBeDisabled();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /pdf/ }));
    expect(screen.getByRole('note')).toHaveTextContent('Only add them from people you trust');
    await userEvent.click(screen.getByRole('checkbox', { name: /hooks/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 skills' }));
    expect(installGithubSkills).toHaveBeenCalledWith('d1', [
      { folder: 'skills/hooks', source: 'https://github.com/a/b/tree/HEAD/skills/hooks' },
      { folder: 'skills/pdf', source: 'https://github.com/a/b/tree/HEAD/skills/pdf' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(discardGithubSkills).not.toHaveBeenCalled();
    expect(listSkills).toHaveBeenCalledTimes(2);
  });

  it('picks a lone skill already, and throws the download away when closed', async () => {
    vi.mocked(fetchGithubSkills).mockResolvedValue({ id: 'd2', skills: download.skills.slice(0, 1) });
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await userEvent.type(await screen.findByLabelText('From GitHub'), 'github.com/a/b/tree/main/skills/hooks{Enter}');
    expect(await screen.findByRole('button', { name: 'Add 1 skill' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(discardGithubSkills).toHaveBeenCalledWith('d2'));
  });

  it('says why a link failed', async () => {
    vi.mocked(fetchGithubSkills).mockRejectedValue('No SKILL.md in that link');
    await renderSkills();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await userEvent.type(await screen.findByLabelText('From GitHub'), 'https://github.com/a/b{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('No SKILL.md in that link');
  });

  it('shows where a skill from GitHub came from', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ ...hooks, source: 'https://github.com/a/b/tree/HEAD/hooks' }]);
    await renderSkills();
    const link = await screen.findByRole('link', { name: 'From github.com/a/b/tree/HEAD/hooks' });
    expect(link).toHaveAttribute('href', 'https://github.com/a/b/tree/HEAD/hooks');
  });
});
