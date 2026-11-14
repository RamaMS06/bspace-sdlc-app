# Plan — Blueprint & FTSD in bspace-sdlc

Status: implemented as skill `blueprint-ftsd` (decisions taken: see "Open decisions")
Templates: `[Blueprint] RCM v.01.pdf`, `[FTSD] RCM v.01.docx` (analyst, RCM project)

## Goal

Standardise Blueprint (= FSD) and FTSD so the plugin scaffolds them from the brainstorm, while
analyst, designer, FE, BE and QA keep editing in Word. The AI drafts, reads, and proposes; humans own and approve.

As-is → to-be, 1:1:

| As-is | To-be phase |
|---|---|
| Stakeholder | P0 Discover |
| Feature + Analis | P1 Brainstorm (`intent/*.md`, one per feature/stage) |
| SAP (database) | P2 Data (`data.md`, sources filled by BE/data) |
| Blueprint (FSD) | Gate B: Blueprint.docx signed |
| User Flow business process | P3 Design (Figma, `design.md`) |
| Input Field | P4 Spec, Gate F1: FTSD functional signed |
| — (new) | P4b API contract, Gate F2: FTSD technical signed |
| — | P5 Slice → P6 Run-verify → P7 Close |

## Rules

1. The docx is the source of truth after the first draft. The mapper fills the BUMA template once (v0.01) and never regenerates it.
2. Humans edit freely in Word (text, tables, images).
3. The AI reads a snapshot (docx → `blueprint.md`/`ftsd.md` + `media/`). The snapshot is committed so PR diffs stay readable.
4. AI revisions are Comments first (Track Changes later). The analyst accepts or rejects in Word.
5. Approval uses the template's own tables (Blueprint "Document Sign Off", FTSD "Approval"). A gate passes when every row is dated. The AI never writes dates or `Approved-by`.
6. Analysts keep the ID column (US-, BR-, AR-, SRC-, SCR-, TC-). IDs drive impact analysis.
7. An AI fills only TBD cells. It never overwrites human text unless asked.

## Flow

```
 P0 Discover ──┐
 P1 Brainstorm ├── AI asks user ──► project.md · intent/*.md · data.md
 P2 Data ──────┘                       (AI working notes)
                    │ mapper: fill BUMA template (once)
                    ▼
        Blueprint.docx v0.01 ◄──── analyst edits in Word
                    ▼
        snapshot: blueprint.md + media/  ◄── AI reads
                    ▼
        Gate B: all Sign Off rows dated? no → router "waiting for <name>"
                    ▼ yes → record approved-hash
 P3 Design ── figma-reference-catalog.md → exact REF node → design.md + design-evidence/
                    │ C1 reference grep (SCR ↔ REF, background/image source) · G2 review
                    │ mapper: SCR-xx cards (once)
                    ▼
        FTSD.docx v0.01 ◄──── analyst · designer · FE · BE edit
                    ▼
        snapshot: ftsd.md + media/
                    ▼
        Gate F1: functional Approval rows dated? (analyst / user)
                    ▼
 P4b API ── AI drafts OpenAPI from SCR fields, BR, AR, actions ──► BE edits
                    ▼
        FTSD §6 Technical: endpoint summary + link to openapi.yaml
                    ▼
        Gate F2: technical Approval rows dated? (BE + FE lead)
                    ▼
        ┌───────────┴───────────┐
        ▼                       ▼
 P5 Slice (FE, mock       BE implements from
 from OpenAPI)            Source / Logic
        └───────────┬───────────┘
                    ▼
 P6 Run-verify (TC from FTSD) ──► P7 Close (US → SCR → API → TC → PASS)
```

Revision (any phase, any direction):

```
 (a) analyst edits docx        (b) finding from Design/Dev/QA
          │                         AI writes Comment citing the ID
          │                         analyst accepts / rejects
          └────────────┬────────────┘
                       ▼
        new snapshot ≠ approved-hash → Status Review, approval dropped
                       ▼
        per-ID diff: US-03 changed → SCR-05, SCR-07, API-04, slice "form" stale; rest untouched
        (a technical-only change drops F2, not F1)
                       ▼
        user re-approves → router resumes from the most upstream stale phase
```

## Document parameters

```
Status: draft | review | approved
Version: 0.02
Owner: analyst
Approved-hash: <snapshot hash at approval>
Based-on: blueprint@<hash>
```

## Template skeletons

