---
name: wireframe-lofi
description: "Create a grayscale, structure-first wireframe before hi-fi Figma: map approved Blueprint/intent screens, fields, states, flows, and CTAs; record stakeholder approval in wireframe.md. Use when analyst or UX needs alignment before designer work."
---

# Lo-fi wireframe — structure before visual

Required SDLC hand-off between Blueprint Gate B and hi-fi design.

## Output

```text
intent/<ID>-<slug>/
├── wireframe.md
└── wireframe-evidence/
```

Figma holds the grayscale frames. `wireframe.md` records traceability, target location, review state, and approval.

## Input

- approved `sdlc/Blueprint.md` after Gate B;
- approved `intent/<ID>-<slug>/intent.md`;
- `sdlc/data.md` when fields or source systems affect the screen;
- target Figma file, page, and placement supplied by analyst/UX.

Missing or stale Gate B blocks this skill; return to `blueprint-ftsd`.

## Rules

- grayscale and neutral placeholders only;
- no brand colors, final typography, production icons, photos, gradients, or visual polish;
- show sourced labels and representative data; never invent policy values;
- one frame per `SCR-xx` and meaningful state;
- make hierarchy, fields, states, CTA order, navigation, and overlays explicit;
- annotate decisions with `US-`, `AC-`, `BR-`, or `SRC-` IDs;
- never silently truncate text;
- do not choose hi-fi components or tokens; designer owns that mapping.

## Procedure

1. Read Blueprint, intent, data, and existing evidence.
2. Inventory screens and states from `SCR-xx`, flows, ACs, and BRs.
3. Ask for target Figma file, page, placement, and explicit permission.
4. Draw grayscale frames in Figma.
5. Write `wireframe.md` from `assets/wireframe-template.md`.
6. Save review evidence in `wireframe-evidence/`.
7. Present the flow. Record human `Approved-by: <name> <YYYY-MM-DD>` only after explicit approval.
8. Run the checker and hand off to `figma-generate-screen`.

## Gate

```bash
python3 <plugin-root>/skills/wireframe-lofi/scripts/check_wireframe.py .
```

## Handoff

```text
Input:  approved Blueprint + intent + data + target Figma location
Output: wireframe.md + wireframe-evidence/ + grayscale Figma frames
Owner:  Analyst / UX
Status: draft | needs-clarification | approved | blocked
Next:   figma-generate-screen
Gate:   stakeholder approval, traceability, evidence, no blocker
```
