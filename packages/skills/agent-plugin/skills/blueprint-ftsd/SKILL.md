---
name: blueprint-ftsd
description: "Scaffold and gate BUMA Blueprint (FSD) and FTSD Word documents from a brainstorm: stakeholder discovery → user stories → SAP data sources → Blueprint.docx (sign off) → FTSD.docx per screen (functional approval) → API contract openapi.yaml (technical approval). Use when an analyst starts a project's Blueprint or FTSD, asks for the next document step, revises an approved docx, or needs the API contract for FE/BE. Works in Claude Code, Claude.ai and ChatGPT (needs Python code execution). The AI drafts once; analyst, designer, FE, BE and QA own the docx in Word; only humans approve."
---

# Blueprint & FTSD — scaffold once, humans own the docx

## Satu project workspace

Semua artefak satu project memakai satu folder/repo yang sama. Bukan satu dokumen tunggal:

```text
<project-root>/
├── sdlc/
│   ├── project.md                 # P0 Discover; wajib dibuat pertama
│   ├── data.md                    # P2 Data
│   ├── Blueprint.docx             # editable source; setelah v0.01 sumber utama
│   ├── Blueprint.md               # snapshot dari Blueprint.docx; jangan edit manual
│   ├── Blueprint.media/           # gambar hasil snapshot
│   ├── Blueprint.pdf              # export/reference untuk stakeholder; bukan source
│   ├── FTSD.docx                 # editable source; setelah v0.01 sumber utama
│   ├── FTSD.md                   # snapshot dari FTSD.docx; jangan edit manual
│   ├── FTSD.media/               # gambar hasil snapshot
│   ├── FTSD.pdf                  # export/reference untuk stakeholder; bukan source
│   ├── openapi.yaml              # API contract; BE owns after draft
│   ├── figma-reference-catalog.md # approved Figma refs; exact fileKey + nodeId
│   └── references/               # template PDF, SAP xlsx, PRD, links; read-only inputs
└── intent/
    ├── constitution.md
    └── <ID>-<slug>/
        ├── intent.md              # P1 Brainstorm; one per feature/stage
        ├── wireframe.md           # lo-fi structure + stakeholder approval
        ├── wireframe-evidence/    # lo-fi screenshots/review notes
        ├── design.md              # P3 Design (figma-generate-screen); Traceability + Reference Inspection
        └── design-evidence/       # P3 screenshots/metadata per REF
```

`design.md` tetap berada di `intent/<ID>-<slug>/design.md`, karena desain terikat pada feature.
Dengan layout ini analyst dapat bekerja di Word/Excel/Figma, chat dapat meng-upload satu project
ZIP, dan Claude Code dapat membaca tree yang sama. Nama file wajib dipertahankan agar router dan
gate dapat menemukan status.

### Source vs export

- Input template `[Blueprint] ...pdf` dan `[FTSD] ...docx` disimpan di `sdlc/references/`.
- Mapper memakai template BUMA sekali untuk menghasilkan `Blueprint.docx`/`FTSD.docx`.
- Analyst/designer/FE/BE mengedit **docx**, bukan PDF dan bukan snapshot `.md`.
- PDF dibuat setelah review sebagai salinan baca/share. Jika PDF dan docx berbeda, docx menang.
- Brainstorm tidak wajib docx/PDF: `intent.md` adalah source. Jika stakeholder butuh Word/PDF,
  simpan export di `sdlc/references/` atau `sdlc/exports/`, jangan jadikan router source.

| File | Who writes | Notes |
|---|---|---|
| `project.md`, `data.md` | AI, from Q&A | working notes, never sent to stakeholders |
| `Blueprint.docx`, `FTSD.docx` | AI once (`fill`), then humans in Word | **source of truth** after v0.01 |
| `Blueprint.md`, `FTSD.md` + `*.media/` | `snapshot` | what the AI reads; commit it so PR diffs are readable |
| `*.gate.json` | `gate` | approved hash per gate; commit it |
| `openapi.yaml` | AI draft, then BE | API contract detail; FTSD §Technical keeps the summary |

