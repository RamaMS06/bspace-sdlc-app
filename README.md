# BSpace SDLC

Desktop app (macOS & Windows) that brings the whole BUMA SDLC workflow into one place: stakeholder intake → brainstorm → Blueprint / FTSD → wireframe → Figma design → Flutter / Vue slice → run-verify → close. Each feature shows which skill and gate it is at, and the user's own AI agent (Claude Code, Codex, opencode, Gemini CLI or any ACP agent) does the work.

**Author:** p-rama.msugiyanto

> Status: early. The shell (agent over ACP, sign-in to an AI platform, usage meter, chat, workspace) is in place and themed with the BUMA Design System, with the Workflow screen following each feature through the SDLC. The short-video features of the base app (rendering, voice-over, styles, autopilot, scheduling and posting, paid plans) have been removed.

## Run it from source

```
pnpm install
pnpm dev:desktop
```

Requires Node 22+, pnpm 11 and Rust. Node 20 does not work: pnpm 11 won't start on it, and jsdom and undici in the tests need Node 22. If the terminal is on another Node (`node -v`), run `./dev.sh` instead of `pnpm dev:desktop`: it switches to the version in `.nvmrc` first (`./dev.sh --check` shows what it would use). To make every new terminal use it, run `nvm alias default 22` once. See [docs/development.md](docs/development.md) for the full setup and where data lives.

## Layout

```
bspace-sdlc-app/
├── apps/
│   └── desktop/        @bspace-sdlc-app/desktop  Tauri 2 + React 19 desktop app
├── packages/
│   ├── shared/         @bspace-sdlc-app/shared   Types and schemas shared by Rust and the UI
│   └── skills/         @bspace-sdlc-app/skills   Prompt builders and the bundled agent plugin
├── design-tokens/buma/ BUMA Design System colors exported from Figma (Light / Dark)
├── scripts/            tokens.mjs, version.mjs, usage-report.mjs
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm test` | `pnpm -r test` | Run tests in every workspace package |
| `pnpm typecheck` | `pnpm -r typecheck` | Type-check every workspace package |
| `pnpm dev:desktop` | `pnpm --filter @bspace-sdlc-app/desktop tauri dev` | Run the desktop app in dev mode |
| `pnpm tokens` | `node scripts/tokens.mjs` | Regenerate `buma-tokens.css` from `design-tokens/buma/*.tokens.json` |
| `pnpm tokens:check` | `node scripts/tokens.mjs --check` | Fail when the CSS is out of date with the JSON |

## Colors and theming

Colors come only from the BUMA Design System:

1. `design-tokens/buma/Light.tokens.json` and `Dark.tokens.json` are the Figma variable exports (65 semantic tokens: icon, text, background, stroke, shadow).
2. `scripts/tokens.mjs` turns them into `apps/desktop/src/styles/buma-tokens.css`: `--buma-*` variables, Light on `:root`, Dark on `.dark`. Generated; do not edit by hand.
3. `apps/desktop/src/styles/tokens.css` maps them onto the app's semantic names (`background`, `card`, `primary`, `primary-soft`, `text-2`, `error`, `success`, `warning`, `info`, …), which Tailwind exposes as classes (`bg-primary`, `text-text-2`, `border-hairline`). Components use only these names, never hex values.

The theme follows the system (light or dark) and can be forced with `setTheme()` in `apps/desktop/src/shared/lib/theme.ts`.

To update colors: replace the two JSON files with a new Figma export and run `pnpm tokens`.

## BUMA components

The desktop app is React, and the BUMA Design System web components are Vue, so they are ported:

1. `pnpm buma:pull button badge` runs buma-cli (`buma add`) against buma-registry and writes the Vue originals to `design-system/vue-source/`. They are the spec, never imported. `design-system/buma-components.json` records what was pulled.
2. The React port lives in `apps/desktop/src/shared/ui/buma/` with the same props and variants (`BumaButton`, `BumaButtonLink`, `BumaButtonGroup`, `BumaBadge`, `BumaChips`), colored with the BUMA tokens so it follows light and dark.
3. The app's `Button` (`primary` / `secondary`) renders the BUMA button.

`BUMA_CLI` and `BUMA_REGISTRY` point the script at another buma-cli or registry; by default it uses the sibling `../buma-cli` and `../buma-registry/dist` checkouts.

## How it works

- The agent runs over ACP (Agent Client Protocol, JSON-RPC over stdio). The app has no AI of its own: every generation goes through the agent you already use.
- Sign-in to Claude uses your Claude subscription through the Claude Code CLI (`claude auth login`), with a config folder separate from your own `~/.claude`. Other agents use their own CLI login. An OpenAI-compatible API key can be used instead.
- The usage meter (bottom left) shows the 5-hour and weekly Claude limits, read with the login Claude Code already stores and sent only to Anthropic.
- Commands your agent asks to run are shown to you and wait for your OK unless you turn on Auto mode.
- App data is stored in a local SQLite database on this computer.

## Credits

UI polished with unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
