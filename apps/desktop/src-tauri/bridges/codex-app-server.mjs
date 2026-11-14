// BSpace SDLC: Codex through its own `codex app-server`, spoken to as an ACP agent.
//
// Codex's ACP adapter (@zed-industries/codex-acp) bundles an old Codex, so the models a ChatGPT account
// has today are refused ("requires a newer version of Codex"). `codex app-server` is Codex's own
// protocol and always matches the installed Codex. This script runs it and translates, so the app keeps
// one agent protocol: ACP on our stdin/stdout, the app-server's JSON-RPC on the child's.
//
//   ACP request            -> app-server
//   initialize             -> initialize + account/read
//   authenticate           -> account/login/start (ChatGPT sign-in in the browser)
//   session/new            -> thread/start + model/list
//   session/set_model      -> remembered; sent with the next turn
//   session/prompt         -> turn/start (answered when turn/completed arrives)
//   session/cancel         -> turn/interrupt
//
// Env: BUMA_CODEX_CMD is a JSON array that replaces the command that starts the app-server (tests, a
// pinned Codex); BUMA_NO_BROWSER=1 doesn't open the sign-in page (tests). CODEX_HOME (an account's folder)
// passes straight through.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const VERSION = '1';
const AUTH_REQUIRED = -32000;
const METHOD_NOT_FOUND = -32601;
const INTERNAL = -32603;

const appCommand = () => {
  try {
    const c = JSON.parse(process.env.BUMA_CODEX_CMD ?? 'null');
    if (Array.isArray(c) && c.length) return c;
  } catch {
    /* the default */
  }
  return ['npx', '-y', '@openai/codex@latest', 'app-server'];
};

const log = (...a) => process.stderr.write(`[codex-bridge] ${a.join(' ')}\n`);

// ---------------------------------------------------------------------------------------------------
// ACP side: JSON lines on stdin and stdout.
// ---------------------------------------------------------------------------------------------------
const toClient = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
let clientId = 1;
const clientPending = new Map();
const askClient = (method, params) =>
  new Promise((resolve, reject) => {
    const id = clientId++;
    clientPending.set(id, { resolve, reject });
    toClient({ id, method, params });
  });
const respond = (id, result) => toClient({ id, result });
const fail = (id, code, message) => toClient({ id, error: { code, message } });
const update = (u) => toClient({ method: 'session/update', params: { sessionId: state.threadId ?? '', update: u } });

// ---------------------------------------------------------------------------------------------------
// App-server side.
// ---------------------------------------------------------------------------------------------------
class AppServer {
  constructor() {
    this.id = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.requestHandler = async () => {
      throw Object.assign(new Error('Method not found'), { code: METHOD_NOT_FOUND });
    };
    this.stderrTail = [];
    this.closed = false;
  }

  start() {
    const [cmd, ...args] = appCommand();
    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: process.env });
    this.child.on('error', (e) => this.close(`Could not start Codex (${cmd}): ${e.message}`));
    this.child.on('exit', (code) => this.close(this.tail() || `Codex stopped (exit ${code})`));
    this.child.stderr.on('data', (d) => {
      for (const line of String(d).split('\n')) {
        // Codex logs its warnings to stderr; keep the last few lines for when it dies.
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (clean) this.stderrTail.push(clean);
      }
      this.stderrTail = this.stderrTail.slice(-8);
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (l) => this.line(l));
  }

  tail() {
    return this.stderrTail.filter((l) => /error|fail|denied|invalid/i.test(l)).slice(-3).join(' | ');
  }

  close(why) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error(why));
    this.pending.clear();
    this.onClosed?.(why);
  }

  write(msg) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Codex is not running'));
      const id = this.id++;
      this.pending.set(id, { resolve, reject, method });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  on(method, fn) {
    this.handlers.set(method, fn);
  }

  line(l) {
    let m;
    try {
      m = JSON.parse(l);
    } catch {
      return;
    }
    if (m.id !== undefined && m.method === undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error.message ?? `${p.method} failed`), { code: m.error.code }));
      else p.resolve(m.result);
      return;
    }
    if (m.method && m.id !== undefined) {
      // A request from Codex (an approval, a question): answered when the handler is done.
      Promise.resolve()
        .then(() => this.requestHandler(m.method, m.params ?? {}))
        .then((result) => this.write({ jsonrpc: '2.0', id: m.id, result }))
        .catch((e) => this.write({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? INTERNAL, message: e.message } }));
      return;
    }
    if (m.method) this.handlers.get(m.method)?.(m.params ?? {});
  }
}

