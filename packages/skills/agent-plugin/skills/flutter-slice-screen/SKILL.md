---
name: flutter-slice-screen
description: "**Use for any Flutter UI work sourced from a Figma node against the BUMA Design System** — not only creating a brand-new screen. Trigger this whenever a task slices, adds, adjusts, or re-wires a Figma frame/component into Flutter using this design system: creating a new screen, adding one component to an already-existing screen, fixing a component's props/sizing/styling to match Figma, or resolving a Code Connect mismatch. Example prompts (not exhaustive): 'slice this Figma screen', 'add this component from Figma to the existing screen', 'this SegmentedSwitch doesn't match Figma, fix its props', 'implement this Figma frame'. Do not use for API, domain, repository, or business-logic implementation — presentation/UI code only. Only applies to repos containing `pubspec.yaml` — never use for web/Vue/React work."
disable-model-invocation: false
---

# Slice a Figma screen into Flutter

Create a runnable Flutter screen from a Figma node, presentation code only. The flow is:

```text
orchestrator: screen project → DS ready → --init → get_metadata → sections in plan.md
section workers (fresh context each): Figma read + resolve → layout tree vs screenshot → Dart + render pair
score (diff_renders.py per section): geometry vs metadata + pixel diff → pass | fix (max 2 rounds) | stop
verifier (fresh context, on a fail): diff.png + metadata → difference lines for the fix brief
orchestrator: flutter analyze → render test + screen render pair → --check PASS → route → flutter-run-verify
```

Every `flutter`/`dart` command runs on the environment.md §0 runner (global SDK on the pin, else `fvm`). A worker
`BLOCKED`/`NEEDS_CONTEXT` report stops the slice: no route, no run, until it is `DONE`.

**`subagent-driven-development` is the default execution model, on every host** (Claude Code, Codex, Cursor).
This session is the orchestrator and never holds a section's Figma payload; every section is a
worker unit, even on a one-section screen. Host without subagents → the sequential fallback in
`subagent-driven-development` (one unit at a time, context reset between units). All state is in the slice
folder, so a new chat resumes from `plan.md` and the `work/` reports.

Fidelity is proven by **screenshots and code**, not by a ledger. `plan.md` is a short note the next
developer can read in one minute.

## Required inputs

Collect the Figma frame/node URL first. Then run
[references/project-screening.md](references/project-screening.md) **once**: package root,
presentation convention, routing destination/mode, package-version sources. Reuse it for the run.

After screening, ask exactly one question, once: the **epic name** (recommend the sibling epic or the
containing Figma page first). Everything else (screen name, feature destination, route, packages,
components, assets, sections) uses deterministic defaults and is recorded in `plan.md`. Only a true
environment/access/evidence/destructive conflict stops the run.

`specs/` is always `<package-root>/specs/` — never ask, never use `.slice/specs/`. Never ask about
API, domain or repository. Never ask whether to add the Design System: it is mandatory.

### Generated Dart import policy

Every Dart file using BUMA Design System symbols imports only the public barrel:

```dart
import 'package:buma_design_system/buma_design_system.dart';
```

Never emit `package:buma_design_system/src/...`. Code Connect examples may show internal paths;
normalize them to the barrel.

## Sub-skills

| Skill | Runs at |
|---|---|
| `flutter-match-component` | step 5 — component resolution |
| `flutter-resolve-assets` | step 5 — icon/image/vector resolution |
| `flutter-verify-fidelity` | step 8 — section and screen screenshot audit |
| `flutter-run-verify` | step 9 — headless render test, then a run on an available device |
| `subagent-driven-development` | always — section workers (steps 4c–5, 7–8); also multi-frame batches |

### Developer-question contract

Every genuine question uses the host's structured question tool (`AskUserQuestion` in Claude Code;
a numbered list in chat where none exists) with **2–4 concrete options**, the safest first and
labelled **`(Recommended)`**, each with its consequence. No answer means stop. Never auto-run a
destructive, overwrite or outward-facing action from the recommendation alone. Do not manufacture a
question a deterministic default already settles.

