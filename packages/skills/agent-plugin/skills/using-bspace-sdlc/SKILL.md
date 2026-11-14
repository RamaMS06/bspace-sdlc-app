---
name: using-bspace-sdlc
description: "Entry point for a BUMA feature from idea to shipped UI: brainstorm, intent, DS component plan, Figma design with prototype, Flutter or Vue slice, run-verify, and close. Use when someone starts a feature without a Figma node, asks what is next, or resumes work under an intent feature folder. Routes by files on disk, never memory. A developer with a ready Figma node goes straight to flutter-slice-screen or vue-slice-screen."
---

# Using bspace SDLC — route by artifacts

Every phase writes a file; that file is the routing state. Never ask "where are we?" and never
trust memory: read `intent/<ID>-<slug>/`, run the gate one-liners below, take the **first failing
row** of the routing table, do that phase, then route again. Any session (PM today, developer
tomorrow, another host) resumes the same way.

**Optional pre-P0:** when stakeholder input arrives as mixed files or conversation, run `stakeholder-intake` first. It writes `stakeholder-input/<feature>/intake.md` + `manifest.yaml`; it does not replace P0/P1 or create `intent.md`.

Say one line before acting: `next: <phase> — <reason>`. On a gate fail, list each failing item
with one proposed answer. Whole-workflow map (phases, outputs, gates, folders), for explaining the
flow to a user: [references/workflow.md](references/workflow.md). Rules here win over the map.

**Agent Office (once per session, before the first phase):** if the repo root has no `.office/`
and the user has not declined this session, ask once: "Mau lihat proses ini di Agent Office 3D?".
Yes → run `python3 <plugin-root>/hooks/office_state.py <repo-root> --open`. It opens the 3D page,
and the plugin's PostToolUse hook keeps it live from the files below. No → never ask again this
session. `.office/` is local state — add it to `.gitignore`.
Inside the BSpace SDLC desktop app (`BSPACE_SDLC_APP=1` is set) do not ask and do not open anything:
the Agent Office is always on and shows in the app's Workflow screen; the hook sends every update there.

Phases 1–2 need no repo and no SDK (agent app, browser, Figma). Phase 3+ needs a developer with
the repo and the platform SDK.

## Routing table (top-down, first match wins)

**Hard invariant:** hi-fi Design is unreachable until `sdlc/Blueprint.docx` exists, Gate B passes, and the approved lo-fi wireframe gate passes.
The router evaluates every Blueprint/Data/Gate B/wireframe row before it evaluates any `design.md` row. A missing `design.md` is never evidence that Design is next.

| Condition | Next |
|---|---|
| no `sdlc/project.md` | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — P0 Discover first; create `sdlc/project.md` before any `intent.md` |
| `sdlc/project.md` has an active feature without an approved `intent/<ID>-<slug>/intent.md` | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — P1 Brainstorm; do not evaluate Design |
| `data.md` is missing, or an active feature field lacks `SRC-xx` | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — P2 Data; do not evaluate Design |
| `sdlc/Blueprint.docx` is missing | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — Blueprint fill; do not evaluate Design |
| `sdlc/Blueprint.gate.json` is missing, Gate B is not pass, or Blueprint changed since approval | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — Gate B review/sign-off; do not evaluate wireframe or Design |
| user asks for Blueprint, FSD or FTSD, or any later `blueprint-ftsd` row fails | **REQUIRED SUB-SKILL:** `blueprint-ftsd` — resume the first failing formal-document phase |
| no `intent/<ID>-<slug>/intent.md` | 1 Brainstorm (after P0 Discover) |
| G1 fails | 1 Brainstorm — ask only the failing items |
| Gate B passed and no approved `wireframe.md`, or lo-fi gate fails | 2 **REQUIRED SUB-SKILL:** `wireframe-lofi` — create grayscale wireframe and obtain stakeholder approval |
| wireframe gate passes and no `design.md`, or D0 fails | 3 **REQUIRED SUB-SKILL:** `figma-generate-screen` — D0: ask the designer for references + target file, page, placement |
| wireframe gate passes, D0 passes, C1 fails | 3 `figma-generate-screen` — discovery + component plan |
| wireframe gate passes, C1 passes, G2 fails | 3 `figma-generate-screen` — build at the designer's target, prototype, review |
| per platform in `Platforms:` — flutter: no `spec.md` pinned to this intent, pin stale, or a `score.json` not `pass: true` | 3 **REQUIRED SUB-SKILL:** `flutter-slice-screen --intent intent/<ID>-<slug>/intent.md` |
| vue | 3 manual: "run `vue-slice-screen` with `intent.md` as reference" |
| flutter: `plan.md` has no `run:` line, or `run: BLOCKED` | 4 **REQUIRED SUB-SKILL:** `flutter-run-verify` |
| no `close.md`, or an empty AC cell | 5 Close |
| else | DONE |

