# Presentation-only output contract

## Contents

1. File tree and slice folder
2. spec.md and plan.md
3. Assets, charts, components, placement
4. Sections and widget files
5. Screen vs content split
6. Committing the slice folder
7. Generated output must
8. Dart file skeleton
9. Validator entry points

## 1. File tree and slice folder

Destination = the presentation convention fixed by one-pass screening, applied to this screen's
feature slug ([project-screening.md](project-screening.md) §2). With none — including an empty
project — `lib/features/<feature>/presentation/` (tests in `test/features/<feature>/presentation/`);
never ask for another path. `domain/` and `data/` come later as siblings of `presentation/`; slicing
never writes them. Generate the smallest file set the design needs:

```text
<flutter-package-root>/            # nearest directory with pubspec.yaml
├── specs/
│   └── <ID>-<slug>-<DD_MM_YYYY>/  # exactly these four entries, nothing loose
│       ├── spec.md                # human WHAT/WHY, reconciled at step 9
│       ├── plan.md                # sections, assets, notes — after discovery
│       ├── renders/               # see "Renders" below
│       └── work/                  # raw evidence; frame brief/report only in parallel mode
├── assets/images/<category>/      # existing category reused, or a new one added + registered
├── pubspec.yaml                   # additive-only edit, only when a new category was added
└── lib/features/<feature>/
    └── presentation/
        ├── <screen-name>.screen.dart
        └── widgets/
            └── <screen-name>_content.dart
```

`--init` assembles the folder name: `<ID>` zero-padded sequential (`001`) within the package-root
`specs/`; `<slug>` = `<epic>` (the slug asked once, `--epic`, e.g. `hr-gs`) + the kebab-case screen
name minus any leading words equal to the epic; `<DD_MM_YYYY>` the date the folder was first
created, never changed on re-runs. Examples: epic `hr-gs` + `task_screen` →
`specs/001-hr-gs-task-screen-21_09_2026/`; epic `card-live` + `card_live_banner` →
`002-card-live-banner-…`; epic `banner` + `banner` → `003-banner-…`. The folder whose `plan.md`
`**ID:**` is this screen is reused with its `<ID>` and date, whatever its name. `<specs-dir>` is
always the absolute `<package-root>/specs/`; `.slice/specs/` or any non-root specs dir is a
violation.

**Renders** — the fewest PNGs that still prove fidelity. Goldens are pumped at the Figma node's
size, never on a larger canvas (`--check` compares section PNG size with `get_metadata` bounds):

| File | What | When |
|---|---|---|
| `figma.png` | `get_screenshot` of the root node | always |
| `render.png` | Flutter screen, pumped at the Figma root frame size | always |
| `run-<runner>.png` | screenshot on a real runner (`flutter-run-verify`) | only when a runner was requested |
| `section-<node-id>-figma.png` + `section-<node-id>.png` | Figma + Flutter pair per section | only when `## Sections` has 2+ rows; one section's pair is `figma.png`/`render.png` |

`renders/` holds only the latest pair. Each score (`diff_renders.py`, flutter-verify-fidelity §1) keeps
its round under `work/`:

| File | What |
|---|---|
| `work/layout-<node-id>.json` | `Key('<node-id>')` rects + laid-out texts, written by the render test (`writeLayout` from `test/support/fidelity_harness.dart`, the skill's verbatim copy) |
| `work/iter/<node-id>/render.png` + `layout.json` | the render and layout of the last round (overwritten, git-ignored) |
| `work/iter/<node-id>/diff.png` | red = differing pixels, blue = masked (overwritten, git-ignored) |
| `work/iter/<node-id>/score.json` | committed: `round`, `fidelity` (100 − pixel diff %), geometry errors, `nodes[]` (area, fidelity), `weak` (nodes ≥ 400px² under 90%), `history` (`{round, fidelity, geometry, worst}` per round), `verified_ids`, `stale`, `resumed`, `pass`, `stop` (set → no round is scored until `--continue`) |
| `work/iter/.gitignore` | written by `diff_renders.py`: only `*/score.json` is tracked |
| `work/section-<node-id>-verify.md` | the independent verifier's lines for the last failed round (handoff.md §Independent verifier) |

## 2. spec.md and plan.md

`spec.md` carries the approved intent as `AC-XX` acceptance criteria (one per approved state),
written after discovery and reconciled against the output at step 9. No skeleton placeholder stays
unresolved; a reviewed requirement is never silently rewritten to match the code — say the shipped
screen diverged.

Component, asset, token and Dart decisions belong only in `plan.md`, four parts and nothing else:

- `## Sections` — `Node | Name | Widget file`, one screen-local widget file per section.
- `## Assets` — `Node | Name | Kind | Path`; Kind is `svg`, `raster` or `ds` (`ds` Path is `-`).
- `## Evidence` — `Property | Value | Source`: every value the render cannot prove (data,
  behaviour, variant pick) with its Figma node id + field, variant or prototype; a chart has a
  `data <node-id>` row. No source → `NEEDS_CONTEXT`.
- `## Notes` — `target:`, DS components used, the DS API cheat-sheet, harness state,
  `resolved-ref`, decisions and gaps, one line each.

Raw Figma responses live in `work/raw/` (`figma_xml.py raw` writes them from the transcript:
`get_metadata-<id>.json` + its extract `.md`, `get_design_context-<id>.md`), never copied into
`plan.md`. `work/spec-<id>.md` (`figma_xml.py spec`) is the section's text/asset/Code Connect
table; `--check` regenerates it and fails an edited or missing one. `--check` reads the
`## Sections`, `## Assets` and `## Evidence` tables, and `## Notes` `chart`/`mask` lines.

## 3. Assets, charts, components, placement

**Assets** follow `flutter-resolve-assets`: reuse an existing project asset first, export into a matching
`assets/images/<category>/`, create a new category (one additive `pubspec.yaml` line) only when none
matches. Under orchestration, frame workers only propose exports; the orchestrator dedupes and writes
each shared path once. Never edit the shared asset-constants file — report it as a follow-up.

Every visible graphic gets an `## Assets` row: decorative/background vectors, full-bleed or pinned
artwork, badges, logos, icons nested in resolved components. A parent mapping never covers a child
graphic. Kind follows SKILL.md "SVG or PNG — one rule". Never replace an unresolved graphic with a
coloured box, placeholder or guessed font icon.

**Charts.** Classify bar, stacked bar, line, area, pie/donut, scatter, radar, combination,
axis/grid, legend-bearing, multi-series and selectable-point visuals before component resolution.
Progress/status/loading/rating bars and simple single-metric bar/ring visuals are not charts.
Package choice, API, tooltip behaviour, data and proof: [charts.md](charts.md).

**Mapped components are dependencies, not sections.** A Code Connect-mapped parent is a DS
dependency whatever its name prefix; `Component/<Name>` resolves through its Inner instance. A
custom parent holding mapped children stays one section.

**Figma MCP evidence is a prerequisite.** Every value comes from a `get_metadata`,
`get_design_context`, `get_variable_defs` or `download_assets` result in this run; only what a later
step re-reads is saved to `work/raw/` (SKILL.md "Working rules"); renders under `renders/`. No
guessed geometry or memory substitutes.

**Placement comes from evidence.** Placement (app bar, body flow, fixed/floating overlay, bottom
navigation) and scroll ownership come from scoped metadata/context, never widget defaults. A
body-flow tab is never emitted through `UIAppBar.bottom`. Floating: only per `flutter-match-component` §8.
Final evidence shows fixed chrome, overlay and scroll content together without occlusion, collision,
safe-area failure or clipped labels. Non-obvious placement → one `## Notes` line.

## 4. Sections and widget files

Sections are visually coherent blocks in Figma sibling order; leaf text, icons, spacers, dividers
and decorative children stay inside their section. Each `## Sections` row gets one independently
pumpable `widgets/<screen-name>_<section>.dart` without page chrome; the screen owns composition.
Each section file has exactly one writer, its section worker; the screen and content files belong to
the orchestrator ([handoff.md](handoff.md) §Section workers).
Don't create a file per visual node, and don't hide several complex sections in one content file; a
section kept inside its parent gets a `## Notes` line saying why.

**Every screen-local file is `widgets/<screen-name>_*.dart`.** `widgets/` is shared by every screen
of the feature; the prefix keeps them (and parallel frame workers) disjoint. An **unprefixed** file
is reserved for a widget shared by several screens, written only by the orchestrator after a rung-4
proposal ([orchestration.md](orchestration.md) §3). A single-frame run follows the same naming.

Typed preview values are local `const`/`static const` fields inside the widget file — no fixture
file or class.

## 5. Screen vs content split

| Screen file (`<screen-name>.screen.dart`) | Content file (`widgets/<screen-name>_content.dart`) |
|---|---|
| `Scaffold` and its `backgroundColor` | everything inside `Scaffold.body` |
| `appBar:` (the resolved `UIAppBar`) | the scroll view, `Column`/`Stack`, sections |
| `bottomNavigationBar:` | every mapped DS component that is body content |
| `floatingActionButton:` + `floatingActionButtonLocation:` (`flutter-match-component` §8) | screen-local sub-widgets |
| `SafeArea`, if the design needs it above the body | |
| later: route arguments, providers, `ConsumerWidget` | never a provider — stays a pure View |

A screen whose `build` is only `=> const <ScreenName>Content();` is incomplete; a `Scaffold` or
`UIAppBar` in the content file is misplaced. The split gives state a seam (screen file), keeps the
content pumpable alone, and keeps frame workers' write sets disjoint.

`StatelessWidget` by default; `ConsumerWidget` only when preview-state switching or existing
providers need Riverpod. Never add a state-management dependency for static slicing.

## 6. Committing the slice folder

When the screen's Dart is committed, stage the slice folder in the same commit:
`git add <specs-dir>/<slice-folder>`. This is the developer's repository:

- Stage **only** the slice folder path. Never `git add -A`, never `git add .`.
- **Commit only. Never `git push`, never create a branch, never amend.**
- Dart already committed → commit the slice folder on its own, message naming the screen.

`--check` fails while `plan.md` is untracked (silent outside a git repository).

## 7. Generated output must

- Have no unresolved template variables or placeholder layout.
- Preserve the package's import style and file naming; DS imports only via the barrel (SKILL.md
  "Generated Dart import policy").