## Working rules (cost control)

- **Never retype a Figma response; never read Figma by eye.** Right after a call, copy the response
  from the host transcript: `python3 <skill-dir>/scripts/figma_xml.py raw <tool> <node-id>
  <out>` (`get_metadata`/`get_design_context` → `work/raw/<tool>-<file-id>.md`, `get_screenshot`
  → `renders/…-figma.png`). Exit 1 (host without a readable transcript) → write `<out>` from the
  tool result verbatim; exit 3 → re-fetch once, still empty → stop and ask. Text styles, colours,
  asset URLs and Code Connect come from `figma_xml.py spec` (step 4c), never from reading the CSS.
- **Fetch each Figma node once; never re-fetch after a compaction.** Right after a
  `get_design_context`/`get_metadata`/`get_variable_defs` call, write its used values to `## Notes`
  (prefixed with the node id) before the next call — a compaction drops the tool result, not the
  file. After a compaction or resume, Grep `## Notes` and `work/raw/` for the node id and work from
  them. A value genuinely missing there → one scoped call on the smallest node that holds it,
  never the root again.
- **Never Read a PNG outside a render comparison.** `get_screenshot` already showed the image;
  re-reading the saved file is a second, larger copy. Renders are viewed only in step 8, once per
  pair.
- **Colour comes from `get_variable_defs`, never from pixels.** No sampling a screenshot, no
  decoding a PNG. Call it on a plain node id (`123:456`); a compound instance id (`I…;…`) is
  rejected — use the nearest plain ancestor or the instance's own plain id from `get_metadata`.
- **Never read `plan.md` whole.** Grep the heading you need (`## Sections`, `## Assets`, `## Notes`).
- **Never read the validator source.** Fix from the printed error. Two rounds per gate: round 2
  still failing → stop and report the errors.
- **DS API from [references/ds-api.md](references/ds-api.md), not `.pub-cache`.** It lists colours,
  spacing, radius, icon, font and responsive members. Missing there → read that one category's
  `tokens.meta.yaml`, once. Write the members you use into `plan.md` `## Notes`.

---

## 1. Screen the project once

Run [references/project-screening.md](references/project-screening.md). Find the target's nearest
`pubspec.yaml`; do not scan unrelated repositories. Never overwrite, recreate or restructure an
existing or locally deleted file without explicit authorization — present the conflict under the
Developer-question contract.

## 2. Detect the harness; ensure the Design System

Pin the Flutter SDK to the DS's `.fvmrc` first — mandatory for every new project root or feature
package, never asked: write the pin ([references/environment.md](references/environment.md) §0).

Run [references/environment.md](references/environment.md)'s detect phase (ScreenUtilInit, routing,
state management). Record the result in `plan.md` `## Notes`.

`buma_design_system` is mandatory. If absent, add exactly this under `dependencies:` (additive-only),
run `flutter pub get`:

```yaml
  buma_design_system:
    git:
      url: https://buma.visualstudio.com/BUMA%20-%20BSpace%202.0/_git/Shared.Package.Mobile.DesignSystem
      ref: release
```

This URL and ref are fixed here — never a question, never `BLOCKED` unless the install itself fails
(quote the output). Record the `resolved-ref` from `pubspec.lock` in `## Notes`; `release` moves, so
two devices can read two token catalogs. Other package versions come from
[references/package-inventory.md](references/package-inventory.md).

## 3. Confirm Figma MCP; allocate the slice folder

Figma MCP unavailable → stop and give the connection step. A screenshot is not a substitute.

Standalone screen:

```bash
python3 <skill-dir>/scripts/validate_output.py --init <screen_name> --epic <epic-slug> <package-root>/specs/
```

