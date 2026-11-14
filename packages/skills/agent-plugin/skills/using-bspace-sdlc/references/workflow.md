# BUMA SDLC — Peta Workflow

Satu halaman untuk memahami seluruh alur. Ini **peta**, bukan aturan: kalau ada beda, yang menang
adalah `using-bspace-sdlc/SKILL.md` (router, G1, Close), `figma-generate-screen/SKILL.md` (Design, D0/C1/G2) dan `blueprint-ftsd/SKILL.md`
(P0–P4b, docx, gate B/F1/F2). Routing selalu dari file di disk: baris pertama yang gagal = fase berikutnya.

## Alur

```text
P0 Discover ─► P1 Brainstorm (per fitur) ─► P2 Data
   project.md     intent.md (G1)               data.md (SRC-xx)
                                                   │
Blueprint.docx v0.01 ─► analyst edit di Word ─► Gate B (Sign Off bertanggal)
                                                   │  P3 terkunci sebelum Gate B pass
P3 Design: D0 designer pilih referensi + lokasi (file/page/posisi) → exact REF node → design.md
   C1 reference (grep) → build Figma → prototype → G2 (designer review)
                                                   │
FTSD.docx v0.01 ─► analyst · designer · FE · BE ─► Gate F1 (Functional Approval)
                                                   │
P4b API: openapi.yaml ─► contract (SCR ↔ API-xx) ─► Gate F2 (Technical Approval)
                                                   │
Slice FE (mock OpenAPI) ║ BE implement ─► flutter-run-verify ─► close.md
```

Slice **bukan** bagian Design. Slice baru jalan setelah F2.

## Fase, output, gate

| Fase | Skill | Output | Gate (lulus jika) |
|---|---|---|---|
| P0 Discover | `blueprint-ftsd` | `sdlc/project.md` | fitur aktif + Future Features jelas |
| P1 Brainstorm | `using-bspace-sdlc` §1 | `intent/<ID>-<slug>/intent.md` | G1: `Status: approved`, `Approved-by`, 0 clarification, 0 Q |
| P2 Data | `blueprint-ftsd` | `sdlc/data.md` | setiap field punya `SRC-xx` |
| Blueprint | `blueprint-ftsd` `fill` | `Blueprint.docx` + `.md` snapshot | Gate B: semua Sign Off bertanggal, tidak berubah sejak itu |
| P3 Design | `figma-generate-screen` | `design.md`, `design-evidence/`, frame Figma | D0 brief + C1 + C1 reference + G2 |
| FTSD | `blueprint-ftsd` `fill` | `FTSD.docx` + `.md` snapshot | Gate F1 |
| P4b API | `blueprint-ftsd` | `sdlc/openapi.yaml` | `contract` + Gate F2 |
| Slice | `flutter-slice-screen` / `vue-slice-screen` | kode UI, `spec.md` pin ke intent | `--check` pass |
| Run-verify | `flutter-run-verify` | baris `run:` di `plan.md` | app jalan tanpa error layout |
| Close | `using-bspace-sdlc` §5 | `close.md` | tidak ada sel AC kosong |

Blueprint satu per project: semua fitur aktif di `project.md` harus punya intent approved dulu.
Fitur yang belum siap → pindahkan ke Future Features.

## P3 Design: cara AI berpikir

Skill `figma-generate-screen` bisa dipakai **tanpa SDLC**: designer panggil langsung untuk screen
apa pun. Sumber dipilih adaptif: FSD/Blueprint kalau ada → `intent.md` → brief singkat dari designer
(`## Screen Brief`, `Brief-approved-by`). Lewat router, Blueprint Gate B tetap wajib.

1. Baca konteks dari sumber (FSD / intent / brief): fitur, persona, tujuan screen, platform, state.
2. **D0 Reference brief (gate designer).** Per screen, tanya designer: frame Figma mana yang diikuti,
   apa yang diambil (header, layout, card, background, image), apa yang dihindari. Boleh beberapa
   URL per screen. Inspirasi luar (Pinterest, Dribbble) hanya URL + catatan teks designer, tidak
   di-fetch. Tips: designer copy frame pilihan ke page `References` di file target. Isi
   `## Reference Brief`. Tanya juga **lokasi**, selalu, tanpa default: `Target-file` (URL file),
   `Target-page` (URL page yang ada, atau nama page baru dari designer), `Target-placement` (di
   samping frame X, di section Y, atau section baru). AI tidak pernah membuat/memilih page sendiri.
   `Reference-brief-by` setelah designer konfirmasi.
3. AI hanya membuka URL dari brief (dan catalog). Tidak browsing workspace, jadi hemat token.
   URL harus `figma.com/design/<fileKey>/...?node-id=<id>`; URL team/files ditolak D0.
4. Inspeksi tiap REF: frame + safe area, layout, background (variable/style), image/asset source,
   typography, komponen + props, state, prototype. Simpan screenshot/metadata di `design-evidence/`.
5. Putuskan per screen: `reuse` | `adapt` | `compose` | `new-pattern` (butuh
   `New-pattern-approved-by`). Catat deviasi.
6. Isi `design.md`: `## Traceability` → `## Reference Inspection` → `## Components` → `## Flows`.
7. C1 (user/designer OK + one-liner tanpa output) → build di `Target-page` + `Target-placement` → prototype → G2.

C1 reference dicek grep, bukan penilaian model. Design yang melewati catalog tetap gagal C1.
Kecocokan visual REF tetap diputuskan designer di G2.

**Revisi itu normal.** Designer ganti referensi → edit baris brief, tanggal ulang
`Reference-brief-by`, inspeksi hanya REF baru (evidence lama dipakai ulang), C1 ulang hanya untuk
screen yang komponennya berubah.

## Struktur project

```text
<project-root>/
├── sdlc/
│   ├── project.md, data.md
│   ├── Blueprint.docx / .md / .media/ / .gate.json
│   ├── FTSD.docx / .md / .media/ / .gate.json
│   ├── openapi.yaml
│   ├── figma-reference-catalog.md   # REF-xx: fileKey + nodeId + evidence
│   └── references/                  # input read-only: PRD, template, SAP xlsx
└── intent/
    ├── constitution.md
    └── <ID>-<slug>/
        ├── intent.md
        ├── design.md
        ├── design-evidence/
        └── close.md
```

docx = sumber kebenaran setelah v0.01 (milik manusia). AI membaca snapshot `.md`, mengusulkan lewat
Comment Word, dan tidak pernah mengisi tanggal approval.

## Di mana aturan lengkapnya

| Topik | File |
|---|---|
| Tabel routing, G1, Brainstorm, Close | `using-bspace-sdlc/SKILL.md` |
| Design: intake, D0/C1/G2 one-liner, build | `figma-generate-screen/SKILL.md` |
| Template intent | `using-bspace-sdlc/assets/` |
| Template design / reference catalog | `figma-generate-screen/assets/` |
| Library Figma BUMA, frame rule, props, prototype | `figma-generate-screen/references/figma-libraries.md` |
| P0–P4b, script docx (`fill`, `snapshot`, `gate`, `ids`, `contract`, `comment`) | `blueprint-ftsd/SKILL.md` |
| Slice Flutter dan sub-skill (match, assets, fidelity) | `flutter-slice-screen/SKILL.md` |
| Slice Vue | `vue-slice-screen/SKILL.md` |
| Eksekusi multi-unit | `subagent-driven-development/SKILL.md` |
