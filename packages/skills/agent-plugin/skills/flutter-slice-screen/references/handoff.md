# Handoff contract — what goes down to a worker, what comes back

Two dispatches use these schemas: inside every screen, orchestrator → section worker (§Section
workers, the default); in a developer-selected parallel batch, orchestrator → frame worker. A
worker has a *fresh context*: it knows only what its brief says. Anything not written down gets
re-derived, and a re-derivation is a chance to derive it differently.

**Never hand down a bare node id.** The dispatcher already called `get_metadata` on that subtree to
decide to dispatch. Save that response verbatim to the worker's `work/raw/` and cite the path.

## Contents

- [Task brief — handed down](#task-brief--handed-down)
- [Worker report — handed back](#worker-report--handed-back)
- [Section workers](#section-workers)

## Task brief — handed down

A file written before the subagent is spawned, at `<slice-folder>/work/<frame-id>-brief.md` (inside
the target's own slice folder; a relative path anywhere else lands beside `plan.md`). Sections:

1. **Identity and target**
   - Figma node id and URL of this frame; screen name; epic slug (resolved once for the batch — the
     worker never re-infers it and never runs `--init`).
   - Absolute pre-allocated slice-folder, `plan.md` and `spec.md` paths.
   - Target presentation directory for this frame, from [orchestration.md](orchestration.md) §1.
   - **Writable set:** `<screen>.screen.dart`, `widgets/<screen>_*.dart`, screen-prefixed tests, and
     files inside this slice folder. Everything else (`progress.md`, `assets/`, `pubspec.yaml`,
     `main.dart`, route registry, unprefixed widgets) is orchestrator-owned.
   - Routing mode and registry destination from screening.
2. **Design context already fetched** — paths of the saved `work/raw/` files (metadata, any
   context/variables/Code Connect already read). This is the worker's floor, not its ceiling: it
   still recurses into nested instances and reads each section's `get_design_context`. Values come
   from `work/spec-<id>.md`, never from a screenshot by eye.
3. **Harness status** — what is present vs pending, and the resolved `buma_design_system` checkout
   path (`rootUri` from `.dart_tool/package_config.json`). A worker never writes `pubspec.yaml` or
   `main.dart` and never asks for the DS URL, ref or a package version.
4. **Rules to read** — absolute paths of `SKILL.md` and each reference/sub-skill the named steps
   use, then the step numbers and the stop point. *Read these files first, then work.*
5. **Escalating is allowed** — state it in the brief: "If anything is unclear, missing, or
   contradicts Figma, report `NEEDS_CONTEXT` or `BLOCKED` and say what you need. A guessed decision
   is worse than no decision."
6. **Why parallel is safe** — a disjoint slice folder, and widget files disjoint **because they are
   screen-prefixed** (a sibling frame may share `presentation/widgets/`). An unprefixed widget is
   reported, not written.

## Worker report — handed back

A file at `<slice-folder>/work/<frame-id>-report.md`, beside its brief. Required:

- **Status** — the worker's only status write; the orchestrator updates `progress.md`:
  - `DONE` — everything resolved.
  - `DONE_WITH_CONCERNS` — resolved, with a doubt worth reading before merging.
  - `NEEDS_CONTEXT` — name the missing field; do not guess it.
  - `BLOCKED` — say what was tried; when a developer choice can unblock it, give 2–4 options with
    the safest first, labelled `(Recommended)`. The recommendation is not consent.
- **Plan summary** — absolute `plan.md`/`spec.md` paths; components that fell back to screen-local
  widgets; `--check` result.
- **Rules read** — every path from brief item 4 actually opened.
- **Pending `harness:` lines** (e.g. `flutter_svg`).
- **Proposed asset exports** — `| Node | Name | Kind | Proposed path |`, Kind per flutter-resolve-assets'
  SVG-or-PNG table. Never downloaded by the worker.
- **Proposed route entry** (snippet, import, destination) — never applied by the worker.
- **Proposed screen-local widget files** — `| Class | File | Nodes |`. Two frames of one feature
  proposing the same class get one unprefixed shared file from the orchestrator.
- **Discrepancies** (nodes beyond the brief, contradicting evidence) and **Gaps** (no DS match, no
  asset, missing Figma data).

Nothing else — not a transcript.

### What the dispatcher does with each status

- `DONE` → check against the brief's node list, merge.
- `DONE_WITH_CONCERNS` → read the concerns; settle correctness/scope before merging.
- `NEEDS_CONTEXT` → supply the field, re-dispatch. Fix the brief, not the worker.
- `BLOCKED` → missing context: add it and re-dispatch; a developer decision: relay it with options.

Never re-dispatch an identical brief to a worker that reported `BLOCKED`. While any report is
`NEEDS_CONTEXT`/`BLOCKED` the slice is unfinished: no route, no `flutter-run-verify`, no "done" to the
developer — `--check` fails on it. An environment blocker (SDK, pub get) is fixed per
environment.md §0, never worked around in Dart.

## Section workers

The default for every screen, per **REQUIRED SUB-SKILL:** `subagent-driven-development` — even a one-section
screen. The screen session is the orchestrator: screening, harness, `--init`, `get_metadata`,
`## Sections`, the root render, shared files and the screen/content files. Everything that carries
a section's Figma payload runs in the worker. Workers never dispatch further workers. At most 3–4
run at once; a host without subagents runs them one at a time with a context reset between
(`subagent-driven-development` "Host mapping").

**Before dispatch** the orchestrator has written `## Sections` and the root render, saved the
section's `get_metadata` subtree to `work/raw/get_metadata-<node-id>.md`, and — when that subtree
holds a vector or image node that is not a DS icon instance — chosen the feature's asset category,
declared it in `pubspec.yaml` and ensured `flutter_svg` (`flutter-resolve-assets` steps 2–4), so workers
never touch shared files. Inside a parallel frame batch `assets/` and `pubspec.yaml` are
batch-orchestrator-owned: the section worker reports its asset rows as proposals and downloads
nothing ([orchestration.md](orchestration.md) §3).

**Brief** — `<slice-folder>/work/section-<node-id>-brief.md` (`:`/`;` in the node id become `-`):

```markdown
- screen: task_screen
- target: lib/features/task/ (routing mode, registry)
- section node: 12:40 — https://figma.com/design/<file>?node-id=12-40
- owner file: lib/features/task/presentation/widgets/task_screen_card.dart
- metadata: work/raw/get_metadata-12-40.md
- spec: work/spec-12-40.md (worker writes it, SKILL.md 4c step 1)
- asset category: assets/images/task/ (or "none")
- harness: ScreenUtilInit config, DS resolved-ref
- figma render: renders/section-12-40-figma.png
- flutter render: renders/section-12-40.png
- render test: test/.../task_screen_card_render_test.dart
- chart package: fl_chart 1.0.0, applied (chart sections only; charts.md)
- reference: <absolute path of the nearest DS component's .dart> (SKILL.md 6 Reference; or "none")
- steps: SKILL.md 4c (worker) – 5, 7 (this file only), 8 (this section's pair)
```

Add the rules to read (brief item 4, absolute paths) and the escalation sentence (brief item 5).

**Writable set** — the owner file, its render test, the two section renders, this section's
`work/raw/` files, and new asset files named after their own node in the brief's category. Never
`plan.md`, `pubspec.yaml`, `main.dart`, another section's file or a shared widget.

**Report** — `<slice-folder>/work/section-<node-id>-report.md`:

- `## Status` — `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`.
- `## Assets` — the section's rows (`Node | Name | Kind | Path`), each file verified on disk.
- `## Notes` — ≤10 lines: DS components and members used, decisions, gaps, any proposed shared
  widget or package; with a `reference`, the file name and what was copied from it.

`DONE` only after `dart format` + `flutter analyze` (§0 runner) on the owner file pass, the render test
passes (flutter-verify-fidelity §5: fonts loaded, height not forced, `takeException()` null, `find.text` per string,
`find.byType` per DS instance) and its golden wrote the Flutter render. `DONE` is a claim, not
proof: the `diff_renders.py` score decides the pair (flutter-verify-fidelity §1). The orchestrator copies `## Assets`/
`## Notes` into `plan.md`, writes the screen and content files and the screen render pair, then
runs `--check` once for the feature; the route and `flutter-run-verify` come only after it passes.

## Independent verifier

Runs only when a section's score fails (`diff_renders.py` exit 1 or 4), in a **fresh context** (a
new subagent; on a host without subagents, a context reset). It never saw the worker's reasoning,
never edits code and never decides pass/fail — the score does.

- **Input:** the pair (`renders/section-<id>-figma.png` + `section-<id>.png`; one section:
  `figma.png` + `render.png`), the last `work/iter/<id>/diff.png` + `score.json` (geometry
  errors, top diff nodes), `work/raw/get_metadata-<id>.md`, the owner file path.
- **Explains** each red region and geometry error by its Figma node: text, icon/image, DS instance
  and variant, axis, gap, padding, alignment, wrap/hug vs fill, colour, typography; nothing extra.
- **Output:** `work/section-<id>-verify.md` — one line per difference:
  `<node-id> <element> — Figma <value> (<source field>) vs Flutter <value>`. A difference it
  cannot trace to a Figma source is listed as `NEEDS_CONTEXT`, not guessed. Every newly failing node id of `score.json` (geometry errors, `weak`) appears in a line, or
  `diff_renders.py` refuses the next score (exit 5). Once a node diagnosis is recorded in
  `score.json` `verified_ids`, unchanged later rounds reuse it; the verifier need not repeat it.
  "DS internals" is not a line: open the DS widget source and name the field.

The orchestrator turns the lines into a fix brief for a new worker on the same section, fixes in
order structure → colour → detail. No round cap: the loop runs until the score passes or `diff_renders.py` says `STOP` (2 renders
in a row without progress — fidelity +0.5 points or fewer geometry errors — with a verifier
`NEEDS_CONTEXT` line, or 4 without one; it refuses to score again): the section goes to the developer as `NEEDS_CONTEXT` with the last `diff.png`, the
remaining lines and the fidelity history. The developer adds context and resumes with `--continue`;
`work/iter/<id>/score.json` is never deleted. A worker report `DONE` on a stopped loop fails `--check`.
