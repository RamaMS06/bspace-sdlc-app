# Multi-frame orchestration

Entered from [SKILL.md](../SKILL.md) step 8 when the supplied Figma node resolves to a
`PAGE`/`CANVAS`/`SECTION` containing more than one independent-screen `FRAME`. This session
becomes the **orchestrator**, following the generic `subagent-driven-development` skill
(`skills/subagent-driven-development/SKILL.md` — task files before dispatch, fresh context per worker,
file-based reports, external verification, human gates relayed to the developer, never
self-answered): it does not slice any screen itself — it sets up per-frame work, dispatches
one subagent ("frame worker") per frame to run the normal single-frame workflow, and resolves
the one place where frames would otherwise collide on a shared file (the route registry). This
file covers only the vue-slice-screen-specific mapping (what a task is, which steps a worker
runs, which files are shared); the dispatch/report/verify mechanics come from the SDD skill. Heavy
Figma MCP calls follow the shared policy in [figma-heavy-calls.md](figma-heavy-calls.md), plus the
batch-wide semaphore below.

Everything a single frame worker does — inventory (step 9), per-section resolution (steps
11–13), coverage check (step 14), confirmation (step 15), file generation (step 16),
verification (step 19), and so on — is **unchanged**. This file only covers what wraps around that: detection and
setup, parallel dispatch, the one shared-file collision point (route registry), the
consolidated confirmation, within-frame section splitting for context isolation, and cleanup.

## Why parallel dispatch is safe here

