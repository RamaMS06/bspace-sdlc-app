# Routing modes

How a newly sliced screen gets reachable. This is about adding **one route to an existing
repo** — creating a repo's routing layer from scratch is
[scaffold-shell.md](scaffold-shell.md) / [scaffold-project.md](scaffold-project.md) instead.

## Know which repo you're in first

The correct edit differs entirely by repo type, and the two look similar until you check the
federation config:

- **Remote/MFE** (`exposes` has a router entry, `remotes` points at a shell): the repo exports
  a route **factory**, not a router instance. A new screen is a new entry in this repo's own
  `router/module/<feature>.ts` (or whatever single style the repo already uses). The shell
  needs no change — it already imports this factory, so new routes appear automatically.
- **Shell/host** (`federationConfig.name` is the host literal, many `remotes`, empty
  `exposes`, owns `createRouter`): only shell-level chrome routes live here (landing/menu,
  auth, empty-state, catch-all). A **feature** screen does not belong in the shell — if the
  slice target is a feature page and you're in a shell repo, stop and confirm the target repo
  before editing routes.
- **Standalone** (no `federationConfig.ts` at all, owns its own `createRouter`, nothing imports
  it at runtime — see [scaffold-standalone.md](scaffold-standalone.md)): the new route is a
  plain entry in this app's own `router/index.ts` (or its route module, if it has one). Route
  `name`s are local — no shell merges them, so follow only this repo's own convention and don't
  apply a shell's `<domain>__<module>__<page>` scheme.

## `none`

Do not inspect or modify routing files. Deliver the screen component only.

## `suggest` (default)

Find the route declaration in the **same repo** as the sliced screen, then record into
`plan.md`'s Routing section:

- the exact route entry to add (path, `name`, lazy `component` import),
- the destination file path,
- where in that file it goes relative to existing entries.

Do not edit the route file. If more than one route file is plausible (e.g. both a
`module/<feature>.ts` and a flat `<Feature>Routes.ts` exist), ask which one instead of
guessing — picking wrong creates a duplicate registration that only fails at runtime.

## `auto`

Edit routing only when the user supplied the route file, or exactly one route registry is
identifiable. Then:

- Follow the repo's existing route-file style and route-`name` scheme exactly — in a remote,
  `name`s are merged into the shell's single route table, so an off-pattern or colliding name
  surfaces as a routing bug in the shell, not here.
- Keep the repo's existing lazy-import convention for `component`.
- Respect an existing base-route/prefix file rather than inlining the prefix into the path.
- Do not migrate route architecture, convert a factory to a router instance, add a router to a
  remote, reorder unrelated routes, or touch middleware/guards.

Before editing, check the same path/name/component isn't already registered. After editing,
verify exactly one registration exists and the dev server still boots. If safe insertion can't
be determined, fall back to `suggest` and say why.

## Under orchestration

**Under orchestration** (SKILL.md step 8's multi-frame case): a frame worker never edits the
shared route file itself, regardless of routing mode — it records its proposed route entry in
its own report instead. The orchestrator applies every proposed entry to the shared route file
one at a time, after every frame has finished resolving — see
[references/orchestration.md](orchestration.md). This avoids concurrent edits to the one file
every frame's routing shares. Single-frame (non-orchestrated) mode is unchanged.

## NEVER

- Create a `createRouter` instance in a remote — the shell owns navigation.
- Register a feature route in the shell's own router when it belongs to a remote's factory.
- Invent a route-`name` pattern for one screen.
- Add auth/menu middleware in a remote — those are shell-level and already applied.
