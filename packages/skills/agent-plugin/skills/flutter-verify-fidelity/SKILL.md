---
name: flutter-verify-fidelity
description: Audit a generated Flutter screen against its Figma node — per-section Figma vs Flutter screenshot pairs, completeness at every nesting depth, sibling order, auto-layout axis (HORIZONTAL must be a Row), verbatim text, component props/variant/styling, per-instance independence, and a pumped render with a saved screenshot as evidence. Use after generating or editing a screen, when a screen "looks wrong" versus Figma, or as flutter-slice-screen's audit step. Fixes what it finds; a prose "audit passed" with no screenshot on disk is not a pass. Only applies to repos containing `pubspec.yaml`.
---

# Figma fidelity audit

**Context modes.** Under `flutter-slice-screen` this is step 8: the Dart exists, `flutter analyze` passed (`--check` runs after this step), and the
slice folder holds `plan.md` (`## Sections`, `## Assets`, `## Notes`), `work/raw/` and the Figma
renders `renders/figma.png` (root) + `renders/section-<node-id>-figma.png` (only with 2+ sections;
file list in `flutter-slice-screen/references/output-contract.md` §1 Renders). Standalone (a screen
sliced earlier or by hand) there is no `plan.md`: call `get_metadata`, `get_design_context` and
`get_screenshot` on the node first and report corrections inline. The checks are identical.

**Ground truth is Figma, not the code.** Every comparison below reads the Figma side from a Figma
MCP result (saved under `work/raw/` or re-fetched for that node) or a Figma render — never from the
Dart under audit, which agrees with itself by construction. `diff_renders.py` decodes the render
pair to **score** it; a value to write in Dart is never sampled from a PNG — colours and sizes come
from `get_variable_defs`/`get_design_context`.

**This audit does not replace the render test.** Runtime exceptions across device sizes, notch/
safe area and text scale need the **REQUIRED SUB-SKILL:** `flutter-run-verify` (headless, then a run on an
available device for pod/gradle and native plugins).

## 1. Section render pairs — the gate

A section is done when its render pair **scores** a pass, not when someone looks at it and says so.
With one `## Sections` row the pair is `figma.png`/`render.png`; with 2+, `section-<id>-figma.png`/
`section-<id>.png` per row, in Figma sibling order, then the composed screen by eye.

1. **Render.** Pump the section alone, wrapped in the app's real `ScreenUtilInit` (§5), at the
   Figma section **width**; its height is its own (never a `SizedBox` of the Figma height — that
   hides an overflow and fakes the root size on a broken layout). Animation off, DS fonts loaded, Figma sample data. The same pump saves the
   golden (`matchesGoldenFile` + `--update-goldens`) and `work/layout-<id>.json` (`writeLayout`,
   §5). The Figma PNG is `get_screenshot` at scale 1 (same pixel size). A hand-written or copied PNG
   is not a render.
2. **Score.** `python3 <flutter-slice-screen>/scripts/diff_renders.py <slice-dir> <node-id>`:
   - **refused first:** a render older than the section's widget file is a geometry error —
     re-run the render test, then score;
   - **geometry first:** every spec asset node is a part too; every `Key('<node-id>')` rect vs its `get_metadata` box (±1px), and every
     part of the section (first level of 2+ children, a masked node excepted) must carry its key,
     so a bar drawn over the legend shows as the legend's error; every Figma
     TEXT vs its laid-out paragraph — top and height ±2px (size, line height, line count), width
     no wider than the Figma box;
   - **pixels second:** per-pixel colour distance (pixelmatch YIQ 0.1); a colour found within 1px
     in the other image (2px inside a TEXT box) is anti-aliasing, not a diff; `mask` nodes skipped;
   - **fidelity** = 100 − pixel diff % of the unmasked pixels: one number, per section and per
     Figma node (`score.json` `fidelity`, `nodes[].fidelity`);
   - **pass** = no geometry error, section fidelity ≥ 98%, and every node of ≥ 400px² ≥ 90% (a
     small badge wrong in colour fails even when the section total passes);
   - overwrites `work/iter/<id>/` (`render.png`, `layout.json`, `diff.png`, `score.json`; one row
     per round in `score.json` `history`) and lists the Figma nodes holding the most diff pixels.
     Only `score.json` is committed (`work/iter/.gitignore`). `renders/` keeps only the latest pair.
