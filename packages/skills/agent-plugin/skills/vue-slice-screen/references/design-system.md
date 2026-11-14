# BUMA Design System (`@buma-dev/buma-ui-v2`) and tokens (`@buma-dev/styles`)

Two separate packages, two separate jobs: `@buma-dev/buma-ui-v2` ships the Vue **components**;
`@buma-dev/styles` ships the SCSS **tokens** (color, typography, spacing, radius, elevation)
those components — and this app's own plain markup — are built from. Resolve both from the
target project's actual installed version; component props and token names change between
releases, so never match from memory or from an older screen's code.

Some older apps still carry `@buma-dev/buma-ui` (v1, Bootstrap-based) alongside v2. If both are
installed, check the target app's existing `.vue` files for which one is actually in current
use there before picking — don't assume v2 has fully replaced v1 in every app just because it's
newer.

## Resolve the packages on disk first

1. Find the installed version from the target project's lockfile/`package.json`
   (`@buma-dev/buma-ui-v2`, `@buma-dev/styles`).
2. Resolve the actual on-disk package under its `node_modules/@buma-dev/<pkg>` — that's the
   ground truth for this project's pinned version, not a checkout elsewhere on disk.
3. If the target project doesn't have one of these installed yet, that's a scaffold gap, not
   something to work around inline — see the matching scaffold reference's "Minimum required
   packages" ([scaffold-project.md](scaffold-project.md) for a remote,
   [scaffold-shell.md](scaffold-shell.md) for a shell,
   [scaffold-standalone.md](scaffold-standalone.md) for a standalone app, which installs the
   UI-kit itself since no shell supplies it).

## Component catalog and registration

Components are Vue **global components** registered by the package's install plugin, not
individual named exports you import per file:

```ts
// once, in this app's main.ts — already covered if scaffold-standalone.md was followed
// (in an out-of-scope shell/remote repo, the same install lives in its bootloader.ts instead)
import '@buma-dev/buma-ui-v2/dist/style.css'
import bumaUiV2 from '@buma-dev/buma-ui-v2'
app.use(bumaUiV2)
```

```vue
<!-- in any .vue file after that — no per-component import needed -->
<template>
  <BButton label="Save" variant="primary" @click="onSave" />
</template>
```

Registered names are `B<PascalName>` (`BButton`, `BLabel`, `BCardSection`, `BAvatarGroup`, …).
Organized on disk as `atoms/`, `molecules/`, `organisms/` — check that tier order first when
looking for a component (a `BCardSection`-shaped need is almost always an organism, not
something to compose from atoms by hand).

## Resolving a component's real API

Resolve props, variants, and slots from the installed UI-kit package on disk, not from the
component name. Read them in this order, and stop as soon as the API for this node is clear:

1. **`component.meta.yaml` first.** For the matched `B<Name>`, read
   `components/<atoms|molecules|organisms>/<component>/component.meta.yaml` inside the resolved
   package. Use the prop names, enum values, and slots it documents. Do not open
   `<Component>.vue` or `types/*.ts` when this file already states them clearly enough to write
   the call.
2. **Source and types only when `component.meta.yaml` is still ambiguous.** Open them when the
   file is missing, omits the prop, variant, or slot this node needs, or leaves two readings
   that both fit. Then, and only then, read:
   - `components/<atoms|molecules|organisms>/<component>/<Component>.vue` — the component
     itself, including its `<template>` for named and default slots.
   - `components/<atoms|molecules|organisms>/<component>/types/*.ts` — its typed props
     interface (e.g. `ButtonProps`: `variant`, `condition`, `outline`, `disabled`, `small`,
     `block`, …). Variant/condition-style enums are easy to miss when the metadata didn't
     list them.
   - `components/<...>/<component>/stories/*.stories.ts`, if present — real usage examples
     with representative prop combinations.

   Those files settle the ambiguity. They are not the first read.

Match the names and enum values from whichever source settled the API; don't invent a prop
that "sounds right" (e.g. `type="danger"` when the real prop is `condition="reject"`).

