# Scaffold a standalone project repo

For a self-contained Vue app that is **not** part of the Module Federation setup — a prototype,
demo, internal tool, microsite, or a UI-first app that renders screens and nothing else. No
shell to plug into, no remotes to load, no federation config at all.

Use this when the answer to "which shell owns this?" is *none*. If a shell owns it, it's
[scaffold-project.md](scaffold-project.md) (remote) or [scaffold-shell.md](scaffold-shell.md)
(host) instead — a standalone repo cannot later be dropped into a shell without rework, so
don't pick this to avoid the federation wiring.

## Identify: is this really standalone?

- No `federationConfig.ts`, no `remotes`, no `exposes`.
- Owns its own `createRouter` instance (unlike a remote, which exports a route factory).
- Nothing else imports it at runtime; nothing it imports comes from another repo at runtime.

If any of those is false, stop — it's a remote or a shell.

## Required inputs

Collect only missing information:

- App name and purpose (prototype / demo / internal tool).
- Whether a sibling standalone repo exists to copy — if the workspace has one, copy it rather
  than generating from a CLI template, same reasoning as the other two scaffolds.
- Whether it should use the BUMA design system (`@buma-dev/buma-ui-v2` + `@buma-dev/styles`) or
  stay dependency-free. Default: yes, use the design system — a UI-first app has no reason to
  diverge from the token set.

## Steps

1. **Start from a sibling standalone repo** if one exists. Otherwise scaffold with the
   workspace's current Vue tooling (`npm create vue@latest` or equivalent) — acceptable here,
   unlike shell/remote, because there is no federation/auth wiring to get subtly wrong.
2. **Strip what a standalone doesn't need** when copying: any `federationConfig.ts`, the
   bundler's module-federation plugin block and its `shared` deps, remote-path env vars,
   `@buma-dev/auth`, `@buma-dev/layout`. None of these apply without a shell.
3. **Dev port** — any free port; standalone repos aren't in the tribe's reserved federation
   block, so don't consume one. Avoid colliding with a shell/remote already running locally.
4. **Design system** — install `@buma-dev/buma-ui-v2` and `@buma-dev/styles`, then wire them
   yourself, because there is no shell to do it: the UI-kit plugin is installed in this app's
   own entry file, and the SCSS tokens go in this app's own bundler config. See
   [design-system.md](design-system.md) for both, and "Minimum required packages" below.
5. **Router** — a real `createRouter` instance in `src/router/index.ts`, owned by this app.
   This is the one place a standalone deliberately differs from a remote's exported factory.
   Keep route `name`s local and consistent; no shell merges them, so no cross-repo naming
   scheme applies.
6. **State and API — only if the screens actually need them.** A UI-first app usually needs
   neither: preview data lives as local `const` values inside the content component, per
   [output-contract.md](output-contract.md). Add a store or HTTP layer when a real requirement
   arrives, not as scaffolding.
7. Install fresh, start the dev server, and confirm a sliced screen renders with tokens applied
   (a raw-looking, unstyled screen usually means step 4's SCSS `additionalData` wiring is
   missing).

## Information architecture

Flatter than a remote's — no federation surface, no exposed contract, so folder moves are
always safe:

```
<repo>/
  vite.config.ts / equivalent    # NO module-federation plugin; SCSS additionalData for tokens
  package.json
  .env, .env.*                   # this app's own vars only — no remote-path superset
  src/
    main.ts                      # createApp + router + UI-kit plugin (no bootloader split
                                 # needed — that indirection exists for federation)
    App.vue
    router/
      index.ts                   # createRouter instance  ← owned here, unlike a remote
    views/<feature>/             # route pages
      components/                # page-specific sections
    components/                  # shared widgets
    assets/
```

Add `store/`, `core/constants/apis/`, or `composables/` only when a real need appears — see
step 6.

### Naming

- Directories: kebab-case.
- Vue component files: PascalCase.
- Route `name`s: any consistent local scheme; nothing merges them elsewhere.

## Minimum required packages

A standalone carries the design system itself, because no shell supplies it at runtime — the
opposite of a remote, which must **not** install it:

- `vue`, `vue-router` — the router is a real instance here.
- `@buma-dev/buma-ui-v2` — the component kit, installed as a plugin in `main.ts`.
- `@buma-dev/styles` — SCSS tokens, wired through the bundler's global SCSS `additionalData`.
- `@buma-dev/types` / `@buma-dev/utilities` — only if this app actually talks to a BUMA API.
  A UI-only app needs neither.
- A state library (`pinia`) — only per step 6.

Do **not** install `@buma-dev/auth` or `@buma-dev/layout` unless this app genuinely implements
its own sign-in and chrome; in the federation setup those are shell-owned, and pulling them
into a standalone app brings wiring that expects a shell context.

## How the packages are imported

Unlike a remote, this app installs the UI kit itself — in `main.ts`:

```ts
import '@buma-dev/buma-ui-v2/dist/style.css'
import bumaUiV2 from '@buma-dev/buma-ui-v2'

app.use(bumaUiV2)
```

After that, `.vue` files use the registered `B<Name>` global components directly with no
per-component import — same as every other repo type. SCSS tokens are wired once in the
bundler's sass loader `additionalData`:
`@import "@buma-dev/styles/src/assets/scss/main.scss";` — not imported per file. See
[design-system.md](design-system.md) for the token functions.

## NEVER

- Add a `federationConfig.ts`, a module-federation plugin block, or a `remotes`/`exposes` entry
  — that turns this into a half-configured shell/remote that works locally and fails wired up.
- Export a route factory instead of a router instance "in case it's federated later" — decide
  the repo type up front; a factory with no shell consuming it is dead indirection.
- Copy a shell's or remote's env superset of remote-path vars; a standalone consumes none of
  them.
- Install `@buma-dev/auth`/`@buma-dev/layout` by reflex from a sibling shell's `package.json`.
- Scaffold a store, API client, or composables layer before a screen actually needs one.