Script: `python3 scripts/bspace_docx.py <cmd>` (stdlib only). Self-check: `python3 scripts/test_bspace_docx.py`.

## Rules

1. Never regenerate a docx. `fill` refuses to overwrite. After v0.01 every AI change is a Word
   Comment (`comment --find <text> --text <proposal citing the ID>`); the owner accepts in Word.
2. Before reading or answering about a doc, run `snapshot` and read the `.md`. Never trust an older snapshot.
3. Never write a date, a name in an approval row, or `Approved-by`. A gate passes only on human-typed dates.
4. Keep IDs: US- (story), BR- (rule), AR- (authorization), SRC- (data source), SCR- (screen),
   TC- (test), API- (endpoint). Every row that depends on another cites its ID; that is the impact map.
5. Write only placeholders or empty cells. Unknown → leave the cell empty and list it; never invent
   SAP tables, approvers or limits.
6. Questions follow `using-bspace-sdlc` §1: one per message, plain words, recommendation first for
   choices. Claude Code: `AskUserQuestion`; other hosts: a numbered list.

## Route (first failing row wins)

| Condition | Phase |
|---|---|
| no `sdlc/project.md` | P0 Discover — required before any `intent.md` |
| a feature in `project.md` has no approved intent (G1) | P1 Brainstorm — `using-bspace-sdlc` §1 per feature |
| `data.md` is missing, or a field has no `SRC-` | P2 Data |
| no `Blueprint.docx` | Blueprint fill — **P3 Design is blocked** |
| Blueprint Gate B missing, failed, or stale | Blueprint review — "waiting for <names>" or revision; **P3 Design is blocked** |
| Blueprint Gate B passes and approved `wireframe.md` is missing or fails | Lo-fi wireframe — **REQUIRED SUB-SKILL:** `wireframe-lofi`; **P3 Design is blocked** |
| Wireframe gate passes and design not reviewed (G2) | P3 Design — **REQUIRED SUB-SKILL:** `figma-generate-screen` (SDLC mode) |
| no `FTSD.docx` | FTSD fill |
| Gate F1 fails | FTSD functional review |
| no `openapi.yaml`, contract or Gate F2 fails | P4b API |
| else | hand-off: back to `using-bspace-sdlc` (3 Slice onward; FE mocks `openapi.yaml`), BE builds from Source/Logic |

Gates (run in `sdlc/`; exit 0 = pass, JSON lists `problems`):

```bash
python3 <skill>/scripts/bspace_docx.py gate Blueprint.docx --name B --table '^Document Sign Off'
python3 <skill>/scripts/bspace_docx.py gate FTSD.docx --name F1 --table '^Functional Approval' --hash-skip '^#+ (Technical|Approval)'
python3 <skill>/scripts/bspace_docx.py contract FTSD.md openapi.yaml
python3 <skill>/scripts/bspace_docx.py gate FTSD.docx --name F2 --table '^Technical Approval' --hash-skip '^#+ Approval'
```

A gate records the content hash on pass. Content changed later with the same dates → fails
"changed since approval": the owner re-dates. A technical-only edit stales F2, not F1.

## P0 Discover → `project.md`

Ask: project name + abbreviation, business problem, stakeholders per stream (name, position:
these become Sign Off rows), features/stages, in/out of scope, systems touched (SAP module, DW),
assumptions, reference docs. Write `project.md` with `## Stakeholders`, `## Features` (one line
per feature → its `intent/<ID>-<slug>/`), `## Scope`, `## Integration`, `## Assumptions`.

## P2 Data → `data.md`

From each intent's fields: `| SRC-xx | Field(s) | System | View/Table | Key | Refresh | Owner |`.
The AI lists what each screen needs; BE/data engineer fills System → Refresh. An existing
data-source sheet (e.g. "Data Source <project>-SAP.xlsx"): ask the user to export or paste it.