3. **Verify**, if it failed with a new node target: a fresh verifier writes
   `work/section-<id>-verify.md` ([handoff.md](../flutter-slice-screen/references/handoff.md) §Independent
   verifier). The next score is refused (exit 5) until that file is newer than the last `score.json`
   and names every newly failing node id (geometry errors + nodes under 90%). Unchanged failures
   reuse `score.json`'s `verified_ids`; do not rerun or reread the full verifier report.
4. **Fix** in this order: structure (geometry errors, missing/extra nodes) → colour
   and typography → detail. Every change cites its Figma source (node id + field); a value tuned
   until the pixels match, with no source, is overfitting — the score can pass on a wrong screen.
5. **Re-render and re-score.** Exit 0 pass, 1 verify and fix again, 4 stop, 5 verify first.

**No round cap, and the loop is not the model's to end.** Exit 1 means keep going in the same
turn: tests, analyze and suite green are not an end. On Claude Code the plugin's `Stop` hook blocks
ending the turn while a `score.json` fails without `stop`. Progress = fidelity up ≥ 0.5 points or
fewer geometry errors. **Stop** (exit 4, `--check` says `stop:`) only after 2 renders in a row
without progress **and** a verifier line `NEEDS_CONTEXT` (a difference with no Figma source), or
after 4 renders without progress when every difference was traced. Then the section is
`NEEDS_CONTEXT` — report the remaining geometry errors, the nodes under
90%, the last `diff.png` and the fidelity history from `score.json`; the developer decides
(missing evidence, a DS limit, a Figma inconsistency). After a stop the script refuses to score
until the developer, with the new context, runs `diff_renders.py <slice-dir> <node-id> --continue`
(history kept, stale count reset). Never delete `work/iter/<id>/score.json`.

**Masks.** A Figma node the initial render rightly does not show the same way (a tooltip Figma
draws open, a live clock) gets one `## Notes` line `- mask <node-id>: <why>`; its box is not
counted. Never mask a node to pass a diff — the reason is a Figma fact (prototype, variant).

Only after every section passes, pump the composed screen at the Figma root frame size, save
`renders/render.png` and compare it with `renders/figma.png` by eye: section order, global
spacing, app bar/body, safe area, scroll ownership, bottom-navigation inset, fixed/floating chrome.

**No score on disk = that section was not audited.** `--check` re-scores the current pair, so a
stale `score.json` never passes.

**The worker never certifies its own pair.** The score decides; a fresh verifier
(`flutter-slice-screen/references/handoff.md` § Independent verifier) only explains the diff regions as
`<element> — Figma <value> vs Flutter <value>` lines for the next fix brief.

## 2. Completeness

Call `get_metadata` on the node **fresh**, recursing into every nested instance with more than one
leaf (flutter-slice-screen step 4b). Walk every node at every depth and confirm the Dart renders it, the
resolved DS component renders it by default, or it is genuinely non-rendering (hidden, duplicate).
Anything a top-level call never walked into ships missing.

- **"Decorative" is not "skippable."** A visible wave, illustration or background pattern needs
  its `## Assets` row and a real file through **REQUIRED SUB-SKILL:** `flutter-resolve-assets`.
- **A mapped parent does not cover its children.** A badge, icon, label or vector nested in a mapped
  card is checked on its own, at any depth.

## 3. Order, axis and sizing

- **Order.** Siblings compose in Figma's list order on the parent's axis. A section in the wrong
  slot is fixed like a missing one.
- **Axis.** From the saved `get_design_context`: `flex-row` must be a `Row` (or a horizontal
  `Wrap`/DS row), `flex-col` a `Column`.
- **Sizing** (flutter-slice-screen step 4d): `flex-1`/`grow`/`w-full` on the main axis → `Expanded`/
  `Flexible`; no size class → hug, no width/flex; literal `w-[Npx]` → that extent. A fill child
  bare in an unbounded `Row` throws `BoxConstraints forces an infinite width`.
- **Known gap — wrap.** A wrapping Figma frame and a non-wrapping one can both read as a row; only
  the render pair shows the difference. Do not call a wrapping layout axis-verified.

## 4. Text, components, styling

**Text.** Every string matches Figma exactly — wording, punctuation, case, even placeholder copy.
Strings a DS component draws from its own item list are checked on the render pair — an item count
or label copied from the Code Connect example (`"Tab"`) is a failure.

