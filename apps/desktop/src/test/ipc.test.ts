import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewProject } from '@bspace-sdlc-app/shared';
import * as ipc from '@/lib/ipc';

afterEach(() => clearMocks());

describe('ipc', () => {
  it('createProject sends input and brief', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return { id: 'p1' };
    });
    const input: NewProject = { title: 'Hi' };
    await ipc.createProject(input, 'brief text');
    expect(calls).toEqual([{ cmd: 'create_project', args: { input, brief: 'brief text' } }]);
  });

  it('recent chats ask Rust for a limit, or for all of them', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return [];
    });
    await ipc.listRecentChats(10);
    await ipc.listRecentChats();
    expect(calls).toEqual([
      { cmd: 'list_recent_chats', args: { limit: 10 } },
      { cmd: 'list_recent_chats', args: { limit: null } },
    ]);
  });

  it('project status and the project folder call the Rust commands with camelCase args', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.setProjectStatus('p1', 'building');
    await ipc.setProjectStatus('p1', 'draft', true);
    await ipc.openProjectFolder('p1');
    expect(calls).toEqual([
      { cmd: 'set_project_status', args: { projectId: 'p1', status: 'building', reset: false } },
      { cmd: 'set_project_status', args: { projectId: 'p1', status: 'draft', reset: true } },
      { cmd: 'open_project_folder', args: { projectId: 'p1' } },
    ]);
  });

  it('agentRespondPermission sends requestId and optionId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.agentRespondPermission('r1', null);
    expect(calls).toEqual([
      { cmd: 'agent_respond_permission', args: { requestId: 'r1', optionId: null } },
    ]);
  });

  it('getChat sends chatId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    expect(await ipc.getChat('c1')).toBeNull();
    expect(calls).toEqual([{ cmd: 'get_chat', args: { chatId: 'c1' } }]);
  });

  it('agentStop sends chatId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.agentStop('c1');
    expect(calls).toEqual([{ cmd: 'agent_stop', args: { chatId: 'c1' } }]);
  });
});
