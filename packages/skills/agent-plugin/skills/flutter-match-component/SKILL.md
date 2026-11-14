---
name: flutter-match-component
description: Resolve a Figma node to the right BUMA Design System Flutter component and its full prop set — Code Connect mapping, nested/two-level instance drill-down, the known-gotcha props Code Connect omits (isHugging, hasShadow, isScrollable, bottom), floating placement, and per-instance style resolution. Use when a component does not match its Figma design, when picking a component for a Figma node, when a Code Connect lookup comes back empty or wrong-framework, or as flutter-slice-screen's component-resolution step. Only applies to repos containing `pubspec.yaml`.
---

# Match a Figma node to a BUMA Design System component

**Context modes.** Under `flutter-slice-screen`, each decision is one line in `plan.md` `## Notes`
(node, Flutter class, Code Connect outcome, non-default props, gaps); the Code Connect snippet is
saved verbatim under `work/raw/`. Standalone (one component fix), report the same line inline.
The resolution logic is identical.

## Contents

1. Resolve the DS package on disk
2. Non-code `get_design_context` responses
3. `Component/` wrappers resolve through Inner
4. Escalation ladder
5. Instance reconciliation
6. Discarding a match
7. Full constructor and gotchas
8. Floating placement
9. Per-instance, per-child, exact identity, style

## 1. Resolve the DS package on disk

Read the target's `.dart_tool/package_config.json`; the `buma_design_system` entry's `rootUri` is the
resolved checkout. Use it for component lookup here and token lookup in
[tokens.md](../flutter-slice-screen/references/tokens.md). Re-resolve when the lockfile changes.

No entry: declared in `pubspec.yaml` → run `flutter pub get`; not declared → add the fixed block
from [flutter-slice-screen SKILL.md step 2](../flutter-slice-screen/SKILL.md) and run `flutter pub get`. Never ask
for a URL/ref, never guess a path. Imports use only the public barrel (flutter-slice-screen SKILL.md
"Generated Dart import policy"); normalize `src/` paths from Code Connect examples.

Call `get_design_context` on the node first: it returns the Code Connect mapping, reference code and
screenshot together. Everything below operates on that output.

## 2. Non-code `get_design_context` responses

Neither authorizes a guess; neither is a developer question.

- **Sparse metadata** ("too large to fit into context"): re-call `get_design_context` in one
  parallel batch on every visible child id; recurse if a child is sparse too. The bare node tree
  carries no mapping or props.
- **Code Connect connection prompt** ("Some Figma design components are not connected..."): non-data.
  Never ask to connect; never call `get_code_connect_suggestions`, `send_code_connect_mappings` or
  `add_code_connect_map`. For `Component/<Name>` resolve Inner (§3). For any other node call
  `get_code_connect_map` on it — it reads existing mappings without the prompt.

## 3. `Component/` wrappers resolve through Inner — mandatory

A node named `Component/<Name>` is a screen-side wrapper around an Inner instance of the true DS
component (`base/<Name>`, `organism_M/<Name>`), often defined in another library file. Neither
`get_design_context` nor `get_code_connect_map` walks into descendants or other files.

The Inner mapping is authoritative — even a populated outer Flutter mapping is wrapper evidence
only:

1. From `get_metadata`, take the Inner instance's compound id `I<outerId>;<innerId>` and name.
2. `get_design_context` on the compound id. (`get_code_connect_map` rejects compound ids.)
3. Empty or wrong-framework → the Inner may live in another file: find its library via component
   descriptions or `get_libraries`, then call `get_code_connect_map`/`get_design_context` with that
   fileKey and the plain Inner id. Still part of the Inner lookup, not rung 2.
4. Accept only a Flutter-labelled Inner result. Note line:
   `Inner I<outer>;<inner> <name> → <Flutter class> ✓ Flutter (inner)`. Save the snippet verbatim.
   Inner owns identity, constructor and base snippet.
5. Apply the placed instance's values (variant, size, content) from the wrapper context where the
   Inner API supports them. A direct Inner-master lookup's defaults never overwrite them (master
   says `large`, screen instance says `medium` → keep `medium`).

Inner unresolved, missing or non-Flutter → `BLOCKED`/`NEEDS_CONTEXT`, never rungs 2–4.

Wrappers without the `Component/` prefix still drill into their child instance; there a direct
Inner-master snippet may serve as fallback when the wrapper context has none.

## 4. Escalation ladder — stop at the first match

1. **Code Connect mapping** from `get_design_context`. Read the full example including comments:
   a comment is often a load-bearing rule (`/// If length tabs more than 4, make alignment start and
   isScrollable true.`); apply it to this instance's real data. The example's labels, numbers and
   colours are a template — resolve `value`/`color`/`label` from this node (`get_variable_defs`).
   An instance-varying prop (`value`, `percent`, `progress`, `color`, `label`, `text`, `title`,
   `count`) equal to the example usually means it was copied — re-read the node.
2. **Component metadata / public API** from the resolved package (`component.meta.yaml`, else
   `lib/src/components/<atoms|molecules|organisms|patterns>/<component>/`), found via
   `search_design_system` or keyword. Note it as *inferred*. Match real constructor and prop names.
3. **Existing project usage** — compatibility fallback only.
4. **No DS component.** Screen-local widget `presentation/widgets/<screen-name>_<widget>.dart`, gap
   noted with its Code Connect outcome (`✓ Flutter`, `✓ React-only → rung 2`, `✗ not connected`,
   `✗ connection prompt → read-only lookup`). Not for a `Component/` wrapper before Inner resolved.
   - Shared across screens of one feature: a frame worker proposes it in its report
     ([handoff.md](../flutter-slice-screen/references/handoff.md)); the orchestrator alone writes the single
     unprefixed `presentation/widgets/<widget>.dart`
     ([orchestration.md](../flutter-slice-screen/references/orchestration.md) §3).
   - Reusable on developer request: use an existing shared-widget folder (e.g. `shared_component/`);
     none exists → stay screen-local, report the gap. Never invent a shared-folder structure.
   - Never create a component inside the DS package.

