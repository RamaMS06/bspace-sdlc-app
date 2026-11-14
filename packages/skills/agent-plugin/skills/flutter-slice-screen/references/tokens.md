# BUMA Design System tokens

Token names and values live in the resolved DS package and change between versions — read them from
disk, never from memory. The dependency is pinned to the moving `ref: release`, so record the version
read as the `resolved-ref` line in `plan.md` `## Notes`; a token that later disappears then reads as
a version move, not a mistake.

## Locate the catalog

DS root = `rootUri` of `buma_design_system` in `.dart_tool/package_config.json`
([flutter-match-component](../../flutter-match-component/SKILL.md) §1). Read
`lib/src/components/tokens/<category>/tokens.meta.yaml`: `class` (the Dart API, e.g. `UIColor`),
`usage` (copy-paste call sites), `aiHints` (Figma evidence → token), `tokens:` (`{name, value,
description}`). Categories: `color`, `elevations`, `fonts`, `gaps`, `icon`, `margins`, `paddings`,
`radius`, `spacing`, `stroke`. Each `tokens:` list is authoritative and exhaustive.

## Evidence contract

```text
Figma variable/style binding = preferred token identity
Figma resolved paint/typography/spacing value = independent visual evidence
BUMA tokens.meta.yaml + resolved DS checkout = supported Flutter API spelling
```

A Code Connect snippet, component default, screenshot pixel or remembered name is never token
evidence. Per exposed/non-default property: Figma property → variable/style or raw value → catalog
entry → class-qualified API exactly as `usage` shows. Never a raw literal, a primitive guessed from a
hex, or a component default in place of a missing token.

**Geometry is not a token.** Width, height, position, chart bar size, parent-relative offsets come
from the saved `get_design_context` unless the node binds them to a spacing/radius token. Never turn a
measured dimension into a token, never hide an unresolved position behind a spacing token.

## Matching

1. **Category** from the property: fill/text/icon colour → `color`; corner → `radius`;
   gap/padding/margin → `gaps`/`paddings`/`margins`/`spacing`; shadow → `elevations`; font → `fonts`;
   border → `stroke`.
2. **Variable reference first** (`get_variable_defs`):
   - a **code-syntax name** (`UIColor.of(context).text.success`) is the token — use it verbatim, only
     confirm it exists in the catalog. Absent → version mismatch: note it in `## Notes`, fall through
     to value matching;
   - a raw value or no reference → match by value (closest hex/number), then by semantic
     name/description.
3. **Status colours prefer semantic entries** (success, info, warning, danger/error, other named
   states): `background.info`, `text.success` over a closer-hex primitive like `primary500`. Value
   matching only when the category has no semantic entry for that state.
4. **Spelling** — class-qualified as in `usage`: `UIColor.of(context).text.success`, not `#08A94C`
   and not the Light-only static `UIColor.text.success`.
5. **Deprecation** — a token or class marked deprecated (`description`, `@Deprecated`, "use X
   instead") resolves to its replacement (`UIFont`/`UILabelStyle` over `UILabelType`/
   `UITypographies`), even when the deprecated name matches the layer name better.
6. **No match within tolerance** → nearest token plus a gap line in `## Notes`. Never a raw literal,
   never an invented name.
7. **No invented conditional styling.** A value-driven rule ("colour changes past a threshold") needs
   direct evidence: this instance's own paint, the DS component's documented behaviour, or several
   instances in the file showing a clear value→style pattern (then an *inferred rule* line in
   `## Notes`). One static value → render that value.
8. **Each node resolves its own paint.** Call `get_design_context`/`get_variable_defs` per visually
   distinct exposed/non-default node (value text, progress fill, icon, badge); never reuse a
   neighbour's token, even in the same mapped component. Fixed internal styling owned by a DS
   component may be skipped when `component.meta.yaml` documents it. In a repeated section's data
   class, each independently coloured property gets its own field (`valueColor` and `progressColor`,
   never one shared `color`) — instance 1 matching is coincidence, not evidence.

## Spacing, padding, stroke

- **Pick by value, not by layer name.** Figma `gap: 8` / `padding: 8` → the token whose value is 8
  (`SpacingSize.xs`, `UIPadding.all.xs`), checked in `tokens.meta.yaml`; a name that sounds right
  (`sm`) with another value shifts every child.
- **Gaps: `SpacingSize.*` doubles** (`SizedBox(height: SpacingSize.md)`, `spacing:`), not the
  static `UIGap.*` widgets: those are `static final` `SizedBox`es built with `.w`/`.h` once, at the
  first ScreenUtil scale of the isolate — a later screen or test size keeps the old value.
- **Figma stroke inside** (`strokeAlign: INSIDE`, the default for frames) does not take layout
  space: `foregroundDecoration: BoxDecoration(border: …)`, not `decoration` — a `decoration` border
  insets the child by the stroke width and every node inside moves.
- **Text box = the paragraph's line box** (`RenderParagraph.textSize`, line height × lines), as
  Figma's TEXT node measures it; a fixed `SizedBox` around text is only for a Figma fixed-width
  text node.
- Check at width 393: `.sp` grows ~1.09× there while fixed widths stay — the tightest text case.

## Typography: no raw `TextStyle(`

Every text node — including plain text with no DS component (date line, heading, table cell) —
resolves to a `fonts` token; name it, never defer it. `--check` fails any raw `TextStyle(`; item 6's
nearest-token rule applies to typography too.

The style per TEXT node is the `DS` column of `work/spec-<id>.md` (`figma_xml.py spec`); the table
below is only for a node the spec lists under `## Unmatched`.

Pick the token whose size/weight match Figma (size rounded half up); never a deprecated one
(`UIFont.body.xstraSmall` → `extraSmall`, `UIFont.body.medium` → `mediumCompact`).

| Figma | Token |
| --- | --- |
| Bold 12 | `UIFont.body.bold` |
| Medium 12 | `UIFont.body.defaultStyle` |
| Medium 11 | `UIFont.body.small` |
| Medium 14 | `UIFont.body.mediumCompact` |
| SemiBold 12 | `UIFont.subheading.h7` |
| SemiBold 14 | `UIFont.subheading.h6` |
| Bold 16 | `UIFont.subheading.h5` |

Component constructors and props: [flutter-match-component](../../flutter-match-component/SKILL.md) §7 — the resolved
source is ground truth, never an API shape from another version.