`<skill-dir>` is the absolute directory of this `SKILL.md`; the command runs from the package root,
so a relative `scripts/` path does not resolve. It creates `specs/` when missing, allocates/reuses `specs/<ID>-<slug>-<DD_MM_YYYY>/` (slug = epic + screen name without the epic's words, [output-contract.md](references/output-contract.md) §1) with `plan.md`, `spec.md`,
`renders/`, `work/raw/`, and never overwrites. Multi-frame workers do not run `--init`; they use the
path in their brief. The slice folder holds only `plan.md`, `spec.md`, `renders/`, `work/`.

**Exit 3 = ask once.** `--init` stops when a slice's `**ID:**` is a word prefix of this screen or
the reverse (`table_unit_status` vs `table_unit_status_chart`). Ask: *a section of
`<existing>`, or a new screen?* Section → add a `## Sections` row to that `plan.md` and slice it as
that screen's section, no new folder. New screen → re-run with `--new`. Never pick for the developer.

Resuming: run `--init` anyway (it recreates missing folders), read `plan.md` `## Notes`, re-check the
DS `resolved-ref` against `pubspec.lock`, and continue.

## 4. Read the node

### 4a. Branch on the node

`get_metadata` on the supplied node first.

- **Single frame** (`FRAME`/`COMPONENT`/`INSTANCE`) — continue.
- **Several independent frames** under a `PAGE`/`CANVAS`/`SECTION` — stop and follow
  [references/orchestration.md](references/orchestration.md) (**REQUIRED SUB-SKILL:**
  `subagent-driven-development`).
- **Ambiguous** (one frame, or frames that look like variants) — ask once, best-supported
  interpretation first.

### 4b. Recurse into nested instances

One top-level `get_metadata` does not always expand nested instances. For every child that is a
component/instance with more than a single leaf (stat row, table row, card, list item), call
`get_metadata` on that node too. Recurse until leaves — rows absent from the top-level
call ship missing.

Save each response **verbatim** to `work/raw/get_metadata-<node-id>.md` (the ```xml fence as
returned): `figma_xml.py raw get_metadata <node-id> work/raw/get_metadata-<file-id>.json`, then
`figma_xml.py extract work/raw/get_metadata-<file-id>.json <node-id> work/raw/get_metadata-<file-id>.md`
— it cuts the node's balanced subtree from the raw (or JSON-wrapped) MCP response, no retyping:
Figma node types only, every node with `id`/`x`/`y`/`width`/`height`. `--check` fails
an invented tag (`<bar-group>`, `<segment>`) or a node without geometry — a rewritten XML holds no
geometry for the render diff to score.

### 4c. Sections and renders

**Orchestrator:** pick sections from the metadata in Figma sibling order: visually coherent blocks
(header, banner, stats grid, table). Leaf text, icons, dividers stay inside their section. Write the
`## Sections` rows, `get_screenshot` the root → `renders/figma.png`, then dispatch one
section worker per row ([handoff.md](references/handoff.md) §Section workers). Never call
`get_design_context` on the root or a section here — that payload belongs to the worker.

**Section worker** (fresh context; steps 4c–5 and 7–8 for its section only):

1. `get_design_context` + `get_variable_defs` on the section node; save the design context with
   `figma_xml.py raw get_design_context <node-id> work/raw/get_design_context-<file-id>.md`
   (whole — `--check` fails when a metadata text id is missing from it), then
   `figma_xml.py spec work/raw/get_design_context-<file-id>.md <node-id> --metadata
   work/raw/get_metadata-<file-id>.md --ds <package-root> work/spec-<file-id>.md`. The spec is the
   section's source of truth: `## Texts` (string, size/weight/line, colour token, align, box, DS
   style), `## Assets` (URL per node), `## Code Connect`, `## Unmatched`. Use its `DS` column as the
   `UILabel` style (`⚑ UIFont.body.defaultStyle` = `DefaultTextStyle.merge`, ds-api.md); an
   `## Unmatched` row goes to `## Notes` as a gap, never the nearest style. Never edit the spec —
   `--check` regenerates it from the raw files.
2. 2+ sections: `get_screenshot` → `renders/section-<node-id>-figma.png`. One section: no extra
   screenshot — its pair is `figma.png`/`render.png`.

Section renders are the fidelity baseline; the root render covers order, spacing, safe-area, scroll
and fixed chrome. File list: [output-contract.md](references/output-contract.md) §1 Renders.

Compare each section render against its metadata: any visible element with no node (a label, a
column, a totals row, a background wave) means another scoped `get_metadata`.

**Evidence.** Every value the render pair cannot prove — data, tap/drag/state behaviour, a variant
pick — is a `plan.md` `## Evidence` row `Property | Value | Source`; Source is a node id + field
(`get_metadata`/`get_design_context`), a variant or a prototype interaction. No source →
`NEEDS_CONTEXT`, never a guess. The render test's fixture data comes from these rows (the Figma
sample), so the render can match Figma at all.