The same applies to **slots**, not just props. If `component.meta.yaml` names the slots, use
those. Read the `<template>` only in the ambiguous case above, before assuming a slot exists.
A component can perfectly well have no `left-icon`/`prefix` slot even though its design clearly
shows an icon on the left — in that case the icon goes through the default content slot
alongside the label, not through a slot name that doesn't exist (e.g. `BButtonLink` has no
left-icon slot; icon + text both go in the default slot). A prop/slot that silently doesn't
exist renders nothing and is easy to miss in a screenshot comparison.

### Icon names: the Figma layer name is a hint, not the value

A Figma icon layer's name is authored by the designer and frequently differs from the name
registered in the icon component (`icon-chevron-right` vs `chevron-right`, `ic_search_24` vs
`search`, `Trash` vs `delete`). Passing the Figma name straight into `icon="..."` renders
nothing or a fallback glyph — silent, and invisible in a screenshot comparison.

`BIcon` renders Google Fonts icons. Therefore a matching-looking **Google icon glyph** matters
more than matching a Figma layer's string name. A Figma name is only a search clue.

For every icon prop/slot value, complete this before adding its `CM-XX`/Coverage plan row:

1. Inspect `BIcon`'s resolved package source/meta to identify the actual Google icon family and
   its defaults: Material Icons vs Material Symbols, plus style/axes where supported (`outlined`,
   `rounded`, `sharp`, `FILL`, `wght`, `GRAD`). Do not assume Material Symbols because it is
   newer; use the installed component's rendered font configuration.
2. Enumerate the **real registered icon names** from the resolved UI-kit package on disk —
   `BIcon`'s `component.meta.yaml` enum first, its icon-set source only if that file is ambiguous.
   This is the only valid output vocabulary.
3. Normalize the Figma layer name (`ic_`/`icon-` prefixes, size suffixes such as `_24`/`-16`, and
   style suffixes removed), then use it and the visible glyph's meaning to find candidate names in
   that Google icon family. Do not treat string equality as proof.
4. Visually compare the Figma icon layer with each candidate rendered by the installed `BIcon` at
   the same pixel size, family/style/axis settings, and color. Compare silhouette, direction,
   cut-outs, stroke/filled treatment, and badges — not just a semantic label. Use the Figma node
   render/screenshot and a local temporary render of `BIcon`; temporary comparison files never
   belong in the feature output.
5. Same glyph: record `Figma name → BIcon registered name`, the font family/style, and
   `visual match: yes` in that node's `CM-XX`/Coverage row. Different glyph: reject it and try
   another registered Google icon candidate, even if its name resembles the Figma name.
6. No visual match after the registered candidates are exhausted, or two candidates are visually
   plausible: record a **gap** naming the Figma layer, candidates checked, and mismatch; surface
   it at the human gate (SKILL.md step 15). Never invent, export, or ship an unverified icon name.

### Prefer one composite component over a hand-assembled pattern

Before composing two or more atoms into a recognizable pattern (heading + breadcrumb, avatar +
name + role, label + helper + input), search the molecule/organism tiers for a single component
that already ships that whole pattern and use it instead. A page header built as
`BHeading` + `BBreadcrumb` where `BTitle` exists is a worse match even when it looks identical:
it diverges the moment the design system updates the composite, and it makes two screens that
show the same pattern structurally different.