When checking a feature folder directly, apply the same invariant: route to `blueprint-ftsd` first, then `wireframe-lofi`, if the project-level Blueprint/Gate B or lo-fi prerequisite is not satisfied. A multi-unit phase (several
screens, several platforms) runs per **REQUIRED SUB-SKILL:** `subagent-driven-development`.

## Gate one-liners (bash/zsh, run in `intent/<ID>-<slug>/`)

```bash
# intent hash: approval lines stripped, so approving never stales it (same rule as validate_output.py)
grep -vE '^(Wireframe|Status|Approved-by):' intent.md | shasum -a 256 | cut -c1-12
# G1 — expect 1 / 1 / 0 / 0
grep -c '^Status: approved' intent.md; grep -c '^Approved-by: .\+ [0-9]\{4\}-' intent.md
grep -c '\[NEEDS CLARIFICATION' intent.md; grep -cE '^- Q-[0-9]+' intent.md
# Wireframe — expect approved status, human date, and target metadata
grep -c '^Status: approved' wireframe.md; grep -c '^Approved-by: .\+ [0-9]\{4\}-' wireframe.md; grep -c '^Figma-file:' wireframe.md
# C1 — expect 1, then no output (intent ACs missing from the component plan)
grep -c '^Components-approved-by: .\+ [0-9]\{4\}-' design.md
comm -23 <(grep -o 'AC-[0-9]\+' intent.md | sort -u) <(grep -o 'AC-[0-9]\+' design.md | sort -u)
# D0, C1 reference — run figma-generate-screen §Gate one-liners in this folder
# G2 — expect 1 / 1
grep -c '^Reviewed-by: .\+ [0-9]\{4\}-' design.md; grep -c '^Metadata-hash: [0-9a-f]\{12\}' design.md
```

Coverage counts only `UI: yes` stories; filter `UI: no` ACs by reading `intent.md`. Model checks
(no grep): every US has ≥1 AC Given/When/Then and `UI: yes|no`; every component row has a value
for every prop; `Metadata-hash` equals the current `get_metadata` hash. Reference mapping is grep-checked (`figma-generate-screen` C1 reference), never model-judged.
ponytail: model checks can miss items — add a script when a real run routes wrongly.

## 1 Brainstorm → `intent.md` (G1)

Template: [assets/intent-template.md](assets/intent-template.md). Questions:
[assets/question-bank.md](assets/question-bank.md) — skip anything a PRD, Figma link,
`intent/constitution.md` or the code already answers.

- One question per message. **No jargon in chat**: ask "if leave balance is 0, what should
  happen?", never "what are the AC?". AC/FR/gate names live only in files.
- Open questions (problem, users, outcome): no recommendation, the user's own words.
- Choices (appetite, platform, approach, design route): first option `(Recommended)` with a
  one-line why from a source (PRD, Figma, constitution, code); no source → options only.
- Scenarios, edge cases, no-gos: propose a list, the user ticks (multi-select).
- Claude Code: `AskUserQuestion`; other hosts: a numbered list.
- Playback in the user's words. User says "agree" → write `Status: approved` and
  `Approved-by: <name> <date>`. The user never has to open a file.
- First intent in a repo: also write `intent/constitution.md` (do's/don'ts that hold for every
  feature) from the user's answers.

## 2 Wireframe → `wireframe.md`

Run **REQUIRED SUB-SKILL:** `wireframe-lofi` first: source = approved Blueprint + intent, output = `wireframe.md` + `wireframe-evidence/` + stakeholder approval.

## 3 Design → `design.md`

After the lo-fi gate passes, run **REQUIRED SUB-SKILL:** `figma-generate-screen` in SDLC mode: source = approved Blueprint/FTSD + approved `wireframe.md`, `design.md` in `intent/<ID>-<slug>/`, catalog `sdlc/figma-reference-catalog.md`. It owns D0, C1, GD2, P1, G2, and their one-liners.

## 4–5 Slice and run-verify

Flutter: invoke `flutter-slice-screen` with `--intent intent/<ID>-<slug>/intent.md` per designed
screen; it pins the intent hash in `spec.md`, maps every AC (or `N/A: <why>`), and its `--check`
fails on a missing AC or a stale pin. Then `flutter-run-verify`. Vue: tell the developer to run
`vue-slice-screen` with `intent.md` as reference (no pin yet).

## 6 Close → `close.md`

`| AC | flutter | vue |`, only the platforms in `Platforms:`; each cell `done`, `N/A: <why>`,
`diverged: <why>` or `manual`. No empty cell. Then DONE.
