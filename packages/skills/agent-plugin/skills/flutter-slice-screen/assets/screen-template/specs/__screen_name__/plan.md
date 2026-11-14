# __ScreenName__ — Slice Plan

**ID:** __screen_name__
**Figma:** <file URL> · node <id>
**DS package:** <path from pubspec.lock>

<!-- Short note, not a ledger. Grep a heading instead of reading this file whole.
     `validate_output.py --check` reads the Sections, Assets and Evidence tables. -->

## Sections

<!-- One row per visible section. Widget file is relative to presentation/. -->

| Node | Name | Widget file |
| --- | --- | --- |
|  |  | widgets/__screen_name___<section>.dart |

## Assets

<!-- Kind: svg (vector: icon, illustration, wave, vehicle) | raster (photo/bitmap from
     rawImages) | ds (DS icon or DS-shipped asset; Path `-`). The `export` PNG is never an asset. -->

| Node | Name | Kind | Path |
| --- | --- | --- | --- |

## Evidence

<!-- Every value the render pair cannot show: data, behaviour (tap, drag, states), variant picks.
     Source = node id + field (get_metadata/get_design_context), variant or prototype. No source →
     NEEDS_CONTEXT, never a guess. A chart needs a `data <chart-node-id>` row. -->

| Property | Value | Source |
| --- | --- | --- |

## Notes

- target: <feature dir> · routing: <mode> → <registry file>
- resolved-ref:
- harness:
- DS components used:
- DS API cheat-sheet (write once, reuse; never re-grep pub-cache):
- Decisions:
<!-- - mask <node-id>: <why> · - reference <node-id>: <source path>[:line] · - chart <node-id>: <type> · <series × points> · <widget | pattern>[ · tooltip] · - run: PASS <device> | skipped (no device) -->
- Gaps:
