---
name: vue-resolve-assets
description: Resolve non-icon Figma image/illustration assets (raster photos, multi-color/complex vector graphics) into a Vue project using the Figma MCP download_assets tool - reuse-before-export, correct export format, on-disk validation, and inline reference. Excludes icons: a small single-tone glyph that maps to a UI-kit component's icon prop/slot is a component-resolution decision (vue-slice-screen SKILL.md step 11), not an asset export. Callable standalone or from vue-slice-screen step 12.
---

# Resolve Assets (Vue)

Turn a Figma image/illustration layer into a file the target Vue app actually ships, or a
justified gap - never a silently invented path, a leftover temp file, or a rendered
placeholder box standing in for real content.

## Scope: what this skill exports, and what it explicitly does not

This skill handles two node kinds only:

- **Raster image** - a node with an image fill (photo, banner, avatar photo).
- **Illustration vector** - a vector/boolean-group node that is content, not a UI glyph: a
  multi-color graphic, a scene illustration, a logo mark - the kind of node a designer would
  never swap for a different icon at the same call site.

It does **not** handle an **icon**: a small (typically <=32px), usually single-tone/monochrome
vector that sits in a UI-kit component's icon prop/slot (`icon="..."`, a `left-icon`/`prefix`
slot) or functions as a control glyph (chevron, close, check, arrow). Before applying this
skill to any vector node, check whether it is the fill of a resolvable icon prop/slot on the
`B<Name>` component already selected for that section in
[vue-slice-screen/references/design-system.md](../vue-slice-screen/references/design-system.md)
- if so, that is a `CM-XX` component-prop resolution (vue-slice-screen SKILL.md step 11), not an
`AS-XX` asset export, and this skill does not run for it. Only fall through to this skill when
the vector has no such prop/slot target, or when the component/design system genuinely has no
icon system to bind it to (record that as the reason in the `AS-XX` row, so it is clear why the
vector was exported as a file instead of resolved as a component prop).

When in doubt whether a given vector is "icon" or "illustration": a node reused verbatim across
many unrelated screens at a small fixed size is an icon; a node whose specific shape/color is
part of *this* screen's content (not swappable) is an illustration and belongs here.

## 0. Match the export tool to the node's actual type

Before calling `download_assets`, check the node's own fill/type from `get_metadata` - never
guess format from the layer's name:

- Image fill (raster) -> `rawImages`.
- Vector paths / boolean group / illustration -> `svgAssets`.

Exporting a vector as raster (or a raster as SVG) produces a non-scalable or wrong-format asset
even when the response looks superficially fine.

## 1. Reuse before export

Search the target project's `src/assets/` tree (and any `assets/<category>/` subfolders already
established there) for an existing file matching this node by layer name or visual similarity.
When a match exists, reference that existing file directly - do not export a duplicate. Vue has
no central asset-constants manifest to check (unlike a Dart/Flutter `ImageConstant` class); the
filesystem under `src/assets/` is the only source of truth.

## 2. Place exports into an existing category folder