## Blueprint fill

1. Copy [assets/blueprint.md](assets/blueprint.md) to `sdlc/blueprint.draft.md`. Fill from
   `project.md` and intents: Sign Off rows = stakeholders (Date empty), Story Index = every US-,
   Process Characteristics per stage, role matrices (single source; FTSD links, never copies).
2. `fill --template assets/buma-template.docx --md sdlc/blueprint.draft.md --out sdlc/Blueprint.docx`,
   then delete the draft md. Hand over: "open in Word, right-click the TOC → Update Field, edit freely
   (images, wording), send for sign off".
3. The template carries BUMA styles, header logos and page setup. A project with its own template:
   pass that docx to `--template` (its body is discarded, its styles/header kept).

## FTSD fill

Needs Gate B pass, approved `wireframe.md`, and G2 (Figma reviewed). From `Blueprint.md`, intents, `wireframe.md`, `design.md`, `data.md`:

1. Copy [assets/ftsd.md](assets/ftsd.md); set `Based-on: blueprint@<B hash>`.
2. One `## SCR-xx <screen>` block per designed screen: US-, path, persona, pre-requisite, mockup =
   Figma node link, BR- rules, field table (Type(Len) from the DS component, Source = SRC-, Logic =
   BR-), TC- rows from each AC Given/When/Then.
3. §Technical: Data Source Catalog from `data.md`; API Contract rows drafted per screen action
   (list, detail, draft, submit, approval) marked for BE to confirm.
4. `fill` → `FTSD.docx`. Functional Approval = analyst + user; Technical Approval = BE + FE lead.

## P4b API → `openapi.yaml`

After F1. Start from [assets/openapi.yaml](assets/openapi.yaml); map per its header: field →
property (`maxLength`, `example`, `required` from M), BR- → 422 with the FTSD error message,
AR- → 403/409, actions → endpoints, status enum from the FTSD. Every operation has `x-id: API-xx`
and `x-scr: [SCR-xx, US-xx]`. Source/Logic goes in comments only. Run `contract`; each mismatch with
the FTSD rows becomes a Comment for BE, never a docx edit. BE owns the file after the draft and moves it
to the BE or contract repo if the team wants. FE mocks it during Slice.

## Revision (any phase, any direction)

```
docx edited in Word, or a finding from Design/Dev/QA (→ comment citing the ID)
        ▼
snapshot ─► ids <committed .md> <new .md> [--also other docs' .md]
        ▼   {"changed": [...], "stale": [...]}
gate fails "changed since approval" → owner re-dates → route resumes at the most upstream stale phase
```

Keep the previous snapshot (git or a copy) before snapshotting, so `ids` has an old file to compare.
Stale SCR- → its slice and `openapi.yaml` operations are rechecked; stale API- → F2 only.

## Hosts and hand-off

Claude Code / Codex: files live in the repo (`sdlc/`, `intent/`); gates run in the shell.

Claude.ai / ChatGPT: upload this skill and `using-bspace-sdlc` (Brainstorm, Design) as zips, code
execution on. P0–P4b work in chat; Figma needs the Figma connector. The sandbox forgets between
chats, so:
- start: ask for the project zip; unzip it and route as usual.
- end of every session: give one `<ABBR>-sdlc.zip` with the whole tree (`sdlc/` + `intent/`),
  exact names kept (`Blueprint.docx`, `FTSD.docx`, `*.gate.json`; gates key on them). The user
  keeps it in the project's OneDrive folder.

Chat → repo: unzip at the repo root and commit. The router reads the files; nothing else to tell it.
Slice, run-verify, hooks and Agent Office need Claude Code with the repo.

Editing a doc from Code: open the docx in Word, or ask the AI → Word Comment → accept in Word →
`snapshot`. Editing `X.md` changes nothing; the next snapshot overwrites it.