**Data-heavy nodes** (a table, a stat grid, a chart with displayed values): generate their literal
values from `work/raw/get_design_context-<node-id>.md` — the node's value block (rows, columns,
totals) saved once, re-opened right before writing that widget — never from memory or a summary
(recall drops columns and totals rows).

### 4d. Layout and sizing — read from `get_design_context` CSS

| CSS on the node | Flutter |
| --- | --- |
| `flex-row` / `flex-col` | `Row` / `Column` (never swap the axis) |
| `gap-[Npx]`, `p-[Npx]` | spacing / padding via DS tokens |
| `flex-[1_0_0]`, `flex-1`, `grow` | `Expanded`/`Flexible` on the parent's main axis |
| `w-full` / `h-full` / `size-full` | fill that axis (section root: the parent's width; height from content) |
| `self-stretch` | `CrossAxisAlignment.stretch` on the parent (a divider spanning its row) |
| `w-[368px]` literal | fixed |
| `min-w-[N]` / `max-w-[N]` | `ConstrainedBox(constraints: BoxConstraints(minWidth:/maxWidth:))` |
| `aspect-[W/H]` | `AspectRatio` — only from this class, never from a frame's width/height |
| none on that axis | hug (no size) |

**Content sizes the container.** Height comes from content + padding + gap tokens; a parent gets
`height:` only from a literal `h-[Npx]` on that node. Never read a size off the screenshot or the
section's bounds — those are one sample at the Figma width (the render diff checks the
keyed root ±1px there). Inside a fixed or ratio box, children hug or fill; they never repeat the parent's extent.

**Small widths reflow, never shrink.** When a `Row` cannot fit its hug/fixed children at 320, wrap
the section in `LayoutBuilder` and switch that `Row` to a `Column` below a breakpoint derived from
the children's minimum widths (`// ponytail:` comment naming it). Never `FittedBox(scaleDown)`
around text or icons, never smaller tokens. Breakpoints live per section — no generic responsive
wrapper shared by cards with different sizing. The reflowed `Column` gets
`mainAxisSize: MainAxisSize.min`, or the card stretches to the viewport height.

**Reflow keeps Figma's lines.** Only a block-level `Row` (metrics beside a table) may become a
`Column`; a line inside a block (label + value, label + time) stays one `Row`. Never `Wrap` to push
an element under its neighbour — `Wrap` only where Figma itself wraps (`flex-wrap`, a chip list).
Two `flex-[1_0_0]` halves whose texts never meet in Figma (label left, `text-right` value right) →
`Row[label, Expanded(Align(alignment: Alignment.topRight, child: value))]`: the label hugs, the
value takes the rest, no gap Figma does not draw.

**Text is never cut unless Figma cuts it.** `overflow:`/`maxLines:` only when that TEXT node's CSS
has `truncate` or `line-clamp-N`, with the node cited on the line (`// Figma truncate <node-id>`).
Otherwise the label hugs or fills and wraps when it must — every string renders in full. ScreenUtil
grows text on most phones while fixed widths stay ([ds-api.md](references/ds-api.md)
§Responsive), so a Figma line that fits at the Figma width can still wrap at 393: fix the fixed
widths and gaps around it, never the text. `--check` fails an uncited `overflow:`/`maxLines:`.

