# Plan — UX guidelines (from ui-ux-pro-max) in P3 Design

Status: planned, not implemented
Source: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> (MIT), `.claude/skills/ui-ux-pro-max/data/`

## Goal

Stop "AI slop" in Figma generate. GD2 already guards tokens (no hard-coded colour/spacing, Poppins,
props = plan). Slop that still gets through is UX: missing loading/empty/error state, two primary
CTAs, error far from its field, small touch targets, placeholder text, unlabeled fields. Borrow
ui-ux-pro-max's UX knowledge (data only) and apply it inside P3 Design, still routed by
`figma-generate-screen`.

ui-ux-pro-max itself does not touch Figma: it outputs text guidance and UI code. We take its rules,
not its engine or output.

## Scope

| Upstream file | Take? | Used in |
|---|---|---|
| `data/ux-guidelines.csv` | yes, rows for mobile/web app | C1 checklist, GD2 measurable rules, G2 review |
| `data/app-interface.csv` | yes | C1: form / list / detail screen patterns |
| `data/charts.csv` | yes, only when a screen has data/dashboard | C1 |
| `data/stacks/flutter.csv`, `vue.csv` | later | slice phase, separate plan |
| `styles`, `colors`, `typography`, `google-fonts`, `products`, `landing`, `--design-system` | **no** | conflicts with BUMA DS (Foundations, Poppins, V2 components) |
| `scripts/search.py` (BM25) | **no** | ~100–200 rows; `grep` per screen keyword is enough |

## Flow

```text
D0 brief (designer) → inspect REFs
  → C1 component plan
      grep ux-guidelines/app-interface with screen keywords from FSD
      → design.md ## UX Checklist: rule → how met | N/A (why)
  → build (use_figma)
  → GD2 read-back + measurable UX rules:
      touch target ≥ 44, 1 primary CTA per screen, loading/empty/error states present,
      no placeholder text, every field has a label
  → G2 designer review with the same checklist
```

Example lookup (per screen, prints only matching rows):

```bash
grep -i -E 'form|error|validation' references/ux/ux-guidelines.csv
```

## Changes (when implemented)

1. `skills/figma-generate-screen/references/ux/`
   - `ux-guidelines.csv`, `app-interface.csv`, `charts.csv`: copied verbatim, app-relevant rows only.
   - `NOTICE`: upstream copyright + MIT licence text (required by MIT) + source commit SHA.
2. `skills/figma-generate-screen/SKILL.md`: one paragraph — when to grep, `## UX Checklist`,
   which rules join GD2. Rule: BUMA DS and `intent/constitution.md` win over any UX row.
3. `assets/design-template.md`: section `## UX Checklist` (`| Screen | Rule | How met / N/A |`).
4. C1 one-liner: every SCR in Traceability has ≥1 UX Checklist row.
5. `references/workflow.md` + `docs/using-bspace-sdlc.html`: sync; bump minor patch.

No new skill, no new routing row.

## Open decisions

- Which rows to keep: curate during implementation (drop web-only/landing rows).
- Sync policy: manual re-copy on upstream major release; record SHA in `NOTICE`.
- GD2 thresholds (touch target 44 vs 48): confirm with BUMA designer.
- Slice-phase use of `stacks/flutter.csv` / `vue.csv`: separate plan.

## Risks

- Upstream changes do not flow in automatically.
- A UX row can contradict BUMA DS or constitution → BUMA wins, record the deviation in `## Gaps`.
- Checklist bloat: cap to rows matching the screen's keywords; no checklist-for-everything.