const app = new AppServer();

const state = {
  started: false,
  account: null,
  requiresAuth: false,
  threadId: null,
  cwd: null,
  model: null,
  defaultModel: null,
  turn: null, // { id, resolve, reject, cancelled, usage, message }
  login: null, // { resolve, reject }
};

async function ensureStarted() {
  if (state.started) return;
  app.start();
  app.onClosed = (why) => {
    log('app-server closed:', why);
    state.turn?.reject(new Error(why));
    state.login?.reject(new Error(why));
    // Nothing left to talk to: end, so the app sees the agent stop (with the reason in stderr).
    setTimeout(() => process.exit(1), 50);
  };
  await app.request('initialize', {
    clientInfo: { name: 'bspace-sdlc-app', title: 'BSpace SDLC', version: VERSION },
    capabilities: { experimentalApi: true },
  });
  app.notify('initialized', {});
  state.started = true;
  await readAccount();
}

async function readAccount() {
  const r = await app.request('account/read', { refreshToken: false });
  state.account = r?.account ?? null;
  state.requiresAuth = !!r?.requiresOpenaiAuth;
}

async function listModels() {
  const out = [];
  let cursor = null;
  do {
    const r = await app.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    for (const m of r?.data ?? []) if (!m.hidden) out.push(m);
    cursor = r?.nextCursor ?? null;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Opening the sign-in page.
// ---------------------------------------------------------------------------------------------------
function openBrowser(url) {
  if (process.env.BUMA_NO_BROWSER) return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* the URL is also written to stderr below */
  }
}

// ---------------------------------------------------------------------------------------------------
// Translating what Codex does into ACP updates.
// ---------------------------------------------------------------------------------------------------
const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function toolFromItem(item) {
  switch (item.type) {
    case 'commandExecution':
      return { title: `Run ${clip(String(item.command ?? '').replace(/\s+/g, ' '))}`.trim(), kind: 'execute', rawInput: { command: item.command } };
    case 'fileChange': {
      const first = Array.isArray(item.changes) ? item.changes[0] : null;
      const path = first?.path;
      return { title: path ? `Edit ${path}` : 'Edit files', kind: 'edit', ...(path ? { locations: [{ path }] } : {}) };
    }
    case 'mcpToolCall':
      return { title: `${item.server ?? 'tool'}: ${item.tool ?? ''}`.trim(), kind: 'other' };
    case 'webSearch':
      return { title: `Search: ${clip(String(item.query ?? ''))}`, kind: 'fetch' };
    case 'imageView':
      return { title: `View ${item.path ?? 'image'}`, kind: 'read' };
    case 'dynamicToolCall':
      return { title: String(item.tool ?? 'tool'), kind: 'other' };
    default:
      return null;
  }
}

function endStatus(item) {
  if (item.type === 'commandExecution') {
    if (item.status === 'completed') return item.exitCode && item.exitCode !== 0 ? 'failed' : 'completed';
    return 'failed';
  }
  return item.status === 'completed' || item.status === 'success' ? 'completed' : 'failed';
}

app.on('item/agentMessage/delta', (p) => {
  if (p.delta) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: p.delta } });
});
app.on('item/reasoning/summaryTextDelta', (p) => {
  if (p.delta) update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: p.delta } });
});
app.on('item/started', (p) => {
  const tool = toolFromItem(p.item ?? {});
  if (tool) update({ sessionUpdate: 'tool_call', toolCallId: p.item.id, status: 'in_progress', ...tool });
});
app.on('item/completed', (p) => {
  const item = p.item ?? {};
  const tool = toolFromItem(item);
  if (tool) update({ sessionUpdate: 'tool_call_update', toolCallId: item.id, status: endStatus(item), title: tool.title, kind: tool.kind });
});
app.on('thread/tokenUsage/updated', (p) => {
  const t = p.tokenUsage;
  if (!t) return;
  if (state.turn) state.turn.usage = t.last ?? null;
  update({ sessionUpdate: 'usage_update', used: t.total?.totalTokens ?? 0, size: t.modelContextWindow ?? 0 });
});
app.on('error', (p) => {
  // A failure Codex will not retry: the message for the turn that ends with it.
  if (state.turn && !p.willRetry) state.turn.message = p.error?.message ?? 'Codex reported an error';
});
app.on('account/login/completed', (p) => {
  const l = state.login;
  if (!l) return;
  state.login = null;
  if (p.success) l.resolve();
  else l.reject(new Error(p.error || 'The sign-in did not finish'));
});
app.on('turn/completed', (p) => {
  const t = state.turn;
  if (!t || (p.turn?.id && t.id && p.turn.id !== t.id)) return;
  state.turn = null;
  const status = p.turn?.status;
  if (status === 'interrupted') return t.resolve({ stopReason: 'cancelled', usage: usageOf(t.usage) });
  if (status === 'failed') {
    const e = p.turn?.error;
    return t.reject(new Error([e?.message ?? t.message ?? 'The turn failed', e?.additionalDetails].filter(Boolean).join(' ')));
  }
  t.resolve({ stopReason: 'end_turn', usage: usageOf(t.usage) });
});

