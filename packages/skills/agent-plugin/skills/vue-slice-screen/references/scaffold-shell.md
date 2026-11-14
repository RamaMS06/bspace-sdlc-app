# Scaffold a new Shell repo

For creating a brand-new `<...>.Shell` Module Federation host repo. Use only when a **new
tribe/domain** needs its own host (new top-level menu, own auth/base path). Adding a feature
to a domain that already has a shell → [scaffold-project.md](scaffold-project.md) instead.

The sibling-repos workspace root is wherever the developer's repos actually live; if it isn't
already established in this conversation, ask once. That root holds many independent git repos
side by side, not a single monorepo `apps/` folder — put files inside the new repo's own
folder, never at the workspace root.

## Identify: is this really a new shell?

A shell repo's `federationConfig.ts` has many `remotes` and empty `exposes` (or only
`./pinia`); it owns `createRouter` and a landing/menu page. Look for an existing sibling
`*.Shell` (or equivalent host) repo for this tribe in the workspace root first — if one
exists, stop, this is a `scaffold-project` job wired into it instead.

## Required inputs

Collect only missing information:

- Workspace root (where sibling repos live), if not already established.
- Tribe/domain name and its short federation prefix.
- A sibling shell repo to copy as the starting point (pick the closest match by size/stack).
- Confirmation no shell exists yet for this tribe.

## Steps

1. **Copy a sibling shell repo** as the starting point — never scaffold a host from an empty
   CLI template; the module-federation/auth/layout wiring is non-trivial and easy to get
   subtly wrong.
2. **Rename** repo folder, `package.json` `name`, and the federation config's own `name` to
   whatever literal name the workspace's other shells use for the host (commonly a fixed
   literal such as `'main'`, since remotes import it as `main@...`) — read the sibling and
   match it rather than inventing a new one. Clear `remotes` down to just this tribe's own
   remotes (start empty; wire real ones only once they exist). Update the app's own
   display-name/config constant and any build-time defines that hardcode the tribe.
3. **Dev port** — pick the next free port per the workspace's existing convention (many
   federation workspaces reserve one port block per tribe/domain — read the sibling repos'
   `package.json` `start` scripts / env files to find the real, current allocation; never
   assume a fixed table). Set the new repo's dev-server port to the next free one.
4. **Env vars** — copy `.env*` from the closest sibling shell (repos in this pattern typically
   share one superset of remote-path vars across every repo, even ones a given repo doesn't
   consume — don't prune what looks unused). Add this shell's own base-path/path vars pointing
   at the port from step 3. Reuse shared auth/base-URL/telemetry blocks unchanged.
5. **Router** — keep the sibling's route composition (redirects, auth routes, empty-state
   routes, `moduleRoutes()`/equivalent dynamic remote loader). Point the landing/menu route at
   this tribe's own menu component and title; keep the catch-all 404/redirect.
6. **Remote-module registry** (wherever the shell lists `import('<remote>/router.ts')` calls)
   — start empty or with only same-repo local modules. Add an entry per remote only as each
   project repo is actually wired in later (see scaffold-project step 13); don't pre-wire
   remotes that don't exist yet.
7. **Store registry** — keep the shell's own core modules (auth, site, menu, notifications,
   etc.); leave feature-remote modules out until wired.
8. **Landing/menu page** — copy a sibling's and swap its tiles for this tribe's own.
9. **Deploy assets** (Helm charts / CI pipeline / Dockerfile / nginx config / lint ignores) —
   copy from the sibling, rename chart/pipeline display names and any hardcoded image/tribe
   references. Touch the Dockerfile/nginx config only if this tribe needs a different base
   path.
10. Delete `node_modules`/lockfile from the copy, install fresh, confirm the dev server boots
    on the new port **before** wiring any remotes.

## Information architecture

A shell's `src/` is chrome and wiring, not features. Confirm the sibling matches this shape
before deviating — an unfamiliar layout may be an app-specific exception, not the norm:

```
<repo>/
  federationConfig.ts        # MF host name ('main'), remotes, empty exposes
  vue.config.js / equivalent bundler config  # MF plugin + shared-deps block
  package.json
  .env, .env.*                # remote-path vars, auth/base-URL, telemetry
  src/
    main.ts                   # import('./bootloader') only
    bootloader.ts              # createApp; installs pinia/vuex, auth, layout, UI kit
    App.vue
    router/
      index.ts                 # createRouter, beforeEach auth/menu middleware, catch-all
      modules/index.ts         # per-remote dynamic router imports + registration
      empty-state.ts           # optional
    store/
      index.ts                 # core Vuex modules (auth, site, menu, notifications) +
                                # per-remote store registration
    views/
      Menu.vue                 # tribe/domain landing page — the only "feature" view here
    core/
      enums/config.ts           # app display name / constants
    components/                # shell-only chrome (rare)
```

