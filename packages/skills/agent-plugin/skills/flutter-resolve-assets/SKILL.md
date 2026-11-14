---
name: flutter-resolve-assets
description: Resolve Figma icon, image, and vector layers into real Flutter assets — reuse before export, SVG for vectors and PNG/JPG only for bitmap fills, category folder placement, mandatory on-disk content validation (a saved file is not a valid asset), and the flutter_svg dependency. Use when an icon or image renders as a blank/solid box, when exporting any asset from Figma, when an asset path is wrong, or as flutter-slice-screen's asset step. Never substitutes a font icon by guessed name. Only applies to repos containing `pubspec.yaml`.
---

# Resolve Figma image and SVG assets

**Context modes.** Under `flutter-slice-screen`, each asset is one row in `plan.md` `## Assets`
(`Node | Name | Kind | Path`) and `validate_output.py --check` checks it. A section worker exports
its own section's files into the category its brief names and reports the rows; it never creates a
category or edits `pubspec.yaml` (the orchestrator did that before dispatch). In a multi-frame batch,
`assets/` is shared: a frame worker reports a **Proposed asset exports** row and never downloads,
creates a folder or edits `pubspec.yaml`; the orchestrator deduplicates and writes each export once.
Standalone, there is no `plan.md`: report each resolution inline and ask before any `pubspec.yaml`
change.

## SVG or PNG — decide first

| Figma layer | Kind | File | How |
| --- | --- | --- | --- |
| Vector: icon, illustration, wave, vehicle (hauler, loader), logo, line art | `svg` | `.svg` | `download_assets(node, defaultFormat: "svg")` |
| Bitmap image fill: photo, avatar, screenshot | `raster` | `.png`/`.jpg` | the `rawImages` entry (original bytes) |
| DS icon / Material glyph the DS wraps | `ds` | none (Path `-`) | `UIIcon(...)` |

- **Section spec first.** `figma_xml.py assets work/spec-<id>.md <dest>` downloads every `## Assets`
  URL of the spec (one file per layer name, PNG/SVG verified, expired URL → error). Each spec asset
  needs a `plan.md` `## Assets` row and its keyed widget; a `CustomPaint`/`draw*` stand-in in a
  section whose spec has assets fails `--check`.
- `download_assets`' `export` field is a **render** of the whole node — never an asset, never saved.
- `rawImages` empty ⇒ the node is vector ⇒ SVG. Decide from the node's fill, not its name.
- Save the verbatim `download_assets` response as `work/raw/download_assets-<node-id>.json`.
- **One id, one download.** Call `download_assets` with the full id `get_metadata` printed
  (`I10306:78999;7712:27567`) and write that same id in the row — never the short `7712:27567`
  form. Before calling, Grep `## Assets` and `work/raw/download_assets-*` for the id's last
  segment; a hit means the file exists — reuse it. `--check` fails on two id forms of one layer.

**Never substitute a font icon by guessed name.** A Figma vector is a graphic (stroke, corners,
shape); mapping a layer named "check-circle" to `Icons.check_circle` ships a different icon. Use
`ds` only when the node is an instance of a DS icon component.

## Steps

1. **Reuse before export.** Search the package's asset-constants file (`lib/**/constants/`) and the
   `assets:` folders in `pubspec.yaml`. A match → reference that path; no duplicate export.
2. **Destination: `assets/images/<category>/` only.** Pick the existing category that matches the
   feature. Never save to the package root, `lib/`, `specs/` or cwd, not even temporarily; move any
   stray `*.svg`/`*.png` this run created. Never touch a slice folder's `renders/` (those are
   screenshots, not assets).
3. **No category fits:** create `assets/images/<category>/` and append exactly one entry under
   `flutter: assets:` (additive, no reformat). Unparseable `pubspec.yaml` → report a gap instead.
   Workers under orchestration only propose this.
4. **SVG renderer.** `.svg` assets need `flutter_svg`. If `pubspec.yaml`/`pubspec.lock` lacks it, add
   it with the constraint from one-pass screening
   ([environment.md](../flutter-slice-screen/references/environment.md)) and note it in `## Notes`.
5. **Verify the file on disk — a saved file is not a valid asset.** URLs are temporary; a failed
   fetch saves an error body under an asset name and renders as a solid box.
   - `.svg`: starts with `<svg`/`<?xml` **and** has a drawing element:
     `head -c 200 <file> | grep -q '<svg\|<?xml' && grep -lq '<path\|<rect\|<circle\|<polygon\|<line\|<g \|<use\|<image' <file>`.
     An empty `<svg>` usually means a wrapper node was exported — re-scope to the child vector.
   - `.png`/`.jpg`: `file <path>` reports PNG/JPEG data and the size is plausible for the node.
   - Fail → delete, re-run `download_assets` once (fresh URLs). Still failing → gap in `## Notes`;
     never wire a widget to a bad file or leave it on disk.
6. **Name traceably, reference inline.** File name and local `const` come from the Figma layer name
   (snake/kebab file, camelCase const), used via `SvgPicture.asset` / `Image.asset` in the
   screen-local widget. No fixture file or class.
7. **Never touch the shared asset-constants file.** Report new paths and a suggested constant name
   as a developer follow-up. `pubspec.yaml` (step 3/4) is the only edit outside the feature.
8. **No placeholder box.** An unresolved asset never becomes a sized `Container`/`ColoredBox`/
   `Placeholder`. Record the gap in `## Notes`, name it in the final report, and leave
   `// TODO(asset-gap): <node-id>` at the widget site.
9. **Fit and position.** Read the node's size and placement against its parent from the saved
   metadata: fill → `BoxFit.cover`/`fill` or `width: double.infinity`; edge-anchored →
   `Stack`/`Positioned`; hug → its integer size. An asset at its unconstrained intrinsic size when
   Figma stretches or anchors it is a fidelity defect.