Pick the existing `src/assets/<category>/` (or the repo's own equivalent, e.g. `assets/images/`)
subfolder that already matches the asset's purpose - mirror how the project already groups its
own assets by feature/domain. Save the export there.

**`src/assets/<category>/` (matching the repo's real layout) is the only legal destination.**
Never leave an export at the project root, `src/`, `specs/`, or the current working directory -
including "temporarily": a download step that lands a file outside its category folder must move
it in the same step. Before finishing the per-section pass (vue-slice-screen SKILL.md step 12),
sweep for any stray `*.svg`/`*.png`/`*.jpg` this run created outside `src/assets/` and move or
delete it.

**No matching category exists:** create `src/assets/<category>/`, named after the feature/screen
domain following the project's existing naming pattern. Unlike Flutter's `pubspec.yaml`, Vite/Vue
needs no manifest registration for a new assets subfolder - creating the directory and placing
the file is sufficient; the bundler resolves it by import path at build time.

## 3. Export and validate - a saved file is not a valid asset

Call `download_assets` scoped to the node id, per step 0's format choice. `download_assets` URLs
are temporary: a late or failed fetch can save an error body, an empty file, or an HTML page
under a `.svg`/`.png` name, and the screen then renders a blank/gray box. Immediately after each
download, check the file on disk - never trust the exit code or response alone:

- `.svg` -> file starts with `<svg`/`<?xml` **and** contains at least one drawing element
  (`<path`, `<rect`, `<circle`, `<polygon`, `<line`, `<g`, `<use`, `<image`). One check:
  `head -c 200 <file> | grep -q '<svg\|<?xml' && grep -lq '<path\|<rect\|<circle\|<polygon\|<line\|<g \|<use\|<image' <file>`.
  An `<svg>` wrapper with no drawing element is an empty export - often caused by exporting a
  container/instance wrapper instead of the vector inside it; re-scope `download_assets` to the
  child vector node id and re-check.
- `.png`/`.jpg` -> magic bytes match the extension (not ASCII/HTML/empty) and the file size is
  plausible for the node's dimensions (a few hundred bytes for a full-width illustration means a
  failed fetch).
- Any check fails -> delete the bad file and re-run `download_assets` for that node id (a fresh
  call gets fresh URLs). Still failing after one retry -> record the `AS-XX` row as an explicit
  gap; never wire a component to a file that failed this check, and never leave the bad file on
  disk where step 1's reuse search of a later run would pick it up as if it were valid.

## 4. Reference inline, named traceably

Reference the asset the way the target repo's own screens already do - check an existing
screen/component first:

- Bundler-resolved import: `import heroImage from '@/assets/<category>/hero-banner.svg'` then
  `<img :src="heroImage" />` or bind it into a CSS `background-image`.
- Or a plain `src="/assets/..."` path, if that's this repo's existing convention for static
  assets instead.

Do not invent a fixture file or asset-constants module for it - that pattern belongs to Flutter's
`pubspec.yaml`-driven asset system, not Vite. Name both the exported file on disk and the
imported binding after the Figma layer's own name (kebab-case file, camelCase import binding) -
not a generic or copied name from an unrelated node - so a developer can trace the asset back to
its Figma layer by name alone.

## 5. Never ship a placeholder box in an asset's place

When an image/illustration cannot be resolved (no reuse match, export failed step 3's check
twice, node unreachable), the generated template must **not** substitute a solid
`<div>`/background-color box sized like the asset - that renders as the exact gray/broken box
this rule exists to prevent, and hides the gap until a human looks at the screen. The `AS-XX` row
in `plan.md` records the gap explicitly, it is named at the vue-slice-screen step 15 human gate,
and the template site gets a `<!-- TODO(asset-gap): AS-XX -->` comment at most - visible in
review, never disguised as rendered content.

## 6. Fit and position the resolved asset, not just its path

Read the Figma node's own resolved size and position relative to its immediate parent frame
(already read via `get_metadata`/`get_design_context`) before wiring the asset into markup: does
it fill the parent's width/height, or is it hug-sized; is it flush to an edge/corner, or
centered/floating in normal flow. Reproduce that with matching CSS:

- `object-fit: cover` / `object-fit: contain` when the Figma layer scales to fill its container.
- `position: absolute` + inset values when it's anchored to a specific edge/corner rather than
  participating in normal flow (the parent needs `position: relative`).
- `width: 100%` / `inline-size: 100%` when the Figma layer spans its parent's full width.

An `<img>` wired here also carries `alt` — from the Figma layer's own name, or `alt=""` when the
node is purely decorative and the `AS-XX`/Coverage row says so. See
[vue-slice-screen/references/output-contract.md](../vue-slice-screen/references/output-contract.md)'s
accessibility bullet; the check is mechanical at vue-slice-screen SKILL.md step 19.

Do not leave an `<img>`/inlined SVG at its unconstrained intrinsic size when the Figma layer is
evidently stretched or edge-anchored - that mismatch is a fidelity defect exactly like a wrong
color or wrong text, and fails vue-slice-screen SKILL.md step 19's visual verification.

## 7. Record the row

Add one `AS-XX` row per resolved node to `plan.md`'s Asset table (per
[vue-slice-screen/references/output-contract.md](../vue-slice-screen/references/output-contract.md)):
node id, disposition (`reused` / `exported` / `gap`), file path, and - for a `gap` - the reason
(failed validation twice, unreachable node, or "no icon prop/slot on the resolved component" when
a vector fell through from the icon-exclusion check above).

## Self-check

After exporting, this one-line check must pass for every non-gap `AS-XX` row before the screen is
considered done: the referenced file exists under `src/assets/<category>/`, passes step 3's
content check, and is imported/referenced from exactly the `.vue` file(s) doing the corresponding
`AS-XX` row's work - grep the generated component(s) for the import binding or path string and
confirm a hit.