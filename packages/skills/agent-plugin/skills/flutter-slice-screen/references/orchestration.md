# Multi-frame orchestration

Entered from [SKILL.md](../SKILL.md) step 4a when the node is a `PAGE`/`CANVAS`/`SECTION` with more
than one independent-screen `FRAME`. This session becomes the **orchestrator** per **REQUIRED
SUB-SKILL:** `subagent-driven-development` (task files before dispatch, fresh context per worker, file-based
reports, external verification). It slices no screen itself; it sets up per-frame work, runs or
dispatches frames, and owns every shared file. This file covers only the flutter-slice-screen mapping.

Every frame, single or batched, runs its sections as section workers ([handoff.md](handoff.md)
§Section workers). A frame worker whose host cannot nest subagents runs its sections itself, one at a
time. Brief/report schemas: [handoff.md](handoff.md).

**No routine confirmation exists anywhere in a batch.** Questions only for: the feature-grouping gate (§1.3), unclear screen names, and true blockers — all under SKILL.md's
Developer-question contract.

## Contents

- [Why parallel dispatch is safe](#why-parallel-dispatch-is-safe)
- [1. Detection & setup](#1-detection--setup--before-any-dispatch)
- [2. Dispatch](#2-dispatch)
- [3. Consolidated finalization](#3-consolidated-finalization--before-generation)
- [4. Execution mode](#4-execution-mode)
- [5. Verify, report, clean up](#5-verify-report-clean-up)

## Why parallel dispatch is safe

`subagent-driven-development` normally never runs implementation workers in parallel. Frames are the exception
because write sets are disjoint **by file name**, not by directory (two frames of one feature share
`presentation/`):

- a frame worker writes only its pre-allocated slice folder, screen-prefixed tests,
  `<screen>.screen.dart` and `widgets/<screen>_*.dart`;
- an **unprefixed** widget file is a shared-widget candidate — reported, written once by the
  orchestrator (§3);
- `progress.md`, asset exports, `main.dart`, `pubspec.yaml` and the route registry are
  orchestrator-only.

## 1. Detection & setup — before any dispatch

1. **Frames and epic.** Enumerate frames from the multi-frame `get_metadata`; infer each screen name
   from the frame name (ask only if unclear or two frames collide). Resolve the epic slug **once**:
   the slug shared by sibling `specs/` folders, else the containing Figma page name. A section/group
   name or feature dir counts only if it yields one slug for every frame. No page or several pages →
   ask. Every brief carries the epic verbatim.
2. **Screening once** ([project-screening.md](project-screening.md)): convention, routing and
   dependency sources are shared; the destination is per frame (next item).
3. **Feature slug per frame**, first match wins: the containing Figma section/group name; the frame
   name's leading segment before `/`, `-`, `·`, ` — `; the single existing feature dir matching the
   screen name. Apply screening §2 to get each destination; record it in `progress.md`. Never reuse
   the first frame's destination for all.

   **Feature-grouping gate — only when slugs differ.** Ask once, listing every frame → directory
   pair: **`Group by inferred feature (Recommended)`**, **`All frames into one feature dir`** (the
   developer names it), **`Let me assign frames to features`** (mapping used verbatim),
   **`Cancel the batch`**.
4. **Environment once** ([environment.md](environment.md) detect phase). Write the mandatory DS
   dependency from SKILL.md step 2 immediately. Workers append screen-driven needs (e.g.
   `flutter_svg`) to their reports; the orchestrator dedupes and applies them once, before
   generation. Workers skip environment detection.
5. **Workspace** `<package-root>/.slice-orchestration/<batch-id>/` (gitignored; deleted in §5)
   holds exactly one file, `progress.md`: one row per frame — frame id, screen, target feature dir,
   slice folder, status (`pending` → `resolving` → `generating` → `done`/`gated`, or
   `needs-context`/`blocked`). Orchestrator is the sole writer, after reading each report. Briefs
   and reports live in each frame's `work/`, never here.
6. **Pre-allocate slice folders serially.** In frame order, one call at a time:
   `python3 <skill-dir>/scripts/validate_output.py --init <screen> --epic <batch-epic> <package-root>/specs/`.
   Concurrent `--init` calls can assign one ID twice. Record each absolute folder and
   `plan.md`/`spec.md` path. Workers never run `--init` and never assemble a folder name.
7. **One brief per frame** at `<slice-folder>/work/<frame-id>-brief.md`, after allocation. Save the
   frame's part of the detection `get_metadata` verbatim to `work/raw/get_metadata-<frame-id>.md`
   and cite it — the worker reads the frame's metadata, not a re-derivation at another depth, and
   its values from `work/spec-<id>.md`, never from a screenshot by eye.

## 2. Dispatch

Apply the §4 mode choice first. **Linear:** each frame runs the single-frame workflow in turn, no
brief/report files. **Parallel:** one Agent per frame with its brief, running [SKILL.md](../SKILL.md)
steps 4–8 for that frame only, **skipping step 2 and step 3's `--init`**, stopping only on a true
blocker. Tell each worker its write set (above) and that siblings may be writing in the same
feature directory. At step 8 a worker runs `--check <feature-dir>` and fixes only errors in its own
files.

**Route registry:** workers never edit it, in either routing mode ([routing.md](routing.md)); they
put the proposed entry (snippet, import, destination) in their report. The orchestrator applies
entries one at a time.

## 3. Consolidated finalization — before generation

Each worker finishes discovery and planning, then writes `<slice-folder>/work/<frame-id>-report.md`
per [handoff.md](handoff.md): status `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`, every
screen-local fallback by name, its `plan.md` summary, absolute `plan.md`/`spec.md` paths. The batch
does not proceed while any frame is `needs-context` or `blocked`.

- **Shared widgets.** Group every report's proposed screen-local widgets by class name per feature
  directory. Proposed by two or more frames → one unprefixed `presentation/widgets/<widget>.dart`,
  written by the orchestrator; affected workers are told **import it, do not write it**. One frame →
  stays screen-prefixed. Note each consolidation in the affected `plan.md` `## Notes`.
- **Assets.** Merge proposed exports by normalized destination path. Same source → one write.
  Different sources, same path → distinct descriptive names, `## Assets` rows updated. `ds` rows
  are never downloaded. For `svg`/`raster` the orchestrator creates new categories, calls
  `download_assets` per node (SKILL.md "SVG or PNG"), saves
  `work/raw/download_assets-<node-id>.json`, validates per `flutter-resolve-assets`, and dedupes
  `pubspec.yaml` lines. Workers never write under `assets/`.

Then record each frame's status and consolidation result in its permanent `plan.md`, apply the
deduplicated package/route/asset/widget changes, and let generation run. A true blocker stops the
batch; after it is resolved, resume from the first incomplete step.

## 4. Execution mode

Never asked — picked from the frame count:

- **1 frame → linear**: the single-frame workflow, no handoff files.
- **2+ frames → parallel**: one worker per frame (at most 3–4 at once), disjoint prefixed paths,
  orchestrator-owned shared files.
- **No git repository** (no worktree possible): workers run in the shared tree on their disjoint
  write sets; a host that needs a worktree for subagents runs linear instead.

Record `dispatch: linear | parallel | linear (no git)` in `progress.md`. Either mode runs each
frame's sections as section workers.

## 5. Verify, report, clean up

When every frame is `done` (or `gated` with the developer's acknowledgment):

1. `validate_output.py --check <feature-dir>` **once per distinct feature directory**, so sibling
   frames' files are checked together; two rounds, then report.
2. `flutter-run-verify` **once, at the orchestrator** — headless, then the device run (`flutter-run-verify` §3:
   pub get, analyze, `flutter run` on an available device, debug-console auto-fix); `- run: …`
   line in each frame's `plan.md`. Evidence stays per frame: render-test command/log (plus runner log and screenshots when
   run), recorded in that frame's `plan.md`. One clean frame never certifies the batch; missing
   evidence or `BLOCKED` frames are named.
3. Report per frame (files, fallbacks, asset gaps, routing, verification) plus every consolidated
   shared widget and which frames import it.
4. After results are in each frame's `plan.md`/`spec.md`, delete `.slice-orchestration/<batch-id>/`.
