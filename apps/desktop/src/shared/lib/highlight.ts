import type { HighlighterCore } from 'shiki/core';

/** File extension → the Shiki language that reads it. Anything else is shown as plain text. */
const LANGS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shellscript',
  bash: 'shellscript',
  toml: 'toml',
  rs: 'rust',
  py: 'python',
  xml: 'xml',
  dart: 'dart',
  vue: 'vue',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  sql: 'sql',
  diff: 'diff',
  patch: 'diff',
  go: 'go',
  java: 'java',
};

/** Names an agent writes after a code fence (```ts, ```bash…) that aren't a file extension. */
const FENCE: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  shell: 'shellscript',
  shellscript: 'shellscript',
  zsh: 'shellscript',
  console: 'shellscript',
  terminal: 'shellscript',
  jsonc: 'json',
  json5: 'json',
  markdown: 'markdown',
  python: 'python',
  rust: 'rust',
  kotlin: 'kotlin',
  golang: 'go',
  svg: 'xml',
};

/** The Shiki language for a code fence's language name, or null for plain text. */
export function languageOfFence(name: string | undefined): string | null {
  const n = (name ?? '').toLowerCase();
  return FENCE[n] ?? LANGS[n] ?? null;
}

export const THEME = 'github-dark-default';

/** The Shiki language for a file name, or null for plain text. */
export function languageFor(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return name.includes('.') ? (LANGS[ext] ?? null) : null;
}

let loading: Promise<HighlighterCore> | null = null;

/** One highlighter for the app, loaded the first time a file is shown (the JS regex engine: no wasm). */
function highlighter(): Promise<HighlighterCore> {
  loading ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('shiki/themes/github-dark-default.mjs'), import('shiki/themes/github-light-default.mjs')],
      langs: [
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/markdown.mjs'),
        import('shiki/langs/yaml.mjs'),
        import('shiki/langs/shellscript.mjs'),
        import('shiki/langs/toml.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/xml.mjs'),
        import('shiki/langs/dart.mjs'),
        import('shiki/langs/vue.mjs'),
        import('shiki/langs/kotlin.mjs'),
        import('shiki/langs/swift.mjs'),
        import('shiki/langs/sql.mjs'),
        import('shiki/langs/diff.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/java.mjs'),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Longest text that is coloured; longer files are shown plain (colouring them would stall the window). */
export const HIGHLIGHT_MAX = 200_000;

/**
 * Highlighted HTML for `code` as `<pre class="shiki"><code><span class="line">…`, or null when the
 * file is plain text, too long, or the highlighter can't load. Shiki escapes the text itself.
 */
export async function highlight(code: string, name: string): Promise<string | null> {
  const lang = languageFor(name);
  if (!lang || code.length > HIGHLIGHT_MAX) return null;
  try {
    return (await highlighter()).codeToHtml(code, { lang, theme: THEME });
  } catch {
    return null;
  }
}

/** Longest code block in a chat message that is coloured. */
export const CHAT_HIGHLIGHT_MAX = 50_000;

/**
 * A chat code block's lines as HTML, coloured for both themes: each token carries `--shiki-light` and
 * `--shiki-dark`, and the stylesheet picks one (see `.code-tokens` in tokens.css). Only the `<code>`
 * contents are returned, so the block keeps the app's own container. Null for unknown languages.
 */
export async function highlightFence(code: string, fence: string | undefined): Promise<string | null> {
  const lang = languageOfFence(fence);
  if (!lang || code.length > CHAT_HIGHLIGHT_MAX) return null;
  try {
    const html = (await highlighter()).codeToHtml(code, {
      lang,
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
      defaultColor: false,
    });
    const inner = /<code>([\s\S]*)<\/code>/.exec(html)?.[1];
    return inner ?? null;
  } catch {
    return null;
  }
}