A remote's own feature code (`views/<feature>/`, `store/<feature>.ts`, API constants) never
lives here — see [scaffold-project.md](scaffold-project.md)'s tree for where that goes.

### Naming

- Directories: kebab-case.
- Vue component files: PascalCase — match the sibling's existing casing convention exactly if
  it's inconsistent app-to-app (don't introduce a third style).
- Route `name`s: follow the sibling's existing naming scheme (commonly
  `<domain>__<module>__<page>`); don't invent a new pattern for one shell.

## Minimum required packages

A shell is the only place that owns auth, layout chrome, and the design system UI kit — copying
these from the sibling's `package.json` is not optional, the app will not boot correctly
without them:

- `@buma-dev/auth` — Sign In, auth guard/middleware, profile/role store. Shells own auth; a
  remote never installs this itself.
- `@buma-dev/layout` — layout shell, menu middleware, empty-state routes, notifications.
- `@buma-dev/buma-ui` (and, if the sibling has it, `@buma-dev/buma-ui-v2`) — the design system
  component kit. Match whichever major version the sibling shells are actually on; don't mix
  v1/v2 patterns inside one app.
- `@buma-dev/types` — shared response/profile/router types.
- `@buma-dev/utilities` — HTTP client, SSO helpers, `AsyncStore`, router/module-federation
  helpers (`createRoutesModule`, `createStoreModule`). Required for wiring remotes in later.
- `@buma-dev/styles` — SCSS design tokens, imported once via the bundler's global SCSS
  `additionalData` (see the sibling's build config).
- Federation peer deps declared `shared` in the sibling's module-federation plugin config
  (typically `vue`, `vue-router`, `vuex`, `pinia`, `axios`, `@popperjs/core`) — copy that
  `shared` block as-is; mismatched `eager`/`singleton`/`requiredVersion` flags across
  shell/remotes cause hard-to-debug duplicate-instance bugs at runtime, not build errors.

Do not add a package "for later" — if the sibling shell doesn't have it, this new shell
shouldn't either until a real feature needs it.

## How the packages are imported

These are deep/subpath imports, not one barrel export — copy the exact subpaths from the
sibling shell's `bootloader.ts`/`router/index.ts`/`store/index.ts` rather than guessing, since
subpaths differ by package version (e.g. a `buma-ui` v1 vs v2 coexisting in one shell). Typical
shape, in `bootloader.ts`:

```ts
import '@buma-dev/auth/style'
import '@buma-dev/buma-ui/dist/css/buma-ui.css'      // once per major version installed

import bumaUi from '@buma-dev/buma-ui'                // Vue plugin: app.use(bumaUi)
import services from '@buma-dev/utilities/services'   // PubSub, EventBus, ...
import helpers from '@buma-dev/utilities/helpers'     // posthog, router.beforeEachHandler, ...
import providerEnums from '@buma-dev/utilities/provider/enums'
import providerEnv from '@buma-dev/utilities/provider/env'
```

in `router/index.ts`:

```ts
import authRoutes from '@buma-dev/auth/router'
import auth from '@buma-dev/auth/middleware/auth'
import redirectRoutes from '@buma-dev/layout/router/redirect'
import menu from '@buma-dev/layout/middleware/menu'
import helpers from '@buma-dev/utilities/helpers'      // beforeEachHandler
import { CLUSTER } from '@buma-dev/utilities/constants/meta'
```

in `store/index.ts`:

```ts
import auth from '@buma-dev/auth/store'
import site from '@buma-dev/auth/store/site'
import menu from '@buma-dev/layout/store/menu'
import emptyState from '@buma-dev/layout/store/empty-state'
import notification from '@buma-dev/layout/store/notification'
import { createStoreModule } from '@buma-dev/utilities/helpers/module-import'
```

and in the bundler's global SCSS config (not a JS import — a `sass`/`scss` loader
`additionalData` entry): `@import "@buma-dev/styles/src/assets/scss/main.scss";`.

Don't import from a package's root barrel when the sibling uses a subpath (e.g. `@buma-dev/
auth/store` vs `@buma-dev/auth`) — the subpath is what actually ships the tree-shaken piece
needed; importing differently can pull in code the shell doesn't need or miss a named export
that only the subpath re-exports.

For how UI-kit components are actually consumed (global `B<Name>` components, no per-component
import) and how to use the SCSS tokens instead of raw values, see
[design-system.md](design-system.md).

## NEVER

- A second router host for a tribe/domain that already has a shell — extend the existing one.
- Feature-specific pages or stores living directly in the shell.
- A federation host name that doesn't match the workspace's existing shell-naming convention.
- Skipping the port-block reservation — colliding dev ports break every other repo's local
  dev server, not just the new one.