Do not use examples from a newer DS checkout than the target resolves. Existing feature code may hold
deprecated APIs and is not authoritative.

## 5. Instance reconciliation

Three evidence layers; none stands in for another:

```text
Inner Code Connect / component metadata = identity + constructor shape
placed Figma instance = labels, content, variant, selected state, instance-varying props
Figma variables/styles + geometry = tokens, visual values, position, sizing
```

Before writing the call site, know for that node: identity (Inner id, class, named constructor);
instance (every visible label/value, selected index, variant/size, count, state, icons); layout
(axis, fill/hug, order, position); visuals (every exposed/non-default fill, text/icon colour,
typography, spacing, radius, stroke, effect). Unknown required value → `BLOCKED`/`NEEDS_CONTEXT`,
never the example literal or a DS default.

**Placeholders are unresolved data:** `Option 1`, `Option 2`, `Label`, `Tab`, `Home`, `Search`,
`Feed`, `Notif`, `Profile`, `Item` and the like. Allowed only when the Figma instance literally shows
that string.

**Start the call site from the saved Inner snippet and substitute values** — keep every named
argument it carries. A prop left off compiles fine and silently takes the DS default (snippet
`size: UITabSwitchSize.medium`, call site without `size:` → renders `small`).

**Variant from the instance's own props, not the snippet's constructor.** Read the placed
instance's variant/boolean props (`get_design_context` / `get_metadata` on that instance) and pick
the named constructor they select. A progress bar whose instance shows its percent label is
`UIProgressbar(...)`, never `UIProgressbar.noLabel(...)` copied from another instance's snippet.
Colours (fill, track, text) are read per instance too — two bars in one card may differ.

## 6. Discarding a match

Rejecting a rung 1–2 match as "doesn't fit this slot" needs a verified hard dependency, not an
inference from the class's interface or usual location. `PreferredSizeWidget` does not mean
AppBar-only: `UITabBar` placed directly in the body with real data works. Construct the component
with this instance's real values at the target position. Only a genuine dependency counts — e.g. a
param obtainable only from an ancestor, or `DefaultTabController.of(context)` throwing without one.

Confirmed → screen-local widget, note line starting `⚠ DS match discarded:` naming the component
and the exact failing requirement. Under orchestration it goes in the worker report.

## 7. Full constructor and gotchas

Code Connect `props` is a curated subset: it says which component, not which props. Always read the
full constructor from the resolved checkout — `component.meta.yaml` when present, else the widget
source. Never skip this because reading is expensive.

Check [references/gotchas.md](references/gotchas.md) for every matched component; a listed
component's note states an explicit value for every listed prop. A source read that finds another
omitted prop adds a row there.

From the constructor, flag sizing/overflow/alignment/effect props (`isHugging`, `fillWidth`,
`isScrollable`, `wrap`, `expand`, `stretch`, `tabAlignment`, `crossAxisAlignment`, width/size
overrides, `hasShadow`/`hasBorder`/`hasElevation`) and decide each from this instance's Figma
evidence:

- sizing from `get_design_context` (flutter-slice-screen 4d), not a width comparison;
- item count and label length against the available extent (overflow → scrollable/start);
- several instances at different widths → hug by design;
- a boolean effect prop is `true` only when the node itself carries that effect (`DROP_SHADOW`).

Note each non-default value with its evidence.

## 8. Floating placement

Never infer a Flutter slot from bottom position, overlap, shadow or convention. Use
`Scaffold.floatingActionButton` only when all four Figma facts hold:

1. the node is a root-frame sibling, outside the scrollable content subtree;
2. its bounds overlap or sit directly above fixed chrome;
3. the stacking relationship with that chrome is proven;
4. the node itself owns the shadow/elevation.

Then `floatingActionButtonLocation` follows its horizontal anchor (center → `centerFloat`, side →
`startFloat`/`endFloat`), body content gets the clearance the overlay needs, and the render proves
nothing is covered. Note line: `floating <node>: all criteria passed, anchor <x>, clearance <n>`.
Any fact missing → inline in normal section composition.

## 9. Per-instance, per-child, exact identity, style

- **No cross-instance reuse.** Each instance of the same component re-derives every flagged prop
  from its own node.
- **Recurse into nested child instances** (tab items, rows, cells, card children) with their own
  `get_design_context`/`get_code_connect_map` call, down to the last level. The parent call never
  surfaces child props (`UITabBarItem.leftIcon`/`rightIcon`).
- **Exact identity.** Identity comes from the Inner mapping, never resemblance: `UITabSwitch` and
  `UISegmentedSwitch` stay distinct. Note the exact class, variant and state.
- **Every visible child is covered on its own.** A mapped parent does not absorb a badge, label,
  icon or action: use the matching primitive (`UIBadge`, `UILabel` with resolved typography) or
  note the gap.
- **Style from Figma, not the component default.** Fill, text/icon colour, font, line height,
  radius, padding, gap, stroke, shadow — for the node and each covered descendant, and for plain
  containers and page backgrounds — resolve through [tokens.md](../flutter-slice-screen/references/tokens.md)
  and set explicitly. A component with no prop for it → gap.
- No raw Material buttons or `Colors.*` where the DS provides one.

Load metadata only for components present in the node, never the whole catalog.
