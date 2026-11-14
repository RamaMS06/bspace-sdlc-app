---
name: figma-generate-screen
description: "Design or generate any BUMA screen in Figma with the BUMA Design System — from an FSD/Blueprint, an intent.md, or a short brief when no FSD exists. The designer picks the references and where the frames go (file, page, position); the AI never creates a page or browses the workspace on its own. Gates D0 (brief + target), C1 (component plan + reference mapping), GD2 (DS read-back), P1 (prototype), G2 (designer review). Use for 'buat screen di Figma', 'generate design', 'design this feature', or when using-bspace-sdlc routes to Design. Output: design.md + design-evidence/ + Figma frames; hand-off to flutter-slice-screen or vue-slice-screen."
---

# Figma generate screen — BUMA DS, designer-led

Standalone or called by `using-bspace-sdlc` (P3 Design). In SDLC mode, approved `wireframe.md` is a prerequisite; standalone mode may use a supplied lo-fi brief.
Templates: [assets/design-template.md](assets/design-template.md),
[assets/figma-reference-catalog-template.md](assets/figma-reference-catalog-template.md). Libraries,
frame rule, props, prototype: [references/figma-libraries.md](references/figma-libraries.md).

Ask in plain words, one topic per message, recommendation first. Claude Code: `AskUserQuestion`;
other hosts: a numbered list. Never write to Figma without the designer's explicit OK.

## Where design.md lives

- SDLC project (`sdlc/` exists): `intent/<ID>-<slug>/design.md`, catalog `sdlc/figma-reference-catalog.md`.
- Standalone: `design/<slug>/design.md`, catalog `design/figma-reference-catalog.md` — or a folder the
  user names. Evidence always next to `design.md` in `design-evidence/`.

Gate one-liners run in the folder of `design.md`; set `C` to the catalog path first.

## 0 Intake — what is the source?

Ask: "Ada FSD/Blueprint untuk screen ini?" Check disk first (`sdlc/FTSD.md`, `sdlc/Blueprint.md`,
`intent/*/intent.md`) and offer what exists as the first option.

| Source | Read | Traceability `Source` column |
|---|---|---|
| FTSD / Blueprint | `FTSD.md` / `Blueprint.md` screen cards (SCR-xx, fields, BR, AC) | `FSD SCR-xx` |
| approved lo-fi | `wireframe.md` screen/state/flow inventory | `wireframe SCR-xx` |
| intent only | `intent.md` US/AC | `intent AC-xx` |
| none | ask a brief (below) → `## Screen Brief` | `brief SCR-xx` |

Brief without FSD (one message per topic): screen purpose; user/persona; platform (mobile 393 /
web); data and fields shown or entered; actions and where each goes; states needed (loading, empty,
error, disabled, success); constraints or do/don't. Number screens `SCR-01…` yourself. Playback →
designer says OK → `Brief-approved-by: <name> <date>`. Any screen is fine: the brief customizes it.

**Called by `using-bspace-sdlc`:** the router has already enforced Blueprint Gate B and the approved lo-fi wireframe; read `wireframe.md` for screen/state/flow structure, then use the approved Blueprint/FTSD for rules and fields. **Standalone:** no Blueprint gate; use a supplied wireframe when available.

## D0 Reference brief + target (designer gate, before any Figma read)

The designer decides references and placement, not the AI. Per screen ask:

1. **References:** "For SCR-01 Clock in: which Figma frames should I follow, what to take from each
   (header, layout, card, background, image), and what to avoid?" Offer catalog REFs, recommendation
   first. Several per screen are fine. External inspiration (Pinterest, Dribbble) = URL + the
   designer's note only; never fetched or copied. Tip: copy chosen frames to a `References` page.
2. **Target file:** "Which Figma file do the new frames go in?" → URL `figma.com/design/<fileKey>/…`.
3. **Target page:** "Which page?" → an existing page (URL with `node-id` of the page or a node on
   it), or a **new page whose name the designer gives**. Never create or pick a page yourself; there
   is no default page.