const usageOf = (u) =>
  u
    ? {
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        cachedReadTokens: u.cachedInputTokens ?? 0,
        cachedWriteTokens: u.cacheWriteInputTokens ?? 0,
        totalTokens: u.totalTokens ?? 0,
      }
    : undefined;

// ---------------------------------------------------------------------------------------------------
// Requests from Codex that need the user: approvals and questions.
// ---------------------------------------------------------------------------------------------------
const OPTIONS = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow_session', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'reject', name: 'Decline', kind: 'reject_once' },
];

async function ask(toolCall) {
  const r = await askClient('session/request_permission', { sessionId: state.threadId ?? '', toolCall, options: OPTIONS });
  const out = r?.outcome;
  if (out?.outcome === 'selected') return out.optionId;
  return 'cancelled';
}

const decision = (id) => (id === 'allow' ? 'accept' : id === 'allow_session' ? 'acceptForSession' : id === 'reject' ? 'decline' : 'cancel');

app.requestHandler = async (method, p) => {
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const id = await ask({
        toolCallId: p.itemId,
        title: p.reason ? `Run ${clip(String(p.command ?? ''))} (${p.reason})` : `Run ${clip(String(p.command ?? 'a command'))}`,
        kind: 'execute',
        status: 'pending',
        rawInput: { command: p.command },
      });
      return { decision: decision(id) };
    }
    case 'item/fileChange/requestApproval': {
      const id = await ask({ toolCallId: p.itemId, title: p.reason ? `Edit files (${p.reason})` : 'Edit files', kind: 'edit', status: 'pending' });
      return { decision: decision(id) };
    }
    case 'item/permissions/requestApproval': {
      const id = await ask({ toolCallId: p.itemId, title: p.reason ?? 'The agent asks for more access', kind: 'other', status: 'pending' });
      return id === 'allow' || id === 'allow_session' ? { permissions: p.permissions ?? {}, scope: id === 'allow_session' ? 'session' : 'turn' } : { permissions: {}, scope: 'turn' };
    }
    case 'item/tool/requestUserInput': {
      const questions = Array.isArray(p.questions) ? p.questions : [];
      const properties = {};
      for (const q of questions) {
        const options = Array.isArray(q.options) ? q.options : [];
        properties[q.id] = {
          type: 'string',
          title: q.header || q.question,
          description: q.question,
          ...(options.length ? { oneOf: options.map((o) => ({ const: o.label, title: o.description ? `${o.label}: ${o.description}` : o.label })) } : {}),
        };
      }
      const r = await askClient('elicitation/create', {
        mode: 'form',
        message: questions[0]?.question ?? 'The agent has a question',
        requestedSchema: { type: 'object', properties, required: questions.map((q) => q.id) },
      });
      if (r?.action !== 'accept') return { answers: {} };
      const answers = {};
      for (const q of questions) {
        const v = r.content?.[q.id];
        if (v !== undefined && v !== null && v !== '') answers[q.id] = { answers: [String(v)] };
      }
      return { answers };
    }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null };
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: METHOD_NOT_FOUND });
  }
};

// ---------------------------------------------------------------------------------------------------
// ACP requests from the app.
// ---------------------------------------------------------------------------------------------------
const imageInput = (b) => ({ type: 'image', url: b.data ? `data:${b.mimeType ?? 'image/png'};base64,${b.data}` : String(b.uri ?? '') });

function toInput(blocks) {
  const out = [];
  for (const b of blocks ?? []) {
    if (b.type === 'text') out.push({ type: 'text', text: b.text ?? '', text_elements: [] });
    else if (b.type === 'image') out.push(imageInput(b));
    else if (b.type === 'resource_link') out.push({ type: 'text', text: `@${b.uri ?? b.name ?? ''}`, text_elements: [] });
  }
  return out;
}

