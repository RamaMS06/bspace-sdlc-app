// A stand-in for `codex app-server` for the bridge tests: it answers the few requests the bridge makes and
// plays scripted turns, keyed by the words of the prompt. What it was asked is appended to FAKE_LOG.
import fs from 'node:fs';
import readline from 'node:readline';

const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(o)}\n`);
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
let signedIn = process.env.FAKE_AUTH !== 'none';
let nextServerId = 1000;
const waiting = new Map();
let turnId = null;
const note = (method, params) => send({ method, params });
const ask = (method, params) => new Promise((res) => { const id = nextServerId++; waiting.set(id, res); send({ id, method, params }); });
const done = (status, extra = {}) => note('turn/completed', { threadId: 't1', turn: { id: turnId, status, error: null, items: [], ...extra } });

async function play(text) {
  const item = (o) => ({ id: 'i1', ...o });
  if (text.includes('hello')) {
    note('item/reasoning/summaryTextDelta', { delta: 'thinking' });
    note('item/started', { item: item({ type: 'agentMessage', text: '' }) });
    note('item/agentMessage/delta', { itemId: 'i1', delta: 'Hi ' });
    note('item/agentMessage/delta', { itemId: 'i1', delta: 'there' });
    note('thread/tokenUsage/updated', { threadId: 't1', tokenUsage: { last: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 4, totalTokens: 13 }, total: { totalTokens: 13 }, modelContextWindow: 1000 } });
    done('completed');
  } else if (text.includes('tool')) {
    note('item/started', { item: item({ type: 'commandExecution', id: 'c1', command: 'ls -la', status: 'inProgress' }) });
    note('item/completed', { item: item({ type: 'commandExecution', id: 'c1', command: 'ls -la', status: 'completed', exitCode: 0 }) });
    note('item/started', { item: item({ type: 'fileChange', id: 'f1', changes: [{ path: 'src/a.ts' }], status: 'inProgress' }) });
    note('item/completed', { item: item({ type: 'fileChange', id: 'f1', changes: [{ path: 'src/a.ts' }], status: 'failed' }) });
    done('completed');
  } else if (text.includes('approve')) {
    const r = await ask('item/commandExecution/requestApproval', { itemId: 'c2', command: 'rm -rf build', reason: 'outside the workspace' });
    log({ approval: r });
    done('completed');
  } else if (text.includes('ask')) {
    const r = await ask('item/tool/requestUserInput', { isBlocking: true, itemId: 'q1', questions: [{ id: 'stack', header: 'Stack', question: 'Which stack?', options: [{ label: 'Flutter', description: 'mobile' }, { label: 'Vue' }] }] });
    log({ answers: r });
    done('completed');
  } else if (text.includes('fail')) {
    note('error', { threadId: 't1', turnId, error: { message: 'rate limited' }, willRetry: false });
    done('failed', { error: { message: 'The model requires a newer version', additionalDetails: null } });
  }
  // 'hang': nothing until turn/interrupt.
}

readline.createInterface({ input: process.stdin }).on('line', async (l) => {
  const m = JSON.parse(l);
  if (m.id !== undefined && m.method === undefined) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; }
  if (m.method === 'initialized') return;
  const reply = (result) => send({ id: m.id, result });
  switch (m.method) {
    case 'initialize': return reply({ userAgent: 'fake/0.0.0', codexHome: '/x' });
    case 'account/read': return reply({ account: signedIn ? { type: 'chatgpt', email: 'a@b.c', planType: 'team' } : null, requiresOpenaiAuth: true });
    case 'account/login/start':
      reply({ type: 'chatgpt', authUrl: 'http://login.example/x', loginId: 'l1' });
      return setTimeout(() => { signedIn = true; note('account/login/completed', { success: true, loginId: 'l1' }); }, 30);
    case 'model/list':
      return reply({ data: [{ id: 'm1', model: 'm1', displayName: 'M One', description: 'first', hidden: false, isDefault: true }, { id: 'h', model: 'h', displayName: 'Hidden', hidden: true }], nextCursor: null });
    case 'thread/start': log({ threadStart: m.params }); return reply({ thread: { id: 't1' }, model: 'm1' });
    case 'turn/start': {
      turnId = `u${Date.now()}`;
      const text = m.params.input.map((i) => i.text ?? '').join(' ');
      log({ turnStart: { model: m.params.model, input: m.params.input } });
      reply({ turn: { id: turnId, status: 'inProgress' } });
      return setTimeout(() => play(text), 10);
    }
    case 'turn/interrupt': log({ interrupt: m.params }); reply({}); return setTimeout(() => done('interrupted'), 10);
    default: return send({ id: m.id, error: { code: -32601, message: `no ${m.method}` } });
  }
});