4. **Placement:** "Where on that page?" → beside a frame/section (URL with `node-id`), inside a
   section, or a new section with a name the designer gives.

Write `## Reference Brief`, `Target-file:`, `Target-page:`, `Target-placement:`, add new frames to
the catalog as `REF-xx`, and only after the designer confirms: `Reference-brief-by: <designer> <date>`.
Open only URLs from the brief and catalog — no workspace browsing, no searching other files.

**Revisions are expected.** A changed reference or target → edit that row/line, re-date
`Reference-brief-by`, inspect only new or changed REFs (reuse `design-evidence/`), redo C1 only for
screens whose component choices change.

```text
Source (FSD | intent | brief) + D0 brief/target (designer) + catalog
 ├─ exact approved node ─────────────► A. EXISTING / REUSE
 ├─ approved REF candidate ──────────► A. EXISTING / ADAPT
 ├─ no suitable REF → approve pattern ► B. GENERATE
 └─ no exact file/node ──────────────► STOP: ask for Figma frame URL
```

## Gate one-liners (bash/zsh, in the folder of `design.md`)

```bash
C=../../sdlc/figma-reference-catalog.md   # standalone: C=../figma-reference-catalog.md
# t: data rows of a design.md table section
t() { awk -F'|' -v h="## $1" '$0==h{f=1;next} /^## /{f=0} f&&/^\|/&&$2!~/^[ :-]*$/' design.md | sed 1d; }
# D0 — expect 1, then no output
grep -c '^Reference-brief-by: .\+ [0-9]\{4\}-' design.md
grep -q '^Target-file: https://[^<]*figma\.com/design/' design.md || echo 'missing Target-file'
grep -q '^Input: brief' design.md && ! grep -q '^Brief-approved-by: .\+ [0-9]\{4\}-' design.md && echo 'brief without approval'
grep -q '^Target-page: .\+' design.md && ! grep -q '^Target-page: *<' design.md || echo 'missing Target-page'
grep -q '^Target-placement: .\+' design.md && ! grep -q '^Target-placement: *<' design.md || echo 'missing Target-placement'
t 'Reference Brief' | grep -q . || echo 'empty Reference Brief'
t 'Reference Brief' | awk -F'|' '$2!~/SCR-[0-9]/||$3!~/figma\.com\/design\/[^ |]*node-id=|new-pattern/'
# C1 — expect 1, then no output (SCR-xx/AC-xx of the source missing from the plan)
grep -c '^Components-approved-by: .\+ [0-9]\{4\}-' design.md
# C1 reference — expect no output
test -s $C || echo "missing $C"
t 'Traceability' | grep -q . || echo 'empty Traceability'
t 'Traceability' | awk -F'|' '$2!~/FSD|intent|brief/||$5!~/SCR-[0-9]/||$6!~/REF-[0-9]|new-pattern/||$7!~/reuse|adapt|compose|new-pattern/'
t 'Reference Inspection' | awk -F'|' '$3!~/[A-Za-z0-9]{10}/||$4!~/[0-9]+[:-][0-9]+/||$7~/^ *(TBD)? *$/||$8~/^ *(TBD)? *$/||$9~/^ *(TBD)? *$/'
comm -23 <(t 'Traceability' | grep -o 'REF-[0-9]\+' | sort -u) <(t 'Reference Inspection' | grep -o 'REF-[0-9]\+' | sort -u)
comm -23 <(grep -o 'REF-[0-9]\+' design.md | sort -u) <(grep -o 'REF-[0-9]\+' $C 2>/dev/null | sort -u)
t 'Traceability' | grep -q new-pattern && ! grep -q '^New-pattern-approved-by: .\+ [0-9]\{4\}-' design.md && echo 'new-pattern without approval'
# G2 — expect 1 / 1
grep -c '^Reviewed-by: .\+ [0-9]\{4\}-' design.md; grep -c '^Metadata-hash: [0-9a-f]\{12\}' design.md
```

SDLC mode also runs the router's AC coverage check (`using-bspace-sdlc` §Gate one-liners). Reference mapping is grep-checked, never model-judged: a design
that skipped the brief or catalog fails even if the user said OK.

## A. Existing / reference

Per screen × state: `get_metadata` (node exists, root width per the frame rule), one
`get_screenshot`, `get_code_connect_map`, and visual inspection of frame, safe area, layout,
background variable/style, image/asset source, typography, components, prototype. Save evidence in
`design-evidence/`; fill `## Traceability` and `## Reference Inspection` before `## Components`.
Designer-made defects stay warnings in `## Gaps`; missing evidence, missing mapping, unknown
background/image source, or an unapproved new pattern blocks C1.

## B. Generate

Before any write, all of: D0 passed (target file, page, placement confirmed); designer OK to write
(outward-facing); if `Target-page` is a new page, the designer OKs creating it with that exact name;
every BUMA library enabled in the file (`get_libraries`); Figma **remote** MCP (`use_figma` is not on
the desktop MCP). Load the Figma `figma-use` and `figma-generate-design` skills first; BUMA rules in
figma-libraries.md win.

1. **Discovery (read-only).** Source → brief URLs → `create_session` → `get_libraries` → per
   element, `search_design_system` (BUMA libraries only) → each candidate's props (figma-libraries.md
   §Reading props) → Code Connect → inventory screens on the target page (frame width, header, CTA,
   fields, lists, states). No writes.
2. **Component plan.** `## Components`: one row per element × screen/state, with component key, a
   value for **every** prop, why, Code Connect widget, reference node. Pick values per
   figma-libraries.md §Picking a prop value. `## Flows` from each AC's (or brief action's) When → Then.
   Ask what no source answers, batched per screen, recommendation first ("Main button: Primary,
   Medium (Recommended — 9 of 11 screens use it). OK, or Secondary / Large?").
   **C1:** every screen maps to its source and an exact REF or approved `new-pattern`; frame/safe
   area, background, image/asset source, states and all props recorded; every row has a component
   key or approved `local (why)`; the one-liners print nothing. Designer OK →
   `Components-approved-by: <name> <date>`. Nothing is written to Figma before C1.
3. **Build** with `use_figma` at `Target-page` + `Target-placement` only, never editing or moving an
   existing node: wrapper auto-layout frame (frame rule) starting with a `Status Bar - M` instance →
   DS instances in plan order → `setProperties` exactly as the plan row → bound variables → DS text
   styles → icons by instance swap; return every node id into the `Node` column.
   **GD2:** read-back → `design-check.json`: 0 hard-coded colour/spacing, 0 text without DS style,
   0 detached instance, 100% Poppins, 0 "Title"/"Button"/"Lorem", 0 full-UI raster, every
   instance's props = its plan row. Fail → fix that node.
4. **Prototype** per `## Flows` (figma-libraries.md §Prototype): navigate, open overlay, back,
   change to; flow start on the first screen.
   **P1:** every action that moves the user has a `## Flows` row and a reaction, read back.
5. **Screenshot** once; one targeted fix at most.
   **GD3:** designer review, mandatory, including a prototype click-through. Designer OK →
   `Reviewed-by: <designer> <date>` and `Metadata-hash:` (`shasum -a 256` of the saved
   `get_metadata` output, 12 chars). Revise → step 3 (or step 2 if a component choice changes,
   which needs C1 again).

**G2 blocks** on: no review, `Metadata-hash` ≠ current `get_metadata` (stale → review again),
invalid node or root width, visual defect (clipped text, overlap, wrong variant), a GD2 or P1
failure. Expect a DS-compliant junior–mid draft; the designer polishes.

## Hand-off

G2 pass → SDLC mode: back to `using-bspace-sdlc` (FTSD next). Standalone: the frames' node URLs go
to `flutter-slice-screen` or `vue-slice-screen` when a developer is ready.
