# Scaffold a new project (remote/MFE) repo

For creating a brand-new remote/micro-frontend repo that plugs into an **existing** shell
(e.g. an attendance module, a compliance module, a master-data module). Use for any new repo
that isn't itself a host — this is the common case; most new work is a new feature remote, not
a new shell.

If the sibling-repos workspace root isn't already established in this conversation, ask once.

## Identify: is this a remote?

A remote repo's federation config `exposes` has entries (a router factory at minimum, commonly
`./router.ts`) and its `remotes` points back at the owning shell. It has
**no** own top-level router instance — the shell owns navigation and just imports this repo's
exposed router factory.

## Required inputs

Collect only missing information:

- Feature name and the owning shell/tribe that will consume it.
- A unique federation module name for this repo (must not collide with any other remote in the
  workspace).
- A sibling remote repo to copy as the starting point.
- Whether the shell must also register a store module exposed from this repo.

## Steps

1. **Copy a sibling remote repo** in the same tribe, or the closest match by size/stack.
   Never scaffold a remote from an empty CLI template — the module-federation shims,
   lightweight bootstrap, and shared-deps config are easy to get subtly wrong from scratch.
2. **Rename** repo folder, `package.json` `name`, and the federation config's own `name` to a
   unique, tribe-prefixed identifier — this becomes the import specifier every consumer uses
   (`'<name>/router.ts'`), so collisions with any other remote in the workspace break Module
   Federation resolution silently at runtime, not at build time. Point `remotes` at the owning
   shell using whatever env var the workspace's other remotes already use for the shell's URL
   (don't invent a new one). Set `exposes` to just the router factory to start; add a store
   export only if the shell must register it; add view/component exposes only if another
   remote embeds them directly (uncommon).
3. **Dev port** — next free port inside the owning tribe's reserved block, per the workspace's
   existing convention (read sibling repos' `package.json`/env files for the current real
   allocation rather than assuming a fixed table). Set this repo's dev-server port and its
   public-path env var accordingly.
4. **Env vars** — add this repo's path var, pointing at the port from step 3, to **both** this
   repo's own env files **and** the owning shell's env files (and any other repos in the
   workspace that keep the shared superset of remote-path vars in sync — check a couple of
   siblings). Missing it on the shell side is the most common cause of "the remote won't load"
   in local dev.
5. **Build config** — copy the sibling's bundler/dev-server config as-is; only the public path
   and any extra transpile/shared-dependency entries specific to this feature (e.g. a charting
   library) should differ.
6. **App bootstrap** — remotes should be lean: mount with only what this feature actually
   needs (typically just its own state store). No router instance, no host-level auth/UI-kit
   wiring — the shell supplies those; don't duplicate them here.
7. **Router** — export a factory that returns routes given the shell's context (a common
   convention: `(staticTitle) => routes`), not a router instance. Match whichever route-file
   organization style the sibling uses and keep it consistent within this repo — don't mix
   styles.
8. **State** — use whatever the workspace's current preferred state pattern is for new work
   (check the most recently touched sibling remote rather than assuming); only export a store
   module if the shell needs to register it globally.
9. **API layer** — feature-specific endpoint constants only; reuse the workspace's shared HTTP
   client/service layer. Never hand-roll a new HTTP client inside a feature repo.
10. **Feature pages/components** — under this repo's own views/components folders, matching
    sibling conventions.
11. **Deploy assets** (Helm chart / CI pipeline) — copy from the sibling, rename chart/pipeline
    display names and image references.
12. **Wire into the shell** — a separate change in the shell repo, only once this repo builds
    and its remote entry is actually reachable:
    - Shell's federation config → add this remote's entry to `remotes`, using the env var from
      step 4.
    - Shell's remote-module registry → add the dynamic import of this repo's router factory
      and register it the way the shell's other remotes are registered.
    - Shell's store registry → only if step 8 exposed a store.
    - Shell's env files → the path var from step 4, if not already present.
13. Delete `node_modules`/lockfile from the copy, install fresh, start this repo's dev server;
    then start the shell's dev server and confirm this feature's routes appear under its menu.

## Information architecture

A remote owns its whole feature vertically — pages, state, API constants, types — and nothing
host-level. Confirm the sibling matches this shape before deviating:

```
<repo>/
  federationConfig.ts        # MF remote name, remotes.main → shell, exposes
  vue.config.js / equivalent bundler config  # MF plugin + shared-deps block, publicPath
  package.json
  .env, .env.*                # this repo's own path var + shared superset
  src/
    main.ts                   # import('./bootloader') only
    bootloader.ts              # createApp + local state only — no router/auth/UI-kit install
    App.vue
    router/
      index.ts                 # export default (staticTitle) => routes  ← the exposed factory
      module/<feature>.ts      # per-feature route groups (or one <Feature>Routes.ts —
                                # pick ONE style per repo, don't mix)
      base-route.ts            # optional route prefix
    store/
      <feature>.ts             # local feature store (async store pattern)
      index.ts                 # ONLY if the shell must register a store module
      types/<feature>.ts       # payload types
    core/
      constants/apis/<feature>.ts   # endpoint constants — never a new HTTP client
      types/                   # feature domain types
      enums/
      helpers/                 # app-only helpers
    views/<feature>/           # route pages
    components/                # shared widgets in this repo
    components/views/<feature>/ # page-specific sections
    assets/
    composables/               # optional
```

The exposed surface is only what `federationConfig.exposes` lists — everything else in `src/`
is private to this repo, so folder moves inside it are safe; renaming an exposed path is a
breaking change for the shell.

### Naming

- Directories: kebab-case (`hcm-core-master`, not `hcmCoreMaster` or `HcmCoreMaster`).
- Vue component files: PascalCase; if the module already uses `list.vue`/`main.vue`, match it
  rather than mixing conventions inside one module.
- Store and API constant files: kebab-case.
- Route `name`s: follow the owning shell's existing scheme — the shell merges these into one
  route table, so a colliding or off-pattern name shows up as a routing bug there, not here.
- English names; no abbreviations like `cmpnts`/`vws`.

## Minimum required packages

A remote is deliberately lean — it does **not** carry auth, layout, or the full UI kit; those
come from the host shell at runtime through Module Federation's shared scope. Installing them
in a remote anyway causes duplicate-instance bugs, not extra safety. Copy the sibling remote's
`package.json` as the baseline; the packages every remote in this pattern needs are:

- `@buma-dev/types` — shared response/domain types, so this repo's contracts match the shell's.
- `@buma-dev/utilities` — HTTP client and helpers this repo's own API layer builds on.
- `@buma-dev/styles` — SCSS design tokens for local styling (imported the same way the sibling
  imports it in its build config).
- `pinia` and/or `vuex` — only whichever the sibling actually uses for local state; don't add
  both unless the sibling genuinely has both.
- `vue-router` — for the exported route factory (not for a standalone router instance).
- Federation peer deps declared `shared` in the sibling's module-federation plugin config
  (typically `vue`, `axios`, plus whatever the sibling shares) — copy that `shared` block
  as-is, matching the shell's `eager`/`singleton`/`requiredVersion` settings exactly; a mismatch
  here is what causes two copies of Vue/Pinia to load at once.
- Feature-specific libraries (charting, file export, etc.) only if this feature actually needs
  them — never carried over from the sibling "just in case."

Do **not** install `@buma-dev/auth` or `@buma-dev/layout` in a remote — the shell supplies
those; a remote that imports them directly duplicates the shell's own instance.

## How the packages are imported

Deep/subpath imports, not one barrel export — copy the exact subpaths from the sibling remote
rather than guessing; they differ by package version. A remote's import surface is much
narrower than a shell's, because auth/layout come from the host at runtime:

```ts
// types — shared contracts with the shell and the API layer
import type { ResponseData } from '@buma-dev/types'

// utilities — HTTP client / async-store / helpers this repo's own API + store layer builds on
import services from '@buma-dev/utilities/services'
import helpers from '@buma-dev/utilities/helpers'

// design system: NO per-component import — the shell installs the UI-kit plugin, which
// registers B-prefixed components globally, so this repo's .vue files just use <BButton>
// directly in templates. See references/design-system.md.
```

SCSS tokens are wired once through the bundler's global SCSS config, not imported per file:
`@import "@buma-dev/styles/src/assets/scss/main.scss";` in the sass loader's `additionalData`.
Individual `.vue` files then use the tokens/mixins directly without their own `@import` —
see [design-system.md](design-system.md) for the token functions.

Imports **not** allowed in a remote:

```ts
import authRoutes from '@buma-dev/auth/router'     // ✗ shell-only
import auth from '@buma-dev/auth/middleware/auth'  // ✗ shell-only
import menu from '@buma-dev/layout/middleware/menu'// ✗ shell-only
```

The shell already installed and initialized these; importing them here creates a second
instance with its own state, which typically shows up as a user appearing logged out inside
the remote's pages while the shell still thinks they're signed in.

## NEVER

- A standalone router instance in a repo that only exposes a router factory — the shell owns
  navigation.
- A new hand-rolled HTTP client, local sign-in, or copied auth/layout boilerplate — reuse the
  workspace's shared packages for that.
- Reusing another remote's federation module name.
- Wiring the shell side before this repo actually builds and its remote entry is reachable —
  the shell's dynamic import just fails at runtime otherwise.