**Vectors get the instance box.** `SvgPicture` with only `height:` derives its width from the
viewBox and can overflow; give `width:` (and `height:` when Figma sets both) from the instance size,
centred in a `SizedBox` of the instance frame when the vector is smaller than it.

Do not infer sizing by comparing widths. A `fill` child in an unbounded `Row` without `Expanded`
throws `BoxConstraints forces an infinite width`.
`Positioned` only for a child of a non-auto-layout parent or an absolutely positioned child.

**Anchor from geometry, not from the CSS `top`/`left`.** Figma CSS always writes absolute children as
`top`/`left` of one frame size; copied into `Positioned` they hold only at that size. Pick each side
from the child's bounds against its parent: nearer the bottom (`y + h` ≥ parent `h` − 8, or past it)
→ `bottom: parent h − (y + h)`; nearer the right → `right:`; spans the parent width (`x` ≤ 0 and
`x + w` ≥ parent `w`) → `left: 0, right: 0`; centred → `Align`. `top`/`left` only when the child sits
near that edge. Example: wave `top 205 h 23` in a `220` card → `bottom: -8, left: 0, right: 0`.

**Layout tree before Dart.** Per section, write the nesting to `## Notes` from the CSS, one line per
auto-layout frame (`OB block: Column[Row(label ⓘ … time), Row(value, bar, %), Row(plan, gap)]`;
a TEXT whose CSS has `truncate`/`line-clamp` gets `✂` after it, e.g. `name✂`), then
check it against the section's Figma render: every visual line in the screenshot is one
`Row`, every element sits on the line it sits on in the picture. A mismatch is fixed in the tree,
before any Dart — the tree survives a compaction, the CSS does not.

**Integer geometry.** Figma decimals (`13.45`, `7.5`) become integers rounded half up in Dart.

## 5. Resolve components, assets, tokens

Per node:

- components → **REQUIRED SUB-SKILL:** `flutter-match-component` (read-only Code Connect; `Component/<Name>`
  wrappers resolve through their **Inner** instance; use the placed instance's values, never the
  example's literals).
- icon/image/vector → `figma_xml.py assets work/spec-<file-id>.md <package-root>/assets/images/<feature>`
  before any Dart: one download per URL, content-checked, prints the `## Assets` rows (exit 1 =
  expired URL → re-run `get_design_context`, re-save, re-spec, retry once). Every spec asset gets a
  row (a DS glyph → a `ds` row); nodes without a spec URL → **REQUIRED SUB-SKILL:**
  `flutter-resolve-assets` (SVG vs PNG rule below). Never a `CustomPaint`/shape stand-in for an asset.
- tokens → [references/tokens.md](references/tokens.md): every colour, font, spacing and radius is a
  DS token; the variant/state selector is decided explicitly, never left to a default.
- no DS equivalent (chart, map, animation) →
  [references/external-packages.md](references/external-packages.md) before touching `pubspec.yaml`.

**Charts.** Bar/line/area/pie/scatter visuals that encode data are charts; progress/status/rating
bars are not. Follow [references/charts.md](references/charts.md): DS chart first, else fl_chart (the
DS chart package; bar/column = its stacked bar pattern, 1 series = a plain bar), Syncfusion only for
radial bar/gauge; a floating per-point container is a tap/drag tooltip. The chart type comes from
shapes, never from the layer name: `figma_xml.py classify <get_metadata.md> <chart-id>` (type,
points, series, stacking, bar width/gap, tooltip candidates; exit 3 = pruned plot → re-fetch that
node, still empty → `NEEDS_CONTEXT`). Then `chart_refs.py <package-root> <type> [tooltip] [stacked]
[overlay] [area]` prints version-exact code from the DS chart sources/tests and the resolved
package's `example/` — the brief cites the best hit as the `reference` line.

### SVG or PNG — one rule

Vector (icon, illustration, wave, hauler, loader, logo) → `.svg` via `download_assets(node,
defaultFormat: "svg")`; bitmap image fill → `.png`/`.jpg` from `rawImages`; DS/Material glyph →
`UIIcon(...)`, no file. `export` is a render, never an asset; empty `rawImages` means vector. Full
table: `flutter-resolve-assets` "SVG or PNG — decide first".

## 6. Write `spec.md` and `plan.md`

`spec.md` — WHAT only: purpose, states, visible content/behaviour, `AC-XX` acceptance criteria,
visible gaps. No node IDs, tokens or Dart decisions.

**`--intent <path>/intent.md`** (from `using-bspace-sdlc`; optional, read-only): add the line
`**Intent:** <path from the repo root>@<hash>` (hash = the `using-bspace-sdlc` one-liner) and reuse
the intent's `AC-xx` ids — every intent AC appears in `spec.md`, mapped or `- AC-xx: N/A: <why>`
(another screen, no UI). `--check` then fails on an unmapped AC or a stale pin (intent edited
after slicing: re-map, update the pin). No `--intent`: unchanged.

`plan.md` — four parts, nothing else:

- **Sections**: `Node | Name | Widget file` — one `widgets/<screen>_<section>.dart` per section.
- **Assets**: `Node | Name | Kind | Path` — Kind `svg` | `raster` | `ds` (`ds` Path is `-`). Node
  is the full id exactly as `get_metadata` prints it (`I10306:78999;7712:27567`), never shortened:
  one layer, one row, one download. Before `download_assets`, Grep `## Assets` and `work/raw/` for
  the id's last segment — a hit means it is already on disk.
- **Evidence**: `Property | Value | Source` — data, behaviour and variant picks the render cannot
  prove, each with its Figma node id + field, variant or prototype (step 4c Evidence).
- **Notes**: `target:` (feature dir, routing mode/registry), DS components used, the DS API
  cheat-sheet, harness state, `resolved-ref`, decisions and gaps (one line each); `- mask <id>:`
  lines (flutter-verify-fidelity §1); `- reference <id>: <DS source path>` lines.

**Reference.** When `flutter-match-component` finds the nearest DS component but it cannot be used as is
(`UIChartFixedBar` for a 4-series stacked bar, a DS card missing one slot), the orchestrator writes
`- reference <section-id>: <absolute path of its .dart source>` and puts the same line in the
brief. The worker reads that file before writing Dart, copies its pattern (layout, geometry, touch,
overlay), keeps Figma's values, and its report names the file and what it copied. `--check` fails
a report that does not name it, a chart with neither a `UIChart*` nor a reference line, a
reference file that does not exist, and a hosted package reference at another version than
`pubspec.lock`. Every chart has a `- chart <node-id>: …` Notes line; a `chart` line naming no node,
or chart code in a section with no chart line, fails.

`--check` reads the Sections, Assets and Evidence tables and the `chart`/`mask`/`reference` Notes lines. The orchestrator writes Sections before dispatch and
fills Assets and Notes from the section reports; workers never write `plan.md`.

## 7. Generate the Dart

Per [references/output-contract.md](references/output-contract.md)'s file tree and skeleton.

- The **screen file owns page chrome** (`Scaffold`, `appBar:`, `bottomNavigationBar:`,
  `floatingActionButton:`, `SafeArea`); the content widget owns `body:`. The route opens the
  `*Screen`, never a section widget.
- Text is `UILabel` (style from the node's DS text style), never `Text(`; alpha lives in the
  colour token, never `Opacity(`; an overflow is fixed in the layout, never hidden by a
  `SingleChildScrollView` with `NeverScrollableScrollPhysics`.
- Each section is its own independently pumpable widget file from `## Sections`.
- Build from the saved Code Connect snippet with this instance's values substituted.
- Preview data is local `const` values in the screen-local widget; never invent API data.

Each section worker writes its own section file and render pair; the orchestrator writes the screen
and content files from the reports ([references/handoff.md](references/handoff.md) §Section workers).

Then `dart format <changed files> && flutter analyze <target-feature-directory>`. Analyze
clean is not done: overflow only shows when the widget is pumped (step 8).

**Pre-existing SDK/dependency errors** pointing into `.pub-cache` are not slicing defects: never
change an existing constraint or add `dependency_overrides` for them — report them.

## 8. Screenshot fidelity → REQUIRED SUB-SKILL: `flutter-verify-fidelity`

Each section worker, for its own section: render the Flutter section at the Figma section's width,
height left to the widget (never forced), with the flutter-verify-fidelity §5 harness (DS fonts loaded, animation off, Figma sample data,
`matchesGoldenFile` + `--update-goldens`, `writeLayout`), save `renders/section-<node-id>.png`
(2+ sections only; the PNG is the section's own size — a height off Figma fails the score), then
score it:

```bash
python3 <skill-dir>/scripts/diff_renders.py <slice-dir> <node-id>
```

Exit 0 = pass; 1 = verifier, fix from Figma sources (structure → colour → detail), re-render,
re-score — in the same turn, never a report; 5 = verifier first (no fresh
`work/section-<id>-verify.md` naming every failing node); 4 = stop, `NEEDS_CONTEXT` with the diff
report (flutter-verify-fidelity §1: no round cap; stop after 2 renders without progress with a verifier
`NEEDS_CONTEXT` line, or 4 without; after a stop the script refuses to score until the developer
resumes with `--continue`; never delete `work/iter/<id>/score.json`). Only exit 0 or 4 ends the
loop; exit 1 always means continue fixing, never ask the developer or end the turn. On Claude Code
the plugin `Stop` hook enforces it. The render test pumps at
`frameWidth:` = the Figma root frame width (`--check`), the section unwrapped (no `SizedBox`/
constraints around it). Pass = fidelity ≥ 98%, every node of ≥ 400px²
≥ 90%, no geometry error. The test imports the skill's `test/support/fidelity_harness.dart`
(flutter-verify-fidelity §5). Every part of the section (header, legend, plot: the first level of 2+
children in `get_metadata`, through single-child wrappers; a masked node excepted) carries
`Key('<node-id>')`, so a geometry error names the part that is off. The test asserts `find.text` for every string and `find.byType` per DS instance. The score, not the worker's `DONE` nor a verifier's word,
closes the section; on a fail a fresh verifier explains the diff regions
([references/handoff.md](references/handoff.md) §Independent verifier). Then the orchestrator, for
the whole screen: `renders/render.png` (at the Figma root frame size) against `renders/figma.png`.
No score means fidelity is unchecked.

The `<screen>_render_test.dart` (`flutter-run-verify` §2: 320/390/393/430 widths, `takeException()` null,
no `didExceedMaxLines`, log grep clean) runs here too — a short device overflows where the Figma
size does not.

Then the code gate, by the orchestrator once every section report is `DONE` and every section
scored a pass — always run it; the route and `flutter-run-verify` come only after it passes:

```bash
python3 <skill-dir>/scripts/validate_output.py --check <target-feature-directory>
```

`<target-feature-directory>` is the `target:` dir — the one **containing** `presentation/`
(`lib/features/<feature>/`), never `presentation/` itself — and it must hold
`presentation/<screen>.screen.dart`.

`--check` fails on: hardcoded colour/font/`TextStyle(`/`EdgeInsets`/radius literal, raw `Icon(`
(use `UIIcon`), raw Material buttons, decimal geometry, out-of-scope directories, a missing section
widget file, with 2+ sections a section without `renders/section-<node-id>.png`, no `test/**/<screen>*_render_test.dart`
with `expect(tester.takeException(), isNull)` (a printed exception fails), a `pumpDs` whose
`frameWidth:` is not the Figma root frame width or whose child forces a size (`SizedBox(height:`,
`.fromSize`, `.expand`, `BoxConstraints`), an `0xAARRGGBB` colour literal (a table of hex values
included: use the spec's colour token), an asset that is missing, undeclared in `pubspec.yaml`, a PNG for an
`svg` row, or listed twice (two id forms of one layer, or one path in two rows), and a stray file at
the slice-folder root. Also on: `Opacity(`, raw `Text(`, a `SingleChildScrollView` with
`NeverScrollableScrollPhysics`; a `work/section-*-report.md` not `DONE`/`DONE_WITH_CONCERNS`; a
screen without `Scaffold(` or a section widget used outside `presentation/` (route to the screen);
no `renders/figma.png` or `renders/render.png`; `.dart_tool/version` or iOS `FLUTTER_ROOT` off the `.fvmrc` pin,
or a `dependency_overrides` entry for a DS-pinned package; a `widgets/<screen>_*.dart` (but
`_content`) with no `## Sections` row; a chart that is hand-painted or `SfCartesianChart`, not a
`UIChart*`/fl_chart/Syncfusion widget, imports an undeclared package, or has a tooltip without touch
handling and a `tapAt` test, or an axis-chart tooltip that does not follow a drag (no
`FlPanUpdateEvent`, no `dragFrom` test); a bar/column chart whose XML has no sized column segments
(a stub); a `get_metadata-*.md` with no verbatim ```xml fence; a chart with no `UIChart*` and no `reference` line, or a report that does not name its
`reference` file; a `## Sections` row whose current
render pair does not score a pass (`diff_renders.py`, re-scored by `--check`; never scored, geometry
error — a Figma TEXT not laid out included — or pixel diff over the limit); an `## Evidence` row without a Figma node id or still
`NEEDS_CONTEXT`, a chart without its `data <node-id>` row; a section without
`work/raw/get_design_context-<file-id>.md`, `get_metadata-<file-id>.json` or `work/spec-<file-id>.md`, a design context missing a
metadata text id (truncated), a metadata file that differs from its saved `.json` response, a spec
that differs from re-running `figma_xml.py spec`; a `UILabel('<spec text>')` with another style than
the spec's `DS` column, or a data-driven `UILabel(x.y, …)` with a style no spec row of its section
names; a spec text with no box in `get_metadata` (nested instance not expanded, 4b); a spec asset with no `## Assets` row; `CustomPaint`/`draw*` in a non-chart
section whose spec has assets; a render older than its section widget or a spec asset without its
`Key` (`diff_renders.py`). Two rounds, then stop and report.

**Final report** per section: `fidelity <x>% · PASS|FAIL|NEEDS_CONTEXT` from the last
`work/iter/<id>/score.json`, plus `--check`'s result. Never "pass"/"done" while `--check` fails —
quote its failing lines instead.

## 9. Verify headless → REQUIRED SUB-SKILL: `flutter-run-verify`

The slice is verified when `flutter-run-verify` returns `PASS (headless)` — render test green. Then, once
per batch, the orchestrator runs the app on an available device (`flutter-run-verify` §3: pub get, analyze,
`flutter run`, debug console read, auto-fix within the DS constraints) and writes
`- run: PASS <device>` | `- run: skipped (no device)` | `- run: BLOCKED <reason>` in `## Notes`.
`BLOCKED` stays unverified (`--check` fails it); never report it as "tests passed".

Finally reconcile `spec.md` (`AC-XX` met or diverged, said plainly) and `git add` the slice folder
with the screen's commit — `--check` fails while `plan.md` is untracked.

---

## Boundaries

- Presentation only: no domain, repository, infrastructure, datasource, service, API client,
  persistence or serialization files.
- Prefer the resolved DS API over raw Material; never use a deprecated DS API.
- Never create a component inside the DS package. No match → screen-local widget, gap noted.
- New assets go into a matching `assets/images/<category>/` folder; a new folder gets one additive
  `pubspec.yaml` line. Never edit a shared asset-constants file.
- Add an external package only when the screen needs it and an approved constraint exists.
- Outside the target feature, touch only: the route registry (routing `auto`), `main.dart` /
  `pubspec.yaml` harness edits, the mandatory DS dependency.
- Figma and Code Connect are read-only. Never call `get_code_connect_suggestions`,
  `send_code_connect_mappings` or `add_code_connect_map`.
- Under orchestration only the orchestrator touches `main.dart`, routes and shared files.
