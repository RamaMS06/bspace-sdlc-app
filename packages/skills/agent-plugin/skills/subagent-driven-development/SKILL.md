---
name: subagent-driven-development
description: Default execution model for any multi-unit job (Figma sections or frames, Flutter or Vue code tasks, refactors, any large implementation) on any AI host — Claude Code, Codex, Cursor. A thin orchestrator keeps state in files, runs each unit in a fresh worker context, reads only file reports, and verifies with scripts. Use whenever a job has more than one unit of work or risks filling the context window; callable standalone or from another skill.
---

# Subagent-driven development — default for every multi-unit job

Purpose: no run dies from a full context. The orchestrator holds a thin coordination context;
every unit runs in a **fresh worker context** whose whole input is one brief file; results come
back as **files, not conversation**; state lives on disk, so any session can resume it.

This is the default, not an opt-in. A caller skill defines its units (flutter-slice-screen: one per
section; a batch: one per frame; a code plan: one per task); this skill defines how they run.

## Host mapping

The rules are host-neutral. Pick the worker mechanism the host offers, in this order:

| Host capability | Worker = |
|---|---|
| Subagent tool (Claude Code `Agent`; the subagent/background-agent feature in Codex or Cursor) | one subagent per unit, given only the brief path |
| No subagent tool | **sequential fallback**: the same session runs one unit at a time, from its brief only, writes the report, then resets context (below) before the next unit |

Questions to the developer use the host's structured question tool when it has one (Claude Code
`AskUserQuestion`), else a numbered option list in chat. Same options, same order.

**Context reset** (sequential fallback, or any session past roughly half its window): finish the
current unit, make sure `progress.md` and the report are written, then use the host's clear/new-chat
or compact command and resume from `progress.md`. Never reset mid-unit. Compacting is lossy; files
are not.

## Core rules

1. **Brief before dispatch.** No worker starts without a written brief that fully scopes it:
   goal, inputs (absolute paths, node ids, URLs), writable set, rules to read, definition of done,
   report path. If it cannot be written down completely, it is not ready to dispatch.
2. **Fresh context per unit.** A worker gets only its brief path (plus the skill it follows). It
   inherits nothing from the orchestrator: heavy tool output (MCP responses, screenshots, grep,
   logs) stays in the worker.
3. **File reports, never pasted output.** A worker writes its report file and returns one status
   line. The orchestrator reads reports, never a worker transcript, and never re-fetches what a
   worker already handled.
4. **Disjoint write sets for parallel work.** Workers run in parallel only when their writable sets
   are disjoint. A file several would touch (a registry, `plan.md`, `pubspec.yaml`/`package.json`, `main.dart`/router,
   shared assets) has one writer — the orchestrator, applying proposals serially. In doubt,
   serialize. At most 3–4 workers at once.
5. **External verification.** A worker never certifies its own gate. Gates are scripts, exit codes
   (tests, lint, analyze, a `--check` validator), file-existence checks or a separate verifier; a gate whose only evidence is a worker's claim has
   not passed. A visual gate (render pair) is a score script (geometry vs metadata, then
   pixel diff — Flutter: flutter-slice-screen `diff_renders.py`); on a fail a fresh-context verifier unit gets only the
   artefacts (images, diff, metadata) and returns the difference list that is the next fix brief —
   it explains, the score decides.
6. **Human gates stay human.** A developer question is relayed by the orchestrator (batched into as
   few interrupts as possible), never answered on the developer's behalf. Record the verbatim answer
   in the brief or report.
7. **Two rounds per gate.** A unit failing its gate twice is reported `BLOCKED`, not retried again.
   A score gate that measures progress (Flutter `diff_renders.py`) has no round cap: it runs until
   it passes or stops itself on no progress, then the unit is `NEEDS_CONTEXT`.
8. **No mode question.** Linear vs parallel follows from the unit count and the write sets; with
   no git repository (no worktree), parallel workers share the tree on disjoint write sets, or the
   run is linear — recorded in `progress.md`, never asked.

## Workspace

The caller may place briefs/reports in its own folder (flutter-slice-screen: the slice folder's `work/`).
Otherwise, ephemeral at the project root, gitignored:

```text
.sdd/<batch-id>/
├── progress.md            # one row per unit: id, scope, status — orchestrator is the only writer
├── tasks/<unit-id>.md     # brief, written before dispatch
└── reports/<unit-id>.md   # written by the worker
```

Status: `pending → running → awaiting-verify → awaiting-human → done/gated`, or
`needs-context`/`blocked`. Delete the workspace when every unit is `done` (or `gated` with the
developer's acknowledgment); permanent results belong in the project's own files.

**Report** — `## Status` (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` naming the missing field,
`BLOCKED` with what was tried and 2–4 options, safest first), files written, gate result, proposals
for orchestrator-owned files, gaps. Nothing else.

## Loop

1. Decompose into units with disjoint write sets; write every brief and `progress.md`.
2. Dispatch per the host mapping: parallel across disjoint units, serial otherwise.
3. On each report: run the mechanical gate, update `progress.md`. A failure → write a focused
   fix-brief and dispatch a fresh worker; never resume a failed worker's context.
   `NEEDS_CONTEXT` → fix the brief, re-dispatch. Never re-dispatch an identical brief.
4. Relay human-gate items in as few interrupts as possible; resume with the answer recorded.
5. Apply shared-file proposals serially, as the only writer.
6. Run the global gate once, clean up the workspace, report per unit. Any unit still
   `NEEDS_CONTEXT`/`BLOCKED`, or a failed global gate, stops every later step (wiring, runs) and
   is reported as unfinished.

**Resume.** Any session — new chat, after compaction, another host — reads `progress.md` and
continues from the first unit not `done`. Nothing needed to resume lives only in conversation.

## Calling from another skill

The caller defines what a unit is, which of its steps a worker runs and its gates; its scripts stay
authoritative. This skill only adds isolation, file handoff, verification and resume. A caller
states three things:

- **Unit** — the smallest piece with its own write set (a section, a frame, a code task).
- **Brief fields** — anything beyond core rule 1 a worker needs (node ids, DS path, AC ids).
- **Gate** — the command whose exit code closes a unit, and the global gate run once at the end.

Worked example: flutter-slice-screen
[handoff.md](../flutter-slice-screen/references/handoff.md) and
[orchestration.md](../flutter-slice-screen/references/orchestration.md). Without a caller (a plain
code plan), a unit is one plan task, the gate is the project's tests plus analyze/lint, and the
workspace is `.sdd/`. For per-task spec and quality review ideas, see the superpowers
`subagent-driven-development` skill; this skill's rules win where they differ.