const handlers = {
  async initialize() {
    await ensureStarted();
    return {
      protocolVersion: 1,
      agentInfo: { name: 'codex-app-server', title: 'Codex', version: VERSION },
      agentCapabilities: { promptCapabilities: { image: true } },
      authMethods: [{ id: 'chatgpt', name: 'Sign in with ChatGPT', description: 'Sign in with your ChatGPT account in the browser' }],
    };
  },

  async authenticate(p) {
    await ensureStarted();
    if (p?.methodId && p.methodId !== 'chatgpt') throw Object.assign(new Error(`No sign-in method ${p.methodId}`), { code: -32602 });
    const r = await app.request('account/login/start', { type: 'chatgpt' });
    if (!r?.authUrl) throw new Error('Codex gave no sign-in page');
    // Waits for the browser; the page is also in stderr in case no browser opened.
    const done = new Promise((resolve, reject) => {
      state.login = { resolve, reject };
    });
    log('sign in at', r.authUrl);
    openBrowser(r.authUrl);
    const timer = setTimeout(() => state.login?.reject(new Error('Signing in took too long')), 10 * 60_000);
    try {
      await done;
    } finally {
      clearTimeout(timer);
      state.login = null;
    }
    await readAccount();
    return {};
  },

  async 'session/new'(p) {
    await ensureStarted();
    if (state.requiresAuth && !state.account) throw Object.assign(new Error('Authentication required'), { code: AUTH_REQUIRED });
    state.cwd = p?.cwd ?? process.cwd();
    const [t, models] = await Promise.all([
      app.request('thread/start', { cwd: state.cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write' }),
      listModels().catch(() => []),
    ]);
    state.threadId = t.thread.id;
    state.defaultModel = t.model ?? models.find((m) => m.isDefault)?.model ?? null;
    state.model = state.defaultModel;
    return {
      sessionId: state.threadId,
      models: {
        currentModelId: state.model,
        availableModels: models.map((m) => ({ modelId: m.model ?? m.id, name: m.displayName ?? m.model ?? m.id, description: m.description ?? undefined })),
      },
    };
  },

  async 'session/set_model'(p) {
    if (p?.modelId) state.model = p.modelId;
    return {};
  },

  async 'session/set_config_option'(p) {
    if (p?.configId === 'model' && p.value) state.model = p.value;
    return {};
  },

  async 'session/set_mode'() {
    return {};
  },

  async 'session/prompt'(p) {
    if (state.turn) throw Object.assign(new Error('The agent is still working on the last message'), { code: INTERNAL });
    const turn = { id: null, usage: null, message: null, cancelled: false };
    const done = new Promise((resolve, reject) => {
      turn.resolve = resolve;
      turn.reject = reject;
    });
    state.turn = turn;
    try {
      const r = await app.request('turn/start', {
        threadId: state.threadId,
        input: toInput(p?.prompt),
        ...(state.model ? { model: state.model } : {}),
        ...(state.cwd ? { cwd: state.cwd } : {}),
      });
      turn.id = r?.turn?.id ?? null;
      // Stop was pressed before the turn had an id.
      if (turn.cancelled && turn.id) app.request('turn/interrupt', { threadId: state.threadId, turnId: turn.id }).catch(() => {});
    } catch (e) {
      state.turn = null;
      throw e;
    }
    return done;
  },
};

const notifications = {
  'session/cancel'() {
    const t = state.turn;
    if (!t) return;
    t.cancelled = true;
    if (t.id) app.request('turn/interrupt', { threadId: state.threadId, turnId: t.id }).catch(() => {});
  },
};

readline.createInterface({ input: process.stdin }).on('line', (l) => {
  let m;
  try {
    m = JSON.parse(l);
  } catch {
    return;
  }
  // A reply to something we asked the app (a permission, a question).
  if (m.id !== undefined && m.method === undefined) {
    const p = clientPending.get(m.id);
    if (!p) return;
    clientPending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message ?? 'The app refused'));
    else p.resolve(m.result);
    return;
  }
  if (m.method && m.id !== undefined) {
    const h = handlers[m.method];
    if (!h) return fail(m.id, METHOD_NOT_FOUND, `Method not found: ${m.method}`);
    h(m.params ?? {}).then(
      (r) => respond(m.id, r ?? {}),
      (e) => fail(m.id, e.code ?? INTERNAL, e.message ?? String(e)),
    );
    return;
  }
  if (m.method) notifications[m.method]?.(m.params ?? {});
});

process.stdin.on('end', () => {
  app.child?.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  app.child?.kill();
  process.exit(0);
});