Also check what the target repo's **existing screens** already use for that same pattern before
picking. If an existing screen solved this pattern with a different component than the one you
just resolved, that is an inconsistency to raise — name both (the existing screen's choice and
this node's Code Connect / `get_design_context` resolution) in `plan.md` and surface it at the
human gate (SKILL.md step 15) for the developer to decide: align the older screen, or accept the
divergence deliberately. Do not silently generate a third variation, and do not modify the older
screen on your own initiative — that's outside this screen's scope.

## Tokens: don't hardcode a color, size, or radius

Never write a raw hex color, a raw `px` spacing/radius value, or a raw `font-weight`/`font-size`
in app SCSS — every one of those has a token. Wire the token package once (usually already done
by scaffold-shell/scaffold-project's SCSS `additionalData` step):

```scss
@import '@buma-dev/styles/src/assets/scss/main.scss';
```

Then in any component's `<style lang="scss" scoped>`, use the token functions instead of
literals:

```scss
.card {
  background: color(neutral, 100);
  color: color(text, dark);
  border-color: color(stroke, success);
  padding: token('padding', null, null, 'md');
  border-radius: token('radius', null, null, 'sm');
}
```

### Where the token catalog lives

`src/assets/scss/global/token.meta.yaml` and `src/assets/scss/utils/token.meta.yaml` inside the
resolved `@buma-dev/styles` package are self-documenting: each entry lists the SCSS
function/class, its signature, params, and real `usage` examples. Categories present in the
current package layout: color, radius, shadow/elevation, spacing (gap/margin/padding),
typography. Treat each file's entries as authoritative for that installed version — a token
name or function signature can change release to release.

### Matching a design value to a token

0. **Auto-resolve from Figma variables first.** Call `get_variable_defs` on the node (cheap, not
   a heavy call — see [figma-heavy-calls.md](figma-heavy-calls.md)). It returns the node's bound
   Figma variables as `{ "<collection>/<name>": "<resolved value>" }` (e.g.
   `"color/text/success": "#1AA053"`). When a returned variable name already matches a
   `token.meta.yaml` entry's name/semantic path, use that token directly and skip steps 1–4 below
   for that value — this is an exact author-intent match, stronger than matching by number or
   hex. Record the matched variable name next to the `CM-XX`/Coverage row. If no variable is
   bound on the node, or the variable name doesn't map to any catalog entry, fall through to step
   1.
1. Pick the category from the property being styled: fill/text/border color → `color`; corner
   radius → `radius`; gap/padding/margin → `spacing` family; shadow → `elevation`; font
   size/weight/line-height → `typography`.
2. Match by semantic name first when the design intent is a UI state (success, danger, warning,
   info) — prefer `color(text, success)`/`color(stroke, danger)` over a primitive palette shade
   that happens to match the same hex, since semantic tokens are the deliberate source of truth
   for state-driven color, not an implementation detail of what they currently resolve to.
3. Otherwise match by closest value in that category's token list.
4. No reasonably close token: use the nearest one and note the gap rather than inventing a new
   token name or falling back to a raw literal.
5. Prefer the universal `token('<category>', ...)` function or the category-specific helper
   (`color()`, `typography()`, …) exactly as shown in that function's own `token.meta.yaml`
   `usage` block — don't hand-roll a `map.get()` lookup against the underlying SCSS maps
   directly; the token functions are the stable public API, the maps are an implementation
   detail that can be restructured between versions.

### Spacing/radius: read the number before picking a token

Never pick a `spacing`/`radius` token from visual impression alone — a screenshot at typical
zoom cannot reliably distinguish 12px from 16px. For every gap/padding/margin/radius value:

1. If `get_variable_defs` returned a spacing/radius variable bound to that node, that name is the
   answer (step 0 above). Otherwise read the exact number from
   `get_metadata`/`get_design_context`'s own layout fields for that node (`itemSpacing`,
   `paddingLeft/Right/Top/Bottom`, `cornerRadius`, or the frame's auto-layout gap) — not the
   screenshot, not the node name, not an estimate from nearby values.
2. Match that number against the resolved `token.meta.yaml` spacing/radius scale exactly. Exact
   match: use it, no note needed. No exact match: use the nearest token per rule 4 above, but
   record the real Figma number, the token chosen, and the delta in `plan.md`'s Coverage row for
   that node — "used `sm`" alone is not enough when the source value was 16, not 12.
3. If `get_metadata`/`get_design_context` didn't return a layout field for that node at all
   (e.g. the call failed or was scoped too high to include it), that node's spacing is not
   resolved yet — re-scope the call to that node directly before guessing. Do not fall back to
   visual estimation as a first resort.

## NEVER

- Hardcode a hex color, `px` spacing/radius, or font value that a token already covers.
- Import an individual `buma-ui-v2` component file directly instead of using the registered
  `B<Name>` global component — the package's public surface is the plugin install, not its
  internal file paths.
- Mix `buma-ui` (v1) and `buma-ui-v2` component usage within the same screen/feature — follow
  whichever one that app's existing code already uses.
- Pass a Figma icon layer name into an `icon` prop without matching it against the icon
  component's enumerated registered names — see "Icon names" above.
- Guess a component's prop names from its rendered appearance — read `component.meta.yaml`
  first, and open `types/*.ts` or the component source only when that file is still ambiguous.
