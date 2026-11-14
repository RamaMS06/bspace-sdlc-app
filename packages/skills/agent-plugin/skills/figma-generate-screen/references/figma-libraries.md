# BUMA Figma libraries, frame rule, write rules

## Libraries — the only source for generated designs

| Library | fileKey | Link |
|---|---|---|
| Bspace Design System V2 (components) | `HIHSBFb6tatYWQYl2LudlV` | https://www.figma.com/design/HIHSBFb6tatYWQYl2LudlV/Bspace-Design-System-V2?node-id=10-236 |
| Foundations (variables, text/effect styles) | `ULzzM260MtOJNxjuhbmxHc` | https://www.figma.com/design/ULzzM260MtOJNxjuhbmxHc/Foundations?node-id=162-1532 |
| Icon | `EFRs93Q9rAixMNcyXiQJgm` | https://www.figma.com/design/EFRs93Q9rAixMNcyXiQJgm/Icon?node-id=147-2 |

DS V2 itself subscribes 4 more team libraries, also in scope: **Atoms / Molecule / Organisms /
Patterns Components V.2**. Not in scope unless the design team says so: `DSV2 - BPS - Mobile`,
`Wireframe Kit`.

Library keys (`lk-…`) are resolved at run time by name from `get_libraries`, never hard-coded.

**A missing library is not fixable by the agent**: no MCP tool enables a library in a file. Stop,
ask the user to enable it in Figma (Assets → Libraries), then run `get_libraries` again. Never fall
back to primitives (raw rectangles, raw hex, raw text).

## Frame rule (first match wins)

1. `intent.md` `Design: frame <W>×<H>`.
2. Target file convention: the most common root width of its existing mobile screens (read-only
   inventory).
3. Preset:

| Platform | Frame | Height |
|---|---|---|
| Flutter mobile | 393 × 852 | 852 for a full screen; taller content → hug, `Scroll: yes` in `design.md` |
| Flutter tablet | 834 × 1194 | only when the intent says tablet |
| Section/component | screen width − padding (e.g. 361) | hug |
| Vue web | 1440 × 1024 | — |

393 is the DS mobile width: DS V2 ships component `Status Bar - M` 393×44 and no device template
frame. A generated mobile screen is a 393-wide frame that starts with a `Status Bar - M` instance.
The root width becomes `frameWidth` (= `designSize`) in flutter-slice-screen's harness, so `.sp`
stays 1:1.

## Reading props

Every DS component set declares its props in `componentPropertyDefinitions`: VARIANT (options such
as Type, Size, State), BOOLEAN (Show icon …), TEXT (label), INSTANCE_SWAP (icon, with preferred
values). Read them with a read-only `use_figma` call, never a write:

```js
const set = await figma.importComponentSetByKeyAsync(KEY);
return Object.entries(set.componentPropertyDefinitions).map(([name, d]) =>
  ({ name, type: d.type, default: d.defaultValue, options: d.variantOptions ?? null }));
```

A plain component (no set) uses `importComponentByKeyAsync`. Fallback: `get_design_context` on the
DS node. Only listed options are valid plan values. ponytail: unverified on BUMA files (live check
2 of the plan); fix the snippet after the first real read.

## Picking a prop value

First source that answers wins; write it in the `Why` column:

1. The intent: an AC, a constraint, `intent/constitution.md`.
2. DS V2 usage notes next to the component (do/don't), when the file has them.
3. Target file convention from the inventory ("9 of 11 screens: main CTA = Primary, Medium").
4. Code Connect: a value the Flutter widget cannot express is not allowed.
5. Nothing answers → ask the user, options with the recommended one first.

Rules: every prop explicit, no silent default; TEXT props = intent copy verbatim; icons by
INSTANCE_SWAP from the Icon library; one primary CTA per screen; an intent state (loading, empty,
error, disabled) is a variant value, never a new drawing; no DS match → `local (why)`, only with
user OK.

## Prototype

Set with `use_figma` after the build, one reaction per `## Flows` row, on the row's node:

| Action | Plugin API reaction action |
|---|---|
| navigate | `{ type: "NODE", destinationId, navigation: "NAVIGATE" }` |
| open overlay (bottom / center) | `navigation: "OVERLAY"`; the overlay frame sets `overlayPositionType` |
| back | `{ type: "BACK" }` |
| change to `<variant>` | `navigation: "CHANGE_TO"`, destination = the variant; only when the DS component is interactive |

Trigger `ON_CLICK` (tap) unless the AC says otherwise. Add a flow start
(`page.flowStartingPoints`) on the first screen. Read reactions back for P1. ponytail: action shapes
follow the Plugin API docs, unverified on BUMA files (live check 4); fix after the first real run.

## BUMA overrides to Figma `figma-use` / `figma-generate-design`

- Write only at the designer's `Target-page` + `Target-placement` (D0); never pick or create a page
  yourself; never edit or move an existing node.
- Components, variables, text/effect styles and icons only from the libraries above.
- Font: Poppins, through DS text styles only.
- Props: exactly the approved `## Components` row; nothing is written before C1.
- Copy: the intent strings verbatim; no "Title", "Button", "Lorem".
- No full-UI raster images.

`use_figma` runs Figma Plugin API JavaScript in the file: top-level `await`/`return`; no state
across calls (return node ids); load the font before setting text; colours 0–1; `resize()` before
`HUG`/`FILL`; `FILL` only after `appendChild`; top-level frame away from (0,0); one page switch per
call. `html_to_figma` and `generate_figma_design` are not used.