**Data-heavy nodes** (tables, stat grids, charts): compare the rendered values with the saved
`work/raw/get_design_context-<node-id>.md`, row by row, column by column, totals included.

**Component is really there.** For each DS component noted in `## Notes`, the pumped test asserts
`find.byType(<Class>)` finds the expected count. A hand-rolled `Row` of `Text` under a DS name is a
failure.

**Props.** Read layout/behaviour props off the widget (`tester.widget<UISegmentedSwitch>(...)
.isHugging`). Where no getter exists, grep the call site for the literal pair the Code Connect
snippet carries — `size: UITabSwitchSize.medium` is in the Dart or it is not (an omitted prop
renders the DS default).

Cross-check against the Figma node, set explicitly rather than trusting a default:

- alignment (an app-bar title left-aligned in Figma is not left on the centre default);
- size/variant/state — the Figma instance's selected variant, not the first familiar one;
- sizing and overflow — dynamic text in a constrained parent already wrapped in `Flexible`/
  `Expanded`; no `overflow:`/`maxLines:` unless that TEXT node has `truncate`/`line-clamp`
  (flutter-slice-screen 4d "Text is never cut");
- structure — every line of the Figma render is one `Row` in Dart at every test width; a reflow
  moves blocks, never an element off its line;
- colour, font, padding, gap, radius, border, shadow — the token resolved per
  [tokens.md](../flutter-slice-screen/references/tokens.md) from the saved context, not the component default;
- icons/vectors are the resolved asset, never a font icon picked by layer name;
- no invented conditional styling ("colour changes past a threshold") unless Figma or the DS
  documents it.

**Discarded DS match.** A component replaced by a screen-local widget must be named in `## Notes`
with the reason, after re-checking the match per **REQUIRED SUB-SKILL:** `flutter-match-component`.

**Per-instance independence.** Repeated components (stat blocks, rows, badges, progress bars) each
take values from **their own** node's context. Two tells: instances that look different in the
Figma render but get the same token in Dart; Code Connect returning identical boilerplate for
visually distinct instances. Re-read each instance's own node.

**Charts.** Real Figma series reach the chart (`## Evidence` row `data <chart-id>`), no synthetic
data; bar width, gap, radius and stacking are the render diff's job; no tooltip in the initial state;
tap/drag selects a point and only then shows a tooltip with that point's content; on an axis chart
the tooltip follows the drag. One render pair (initial) plus a tap and a drag assertion
([charts.md](../flutter-slice-screen/references/charts.md) §Proof).

## 5. Pumped render

Pump the **complete composed screen** in `MaterialApp(home: ...)` in a screen-level test
(`<screen>_render_test.dart`, kept as a regression test) and assert `tester.takeException()` is
`null`. Isolated component tests do not certify the screen.

**Scale 1:1 with Figma.** `pumpDs` sets the view and `ScreenUtilInit.designSize` to the Figma
root frame (`frameWidth:` = its width, `--check`), so `.sp`/`.w`/`.h` equal Figma px and the
render is comparable pixel for pixel. Never pass a `UIResponsive.designSize` value (412, 360) as
`frameWidth:` — bps_banner pumped at 412 and every text came out 412/393 wide. The app's own
scaling (`UIResponsive.designSize(width)`) is the `<screen>_render_test.dart` width loop's job
(flutter-run-verify §2). `.sp`/`.w`/`.h` tokens are static fields computed on first access — skipping the
wrapper locks them to a garbage size for every later test in the isolate. Symptom: overflow of
hundreds or thousands of pixels on one line of text. Fix the harness before touching generated code.

**The harness is the skill's file, not the test's.** Copy
`flutter-slice-screen/assets/test-support/fidelity_harness.dart` verbatim to `test/support/fidelity_harness.dart`
and import it; never edit it. It holds:

- `loadDsFonts()` — `setUpAll(loadDsFonts)`. `flutter test` renders unloaded fonts as Ahem boxes
  (a label measures ~2× its width) and google_fonts hangs on an http fetch; it registers the DS
  Poppins files under the family names google_fonts emits and turns fetching off.