- Resolve text through DS typography (`UILabel` or its replacement when it fits); no screen-local
  `_BodyText` wrappers, no raw `TextStyle(` — pick the `UIFont` token matching Figma size/weight
  (`Poppins Bold 12` → `UIFont.body.bold`). See [tokens.md](tokens.md).
- Use integers for every width, height, offset, padding, gap and size (decimals rounded half up).
- Compose auto-layout parents as `Row`/`Column` with the context's gap/justify/align, and size each
  child per SKILL.md 4d; cross-axis `fill` is `CrossAxisAlignment.stretch`/`double.infinity`, never
  `Expanded`. `Positioned` only for non-auto-layout parents or absolute children.
- Render `ds` asset rows as `UIIcon(Icons.<name>, size: UIIconSize.<member>)`; no raw `Icon(`.
- Keep exact component identity and resolve every visible nested child independently
  (`flutter-match-component` §9).
- Start each mapped component from its saved Inner Code Connect snippet and keep every named
  argument (`flutter-match-component` §5) — an omitted prop silently takes the DS default.
- Render without an API; keep Figma copy unless the user asks otherwise; add semantic labels/keys
  for meaningful interactions; no domain/infrastructure imports.
- **Give every section root a `Key` with its Figma node id** — `key: const Key('12:345')`, matching
  its `## Sections` row — so `writeLayout` measures it and the render diff scores it ±1px.
- **Constrained copy is resilient at first composition.** Any dynamic label, timestamp, value or
  localized string in a split-width row, fixed-width cell or other constrained parent gets
  `Flexible`/`Expanded` when that `Row`/`Column` is first written — the Figma copy is one sample.
  It wraps, it is never cut: `overflow:`/`maxLines:` only for a TEXT node with `truncate`/
  `line-clamp` in its CSS (SKILL.md 4d "Text is never cut"). The render test asserts the exact
  Figma string and no `didExceedMaxLines`; clipped labels, covered content or missing insets are
  fidelity failures.