**Blueprint v2**
0. Cover · Sign Off per stream · Document Control
1. Overview · As-is/To-be · Scope in/out · Integration (system, module, data, direction) · Reference · Assumption · Glossary
2. Process Characteristics per stage (Trigger, Input, Output, Owner, SLA) + Fit/Gap
3. Role & Auth: R&R, CRUD, Process Approval, Notification Matrix (single source)
4. Story Index (US-xx, role, story, priority, release)
5. Wireflow / Wireframe (Feature, Function, Figma link)

**FTSD v2**
0. General Info · History · Blueprint version reference
1. High-level BP (from Blueprint)
2. ERD + Data Source Catalog (SRC-xx: system, view/table, key, refresh)
3. Authorization Rule AR-xx (matrices referenced, not copied)
4. Per screen SCR-xx: ID + US-xx · path · persona · pre-req · story · wireflow/mockup · rules BR-xx ·
   fields (No · Field · Description · Sample · Type(Len) · M/O/C · Editable · Default · Source · Logic/Validation · Error msg) ·
   test conditions (Scenario · Input · Expected)
5. Notification · Analytics · Dependencies
6. Technical (owner BE / architect)
   6.1 ERD + Data Source Catalog (moved here from 2)
   6.2 API Contract summary per endpoint: API-xx · Method · Path · SCR/US · Auth (AR-xx) · Request · Response · Errors (BR-xx → 400/422, AR-xx → 403) + link to `openapi.yaml`
   6.3 Integration SAP/DW: direction, schedule, failure handling
7. Approval: functional (analyst / user) and technical (BE + FE lead) signed separately

## Owners

| Part | AI drafts | Final owner |
|---|---|---|
| Scope, stories, rules, role matrices | from brainstorm | Analyst |
| Data sources (SRC, Table/Logic) | missing-source list | BE / data |
| Flow, mockup links | from Figma | Designer |
| UI field types, error messages | from DS components | FE |
| Test conditions | from AC | QA |
| Approval | — | User / stakeholder |

## Tech notes

- docx = zip of XML; read and fill with Python stdlib (no pandoc / python-docx).
- `intent.md` stays per feature; router, G1/G2 gates and Agent Office keep working.

## Open decisions (default taken → change in SKILL.md if the team decides otherwise)

1. Blueprint granularity → one per project.
2. P2 data sources → AI lists needs, BE/data engineer fills.
3. Sign-off → hard gate (`gate` exit 1 blocks the route).
4. P0 Discover → own phase (`project.md`).
5. Approval lock → convention (rule 3) + content hash in `*.gate.json`; no hook yet.
6. docx location → `sdlc/` in the repo; SharePoint copy is the user's choice.
7. AI revisions → Comments only.
8. API contract → FTSD §Technical summary + `openapi.yaml`.
9. `openapi.yaml` → starts in `sdlc/`, BE moves it.
10. "Data Source RCM-SAP" → xlsx on SharePoint; user exports or pastes it in P2.

## API contract

Today: the RCM FTSD has no API contract (no endpoint, method, request/response, or errors). Data appears only as
`Table/Logic` per field (e.g. `[DW_ALL_TECH_APPS].[GOLD].[GEN_VW_F_AM_MaintenanceOrder]`) plus
"Detail query mengacu pada Data Source RCM-SAP", which is a separate document.

Standard SDLC: the contract belongs to Design / technical spec (IEEE 1016 SDD "interface design"; SAP TS / ICD;
API-first teams approve it before coding). The BUMA FTSD is FS + TS combined, so it goes in the FTSD's technical part.

Derived from the functional part:

| FTSD functional | API contract |
|---|---|
| Field table (Field, Type(Len), M/O/C) | request / response schema |
| Source / Table/Logic | BE implementation (hidden from FE) |
| Rules & Validation BR-xx | 400/422 + message |
| Authorization Rule AR-xx | 403 |
| Draft, Submit, Approve, Revise, Reject | action endpoints + status transition |
| Transaction Status | response enum |

The docx keeps only the summary table (stakeholders sign the docx). `openapi.yaml` holds the details, because only a file can be
validated, mocked by FE and used to generate code.

## Sources

- SAP Blueprint vs Fit-to-Standard — https://keyusertraining.com/en/sap-business-blueprint-redefinition/
- SAP Business Process Design template — https://www.scribd.com/document/747227902/SAP-Business-Process-Design-STE-Template
- WRICEF Functional Specification template — https://idoc.pub/documents/functional-specification-template-wricef-qn85rgqkjpn1
- An Agile Functional Specification — https://www.its-all-design.com/an-agile-functional-specification/