The `subagent-driven-development` skill (the pattern this design follows) never dispatches multiple
implementation subagents in parallel, because they'd conflict editing the same files. Frames are
the deliberate exception: each frame writes to its own `specs/<ID>-<screen-name>/` folder and its
own screen-local `.vue` files, entirely disjoint from every other frame's output. The only file
frames *would* collide on — the shared route registry — is handled below specifically so no
frame worker touches it directly. Vue's workflow has no environment/package-harness step
(unlike Flutter's `pubspec.yaml`/`main.dart` bootstrap), so there is no second collision point
to batch here.

Within a single frame, splitting a section to a sub-worker (last section below) is **not** this
exception: it targets that frame's own single `plan.md`, so it stays serialized, exactly as SDD's
rule intends.

## 1. Detection & setup (before any dispatch)

1. From the multi-frame `get_metadata` result, enumerate the candidate frames. For each, infer a
   screen name from its Figma frame name; ask the developer only if a name is unclear or two
   frames would infer the same name.
2. Collect the inputs [SKILL.md](../SKILL.md)'s "Required inputs" section normally asks per
   screen (target feature directory, routing mode) — once, covering all frames, unless a
   specific frame needs its own override.
3. Confirm which repo each frame targets (shell / remote / standalone) per step 1's "Identify"
   check —
   once, here, for the whole batch, the same way step 1 would for a single frame.
4. Create an ephemeral batch workspace **outside the target repo** (e.g. under the harness's own
   scratch/temp directory, not `<repo-root>/...`) at `<batch-workspace-root>/<batch-id>/`
   (`<batch-id>` e.g. a short slug of the source Figma page name). Keeping it outside the repo
   means no `.gitignore` edit is needed — the workspace is deleted at the end of the batch (see
   Cleanup) and was never inside the repo to begin with.
   - `progress.md` — one row per frame: Figma frame id, screen name, target feature dir, status
     (`pending` → `resolving` → `awaiting-confirmation` → `generating` → `done`/`gated`), plus its
     complexity class and heavy-call circuit-breaker state (`ok` / `open`) per
     [figma-heavy-calls.md](figma-heavy-calls.md).
   - `reports/<frame-id>.md` — one file per frame, written by that frame's worker at its own
     step 15 (see "Consolidated confirmation").
   - `briefs/<frame-id>.md` — one file per frame, written now, before any dispatch: Figma frame
     URL/id, screen name, target feature directory, routing mode, **and its pre-allocated
     `specs/<ID>-<screen-name>/` path** — the orchestrator allocates every frame's spec ID here,
     sequentially, before dispatch, so parallel workers never race on the same next-ID lookup
     (each worker's own step 10 then reuses this pre-allocated ID instead of computing one).
     This is the task definition that must exist before a worker starts, same discipline
     `plan.md`/`spec.md` already apply per-frame, just one level up.

## 2. Dispatch

Frame workers may run inventory and other non-heavy preparation in parallel. The orchestrator owns
one batch-wide semaphore for heavy Figma calls: at most one `get_design_context`, `get_screenshot`,
or `send_code_connect_mappings` call is in flight across all workers. A worker acquires it for
one call, releases it on success or failure, and records the attempt in its report. Cheap
`get_metadata` and `get_code_connect_map` calls remain bounded discovery calls, not a license for
unlimited fan-out. A worker never bypasses the semaphore after a timeout.

Spawn one subagent per frame (via the Agent tool), in parallel, each given its `briefs/<frame-id>.md`
and instructed to run [SKILL.md](../SKILL.md) steps 1–21 for that frame only, stopping at its own
step 15 instead of asking the developer directly (next section). Tell each worker explicitly why
running in parallel is safe: it owns a disjoint `specs/<ID>-<screen-name>/` folder — the one
pre-allocated in its brief, which it must use rather than computing its own next ID — and
disjoint `.vue` files, so nothing it writes can collide with another frame's worker.

**Route registry:** a frame worker never edits the shared route file itself, regardless of
routing mode (`suggest` or `auto`) — see [references/routing.md](routing.md)'s orchestration
note. It records its proposed route entry (path, `name`, lazy `component` import, destination
file, insertion point) in its own report instead. The orchestrator is the sole writer of the
shared route file, applying every proposed entry one at a time after workers finish resolving —
this is the one point of real write contention across frames, resolved by having a single writer
rather than by locking.

## 3. Consolidated confirmation

Each frame worker completes its own steps 9–14 (inventory, per-section resolution, coverage
check) unchanged, then at its own step 15 — instead of asking the developer — writes its
confirmation summary to `<batch-workspace-root>/<batch-id>/reports/<frame-id>.md`: every `CM-XX`
row that defaulted to a screen-local component, named exactly as step 15 already requires, plus
its `plan.md` summary (states, components, assets, routing). It marks itself
`awaiting-confirmation` in `progress.md` and stops.

Once every frame reaches `awaiting-confirmation` (or `done`, for a frame with nothing to gate),
the orchestrator presents **one** developer confirmation covering every frame together — one
section per frame, same content a lone worker would show individually at step 15 — asked via
`AskUserQuestion` when available. This is the batched-gate behavior: one interrupt for the whole
batch, not one per frame and not one per component. Per SKILL.md step 15's hard-gate rule, the
developer's verbatim answer is recorded into **each** frame's `plan.md` under its "Plan reviewed"
checklist item before any worker resumes — the orchestrator relays the gate, it never answers it.

- If the developer requests changes to a specific frame's plan, resume only that frame's worker
  to revise `plan.md` and re-report; other frames are unaffected and proceed.
- After confirmation, resume every worker to run its own steps 16–19 (file generation through
  verification) unchanged.

## 4. Within-frame section splitting (context isolation, stays serialized)

During a frame worker's own step 11 per-section loop, a section may be complex enough that
resolving it inline risks the same context-bloat-driven dropped-node failure the recursive
`get_metadata` rule in SKILL.md step 9 already guards against structurally. Guideline thresholds
for splitting a section to its own sub-worker rather than resolving it inline:

- Its scoped `get_metadata` re-call (per step 9's existing recursion rule) returns more than
  ~25 descendant nodes, **or**
- Resolving it needs `get_design_context` on more than ~5 distinct component instances (multiple
  Code Connect resolutions in one section).

These are guidelines, not hard gates — a frame worker may also split a smaller section that is
otherwise unusually tangled, or skip splitting a section just above the threshold if it's mostly
repeated/trivial nodes.

A `medium`/`heavy` complexity class (per [figma-heavy-calls.md](figma-heavy-calls.md)) is an
additional reason to split, and a section sub-worker is never given the whole frame node — only
its own section id, so its heavy calls stay scoped.

The sub-worker receives only that section's Figma node id and runs a normal steps 11–13 pass on it
(global `B<Name>` component match → screen-local default, per
[references/design-system.md](design-system.md); asset resolution per that same reference; a
no-UI-kit-match widget recorded as a gap, never a unilaterally-added dependency), returning its
resolved `CM-XX`/`AS-XX` rows as a small self-contained report — not a running conversation the
frame worker has to keep in context. The frame worker merges those rows into its own `plan.md`
at that section's position and continues to the next section.

This never runs more than one section-sub-worker at a time for the same frame: both sub-workers
would write into the same frame's single `plan.md`, which is exactly the same-file conflict SDD's
"never parallel" rule exists to prevent — it only doesn't apply across frames because frames don't
share a file.

## 5. Cleanup

Once every frame reaches `done` (or is left `gated` with the developer's explicit acknowledgment),
delete `<batch-workspace-root>/<batch-id>/` entirely. Each frame's own
`specs/<ID>-<screen-name>/plan.md` and `spec.md` is the permanent record — the batch workspace
carried no information that isn't already there. Report the batch result the same way a single
frame reports at the end of its own workflow (files created, component fallbacks, asset gaps,
routing changes, verification results), grouped by frame.
