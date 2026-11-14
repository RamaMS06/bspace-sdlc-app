import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

const BRIDGE = path.resolve(import.meta.dirname, '../../../../src-tauri/bridges/codex-app-server.mjs');
const FAKE = path.resolve(import.meta.dirname, 'fake-app-server.mjs');

type Msg = { id?: number; method?: string; params?: Record<string, any>; result?: any; error?: { code: number; message: string } };

/** An ACP client for the bridge: requests, the updates it sends, and a hook that answers its questions. */
class Client {
  child: ChildProcessWithoutNullStreams;
  id = 1;
  pending = new Map<number, (m: Msg) => void>();
  updates: Record<string, any>[] = [];
  asked: Msg[] = [];
  answer: (m: Msg) => any = () => ({ outcome: { outcome: 'selected', optionId: 'allow' } });
  logFile: string;
  dir: string;

  constructor(env: Record<string, string> = {}) {
    this.dir = mkdtempSync(path.join(tmpdir(), 'bridge-'));
    this.logFile = path.join(this.dir, 'fake.log');
    this.child = spawn('node', [BRIDGE], {
      env: { ...process.env, BUMA_CODEX_CMD: JSON.stringify(['node', FAKE]), BUMA_NO_BROWSER: '1', FAKE_LOG: this.logFile, ...env },
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (l) => {
      const m = JSON.parse(l) as Msg;
      if (m.id !== undefined && m.method === undefined) return this.pending.get(m.id)?.(m);
      if (m.method === 'session/update') return void this.updates.push(m.params!.update);
      if (m.method && m.id !== undefined) {
        this.asked.push(m);
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: this.answer(m) })}\n`);
      }
    });
  }

  req(method: string, params: Record<string, unknown> = {}): Promise<Msg> {
    return new Promise((resolve) => {
      const id = this.id++;
      this.pending.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  fakeLog(): Record<string, any>[] {
    try {
      return readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  async session() {
    await this.req('initialize', { protocolVersion: 1 });
    const r = await this.req('session/new', { cwd: '/w', mcpServers: [] });
    return r.result.sessionId as string;
  }

  stop() {
    this.child.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

let client: Client | null = null;
const start = (env?: Record<string, string>) => (client = new Client(env));
afterEach(() => client?.stop());

const text = (t: string) => [{ type: 'text', text: t }];

describe('the Codex app-server bridge (ACP in, codex app-server out)', () => {
  it('offers a ChatGPT sign-in and lists the account\'s own models, never the hidden ones', async () => {
    const c = start();
    const init = await c.req('initialize', { protocolVersion: 1 });
    expect(init.result.protocolVersion).toBe(1);
    expect(init.result.authMethods.map((m: { id: string }) => m.id)).toEqual(['chatgpt']);
    const s = await c.req('session/new', { cwd: '/w', mcpServers: [] });
    expect(s.result.sessionId).toBe('t1');
    expect(s.result.models).toEqual({ currentModelId: 'm1', availableModels: [{ modelId: 'm1', name: 'M One', description: 'first' }] });
    // The thread starts in the project's folder, asking before it acts outside it.
    expect(c.fakeLog()[0]!.threadStart).toMatchObject({ cwd: '/w', approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  });

  it('signed out: session/new says authentication is required; authenticate signs in, then it works', async () => {
    const c = start({ FAKE_AUTH: 'none' });
    await c.req('initialize', { protocolVersion: 1 });
    const refused = await c.req('session/new', { cwd: '/w', mcpServers: [] });
    expect(refused.error?.code).toBe(-32000);
    const signed = await c.req('authenticate', { methodId: 'chatgpt' });
    expect(signed.error).toBeUndefined();
    expect((await c.req('session/new', { cwd: '/w', mcpServers: [] })).result.sessionId).toBe('t1');
  });

  it('a prompt streams the answer and the thinking, reports usage, and sends the picked model', async () => {
    const c = start();
    const sessionId = await c.session();
    await c.req('session/set_model', { sessionId, modelId: 'gpt-x' });
    const r = await c.req('session/prompt', { sessionId, prompt: text('hello') });
    expect(r.result.stopReason).toBe('end_turn');
    expect(r.result.usage).toEqual({ inputTokens: 10, outputTokens: 3, cachedReadTokens: 4, cachedWriteTokens: 0, totalTokens: 13 });
    const kinds = c.updates.map((u) => `${u.sessionUpdate}${u.content?.text ? `:${u.content.text}` : ''}`);
    expect(kinds).toEqual(['agent_thought_chunk:thinking', 'agent_message_chunk:Hi ', 'agent_message_chunk:there', 'usage_update']);
    expect(c.fakeLog().find((l) => l.turnStart)!.turnStart).toMatchObject({ model: 'gpt-x', input: [{ type: 'text', text: 'hello' }] });
  });

  it('commands and file edits show as tool calls, with how they ended', async () => {
    const c = start();
    const sessionId = await c.session();
    await c.req('session/prompt', { sessionId, prompt: text('tool') });
    const tools = c.updates.filter((u) => u.sessionUpdate.startsWith('tool_call'));
    expect(tools.map((u) => [u.sessionUpdate, u.toolCallId, u.status, u.kind])).toEqual([
      ['tool_call', 'c1', 'in_progress', 'execute'],
      ['tool_call_update', 'c1', 'completed', 'execute'],
      ['tool_call', 'f1', 'in_progress', 'edit'],
      ['tool_call_update', 'f1', 'failed', 'edit'],
    ]);
    expect(tools[0]!.title).toBe('Run ls -la');
    expect(tools[2]!.locations).toEqual([{ path: 'src/a.ts' }]);
  });

  it('an approval goes to the app as a permission request, and the answer goes back to Codex', async () => {
    const c = start();
    const sessionId = await c.session();
    c.answer = () => ({ outcome: { outcome: 'selected', optionId: 'reject' } });
    await c.req('session/prompt', { sessionId, prompt: text('approve') });
    expect(c.asked[0]!.method).toBe('session/request_permission');
    expect(c.asked[0]!.params!.toolCall).toMatchObject({ toolCallId: 'c2', kind: 'execute', rawInput: { command: 'rm -rf build' } });
    expect(c.asked[0]!.params!.options.map((o: { kind: string }) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    expect(c.fakeLog().find((l) => l.approval)!.approval).toEqual({ decision: 'decline' });
    // Allowed for the session is its own answer, and cancelling cancels.
    c.answer = () => ({ outcome: { outcome: 'selected', optionId: 'allow_session' } });
    await c.req('session/prompt', { sessionId, prompt: text('approve') });
    c.answer = () => ({ outcome: { outcome: 'cancelled' } });
    await c.req('session/prompt', { sessionId, prompt: text('approve') });
    expect(c.fakeLog().filter((l) => l.approval).map((l) => l.approval.decision)).toEqual(['decline', 'acceptForSession', 'cancel']);
  });

  it('a question from Codex is an elicitation form, and the picked answer goes back', async () => {
    const c = start();
    const sessionId = await c.session();
    c.answer = () => ({ action: 'accept', content: { stack: 'Flutter' } });
    await c.req('session/prompt', { sessionId, prompt: text('ask') });
    const q = c.asked[0]!;
    expect(q.method).toBe('elicitation/create');
    expect(q.params!.requestedSchema.properties.stack.oneOf).toEqual([{ const: 'Flutter', title: 'Flutter: mobile' }, { const: 'Vue', title: 'Vue' }]);
    expect(c.fakeLog().find((l) => l.answers)!.answers).toEqual({ answers: { stack: { answers: ['Flutter'] } } });
  });

  it('cancel interrupts the turn, which ends as cancelled', async () => {
    const c = start();
    const sessionId = await c.session();
    const turn = c.req('session/prompt', { sessionId, prompt: text('hang') });
    await new Promise((r) => setTimeout(r, 300));
    c.notify('session/cancel', { sessionId });
    const r = await turn;
    expect(r.result.stopReason).toBe('cancelled');
    expect(c.fakeLog().find((l) => l.interrupt)!.interrupt).toMatchObject({ threadId: 't1' });
  });

  it("a failed turn is an error with Codex's own words, and a second prompt while one runs is refused", async () => {
    const c = start();
    const sessionId = await c.session();
    const r = await c.req('session/prompt', { sessionId, prompt: text('fail') });
    expect(r.error?.message).toContain('The model requires a newer version');
    const first = c.req('session/prompt', { sessionId, prompt: text('hang') });
    await new Promise((x) => setTimeout(x, 200));
    const second = await c.req('session/prompt', { sessionId, prompt: text('hello') });
    expect(second.error?.message).toMatch(/still working/);
    c.notify('session/cancel', { sessionId });
    await first;
  });
});
