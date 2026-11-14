# __ScreenName__ — Slice Plan

**ID:** __screen_name__
**Figma source:**
**Target repo (standalone):**
**Target feature directory:**

Written before implementation, once component and asset resolution are settled. Reference
`spec.md`'s AC/CM/AS IDs directly — do not restate them in prose.

## Environment checks

| Check | Status | Notes |
| --- | --- | --- |
| Standalone scaffold checked/confirmed (step 1) |  |  |
| `@buma-dev/buma-ui-v2` (or the repo's UI kit version) installed (step 3) |  |  |
| `@buma-dev/styles` tokens wired in the bundler's global SCSS (step 5) |  |  |
| UI-kit plugin + stylesheet installed once; `B<Name>` globals, no deep imports (step 5) |  |  |
| Figma call policy (class/counts, heavy-call attempts, breaker, numeric fallback) |  |  |
| Route registry file identified (skip if routing mode is `none`) |  |  |

## Inventory

Raw `get_metadata` output for the supplied node (SKILL.md step 9) — every descendant id and
name, unfiltered. This table is the fixed ground truth the Component/Asset decisions below
must fully cover, and what the verification step re-diffs against on a fresh `get_metadata`
call.

Layout column: `HORIZONTAL` / `VERTICAL` / `-` per frame's auto-layout axis — verification
asserts each generated flex direction against it.

| Node ID | Name | Layout |
| --- | --- | --- |
|  |  |  |

## Coverage

One row per Inventory node, written live during the per-section loop (SKILL.md steps 11–13).
Every Inventory node appears here exactly once. `Resolution` is a `CM-XX`, an `AS-XX`,
`native-layout` (a plain element/flex wrapper, no component needed), `grouped-into <CM-XX>`
(absorbed by an ancestor's component), or `gap` (justified, developer decides).

`Color` and `Typography` are required for every **visible text node**: the resolved token name
(e.g. `color(text, dark)` / `typography(heading, md)`), never a raw hex/px value. `Source`
records where it came from — `variable` (`get_variable_defs`) or `context`
(`get_design_context`/`get_metadata` style fields), per design-system.md's token-resolution
rules. For a row that is not a visible text node (`native-layout`, `grouped-into`, `gap`, a
hidden node, an icon/image, a pure layout wrapper), write `n/a` in all three columns. A **blank**
cell always means "not resolved yet" and fails
[scripts/validate-slice.sh](../../../scripts/validate-slice.sh).

| Node ID | Resolution | Color | Typography | Source | Justification |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Component decisions

`Source`: `code-connect` (resolved via `get_code_connect_map`) / `design-context`
(`get_design_context` + `B<Name>` match) / `screen-local` (no UI-kit match).

| CM ID | Node ID | Resolution | Source | Decision |
| --- | --- | --- | --- | --- |
| CM-01 |  |  |  |  |

## Asset decisions

`Resolution` is `reused` / `exported` (non-icon, via `download_assets`) / `icon` (resolved
through Code Connect or the UI kit, not exported) / `gap`. `Validated` records the post-download
file check for an exported asset.

| AS ID | Node ID | Resolution | Mode | Folder | Validated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AS-01 |  |  |  |  |  |  |

## Routing

- Mode:
- Proposed entry (path, `name`, lazy `component` import):
- Destination file:
- Insertion point (relative to existing entries):
- Not edited / reason (if mode is `none`, or `auto` fell back to `suggest`):

## Files to create

One line per file, populated at step 10 from step 9's section grouping — not just the two
defaults below. [scripts/validate-slice.sh](../../../scripts/validate-slice.sh) fails if a file
listed here is missing once generated (step 19).

- `src/views/<feature>/__ScreenName__.vue`
- `src/views/<feature>/components/__ScreenName__Content.vue`
- `src/views/<feature>/components/__ScreenName__<SectionName>.vue`
  <!-- repeat one line per direct-child section from step 9, even if there's only one -->

## Progress checklist

Check items off in place (`- [ ]` → `- [x]`) as each is completed. This section is the live
progress artifact — if the slice is interrupted, whoever picks it up next reads it to see
exactly what's left.

- [ ] Environment checks above completed
- [ ] Coverage table has one row per Inventory entry (SKILL.md step 14)
- [ ] Figma heavy-call resolution recorded; breaker-open calls use numeric fallback evidence
- [ ] Placeholder-copy scan clean; unresolved leaf text nodes recorded as gaps
- [ ] Plan reviewed; developer confirmed before implementation
  > Developer's verbatim answer (required — box invalid without it): ""
- [ ] AC-01: implement content state
  <!-- add one AC-XX item per additional state only if it exists in Figma or was requested -->
- [ ] CM-01: implement component
- [ ] AS-01: resolve asset (reuse, or validated non-icon `download_assets` export)
- [ ] Wire routing (skip if routing mode is `none`)
- [ ] Coverage & fidelity check passed (every Inventory row accounted for, text verbatim,
      component props/variants matched, flex directions match the Layout column, no overflow
      at a real viewport)
  > Render screenshot / dev-server check evidence (required — box invalid without it): ``
- [ ] Lint and format changed files with the repo's own scripts
- [ ] Finalize `spec.md` from actual output