- **Pad the content, not a container a decorative asset shares:** `Stack` →
  `[Positioned(asset), Padding(child: content)]`, never `Padding` around the whole `Stack`. The
  `Positioned` sides come from SKILL.md 4d "Anchor from geometry" (a bottom wave is
  `bottom:`/`left: 0, right: 0`), never the CSS `top`/`left` copied verbatim.
- **Bound one-axis components at generation time** (`UIDivider`, progress bars, skeletons,
  background fills) using the 3-rung order in [flutter-run-verify](../../flutter-run-verify/SKILL.md) §4 — never a
  hardcoded extent Figma doesn't specify, never by deleting the component.
- **No jank constructs:**

  | Do not write | Write instead |
  |---|---|
  | `IntrinsicHeight`/`IntrinsicWidth` as the first bounding choice | rung 1 or 2 first; `Intrinsic*` only when siblings must share one extent |
  | `shrinkWrap: true` on a list that is not short **and** fixed-length | `Expanded` around a normally scrolling list |
  | `ListView(children: [...])` for a repeating row set | `ListView.builder` |
  | `height:` on a container with no `h-[Npx]` in its CSS | hug: padding + gap tokens size it (SKILL.md 4d) |
  | `Opacity` wrapping a subtree | the alpha in the node's own resolved colour token |
  | raw `Text(`/`Text.rich(` | `UILabel` with the resolved `UIFont` token |
  | `SingleChildScrollView` + `NeverScrollableScrollPhysics` | a plain `Column`; scroll only where Figma scrolls |
  | `FittedBox(fit: BoxFit.scaleDown)` to make content fit | `LayoutBuilder` + reflow `Row`→`Column` (SKILL.md 4d) |
  | `overflow:`/`maxLines:` on a label without Figma `truncate`/`line-clamp` | hug/`Expanded`, let it wrap; cite `// Figma truncate <node-id>` when Figma cuts |
  | `Wrap` that drops an element under its neighbour on one Figma line | `Row[hug, Expanded(Align(...))]` (SKILL.md 4d "Reflow keeps Figma's lines") |
  | `SvgPicture.asset(..., height: N)` alone | `width:` from the instance box too |

  `--check` fails on the `Opacity`, raw `Text`, `SingleChildScrollView`, `FittedBox` and
  `overflow:`/`maxLines:` rows.

## 8. Dart file skeleton

No template files — generate directly. The screen file holds the chrome the node shows; omit lines
the design lacks, never omit `Scaffold` when there is a page background, app bar, bottom bar or
floating element:

```dart
class <ScreenName>Screen extends StatelessWidget {
  const <ScreenName>Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: /* the node's own resolved background token */,
      appBar: /* the resolved UIAppBar, when the design has one */,
      body: const <ScreenName>Content(),
      bottomNavigationBar: /* the resolved bottom bar, when the design has one */,
      floatingActionButton: /* only per flutter-match-component §8 */,
    );
  }
}
```

```dart
class <ScreenName>Content extends StatelessWidget {
  const <ScreenName>Content({super.key});

  @override
  Widget build(BuildContext context) {
    return /* layout from the supplied Figma node */;
  }
}
```

## 9. Validator entry points

- `--init <screen_name> --epic <epic-slug> [--new] <specs-dir>` — SKILL.md step 3; serial in a
  multi-frame batch. Exit 3 = a related slice exists: ask section-or-new-screen, `--new` for new.
- `--check <target-feature-directory>` — SKILL.md step 8, after the renders (failure list there):
  SDK pin, worker reports, plan tables, renders (`figma.png`, `render.png`, section pairs at Figma
  size when 2+ sections), render test with
  `expect(tester.takeException(), isNull)`, `get_metadata` equal to its saved `.json`, every `widgets/<screen>_*.dart` (but `_content`) a `## Sections` row,
  each section's render pair re-scored (`diff_renders.py`, every part keyed), `## Evidence` sources,
  `reference` lines named in their report,
  chart rules ([charts.md](charts.md)), jank constructs, `Scaffold` in the screen, routes to the screen only.
  Must pass before the route and `flutter-run-verify`. Two rounds, then stop and report.