- `pumpDs(tester, child, frameWidth:, sectionWidth:)` — the `ScreenUtilInit` (designSize = the
  Figma root frame) + `Key('render')` boundary at the Figma width; the height is never set, and the
  child is the section itself (`--check` fails a `SizedBox(height:`/`BoxConstraints` around it). It swallows only the DS-unshipped
  google_fonts variant error and `expect(tester.takeException(), isNull)`.
- `writeLayout(tester, path)` — after the golden, in the same pump: every `Key('<node-id>')` rect
  and every laid-out paragraph (`textSize`) for `diff_renders.py`.

`--check` fails: a missing or differing copy, a test that does not import it, a test defining its
own `pumpDs`/`writeLayout`/`loadDsFonts` (or a `write*Layout`/`dump*Layout` copy), and `setSurfaceSize(` (forces the box).

```dart
import '../../../support/fidelity_harness.dart'; // depth from the test file

void main() {
  setUpAll(loadDsFonts);
  testWidgets('section 10306:78999', (tester) async {
    await pumpDs(tester, const ProductionSummaryBanner(), frameWidth: 393, sectionWidth: 361);
    for (final s in ['Plan: 20.000', 'OB', 'GEN OB']) {
      expect(find.text(s), findsWidgets, reason: s);
    }
    await expectLater(find.byKey(const Key('render')),
        matchesGoldenFile('../../../../specs/<slice>/renders/section-10306-78999.png'));
    writeLayout(tester, 'specs/<slice>/work/layout-10306-78999.json');
  });
}
```

Run `flutter test --update-goldens <test>` to write the PNG (the golden path is relative to
the test file, here `test/features/<feature>/presentation/`), then plain `flutter test` as the
regression. The golden is the `Key('render')` boundary: `sectionWidth:` sets its width, the
section sets its height — a section taller or shorter than Figma makes a PNG of another size, which
fails the score. The composed-screen test saves
`renders/render.png` the same way. Sanity check: a Figma string renders at roughly its Figma
text width — about twice that means fonts did not load.

Assert in the same pump (`--check` enforces the first). Section size is not asserted here: the
root `Key('<node id>')` rect in `layout.json` is scored ±1px against `get_metadata` (§1).

- `find.text(<exact Figma string>)` for every visible string — catches truncation and placeholder
  items. Every Figma TEXT (but masked/chart) must be laid out — `diff_renders.py` scores a missing one.
- `find.byType(<DS component>)` with the Figma instance count — catches a dropped or swapped
  instance.
- in the `<screen>_render_test.dart` width loop (`--check` enforces the first): no
  `RenderParagraph` has `didExceedMaxLines`; the section hugs (its bottom minus its lowest text's
  bottom ≤ its bottom padding + 4); a `Row` pair from `## Notes` that the reflow must keep shares
  one `dy`. Snippet in [flutter-run-verify](../flutter-run-verify/SKILL.md) §2.
- every child passed into a composed component actually renders (e.g. `UIAppBar.custom`'s
  `trailingActions`). Correct usage that still doesn't render
  is a DS package defect — report it, don't route around it with a deprecated API.

Overlay/fixed chrome: the render shows fixed chrome, overlay and scroll content together without
occlusion, bottom-navigation collision, missing safe-area inset or clipped labels.
`Scaffold.floatingActionButton` is never justified by bottom position or shadow alone.

## 6. What the render pair catches by eye

- **Every icon/image is a graphic, not a solid box.** A filled square means an invalid asset file
  (re-verify per `flutter-resolve-assets` step 5) or a placeholder widget (banned, step 8); non-visual checks
  never catch it.
- **Blank or shortened regions.** Zero-extent layout throws nothing: an `Expanded` in an unbounded
  parent, a `Stack` of only `Positioned`, a `SizedBox` from a mis-read token. Same severity as a
  blank box.
- **Padding on a shared decorative container.** A full-bleed wave/background beside padded content
  sits in `Stack` → `[Positioned(asset), Padding(child: content)]`; padding the whole `Stack` pulls
  the asset off the edge Figma shows it flush against.

## Fix, don't just report

Mismatches are fixed in the same run, before `spec.md` is reconciled. A correction that changes a
decision (a component, a variant, an asset Kind/Path) is written back to `plan.md` — `## Assets`
row or one `## Notes` line — so the next developer does not inherit the stale one. `spec.md`'s
Validation section records that the audit ran, the render paths, and any genuine remaining gap.
