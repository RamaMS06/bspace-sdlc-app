# Heavy Figma MCP calls

Figma MCP tools are not equally cheap. `get_metadata`, `get_code_connect_map`, and
`get_variable_defs` return quickly even on a large node; `get_design_context`, `get_screenshot`,
and `send_code_connect_mappings` do real rendering/serialization work on the Figma desktop side
and are the calls that stall past the MCP idle timeout (300s by default) on a large frame. Those
three are **heavy calls** throughout this skill.

This file defines: how to classify a frame before calling anything heavy, the concurrency rule,
how to scope heavy calls so they stay small, what to do when one fails, and what a run may still
produce once heavy calls are unavailable.

## 1. Complexity preflight (before the first heavy call)

From the merged `get_metadata` inventory (SKILL.md step 9 — metadata only, no heavy call yet),
count and classify:

| Class | Descendant nodes | Max depth | Complex instances (non-leaf component/instance) |
| --- | --- | --- | --- |
| `light` | < 100 | < 6 | ≤ 5 |
| `medium` | 100–300 | 6–9 | 6–15 |
| `heavy` | > 300 | ≥ 10 | > 15 |

Any single dimension in the `heavy` band makes the frame `heavy`. Record the class and the three
counts in `plan.md`'s Environment checks "Figma call policy" row before any heavy call.

The class changes *scoping*, not *rigor*: a `heavy` frame still resolves every Inventory node, it
just never does so in one call.

## 2. Concurrency: one heavy call at a time

Heavy calls run strictly **sequentially — concurrency 1** — across the whole session, and across a
whole orchestrated batch (see [orchestration.md](orchestration.md)'s heavy-call semaphore). Do not
fire several `get_design_context` calls and wait on them together: parallel heavy calls queue
inside Figma desktop, so each one's idle clock runs while it is merely waiting for the previous
one, which is how a run ends with several simultaneous 300s timeouts instead of one slow success.

Cheap calls (`get_metadata`, `get_code_connect_map`, `get_variable_defs`) may still be issued
normally.

## 3. Scoping: never send a whole heavy frame to `get_design_context`

For `medium` and `heavy` frames, resolve strictly bottom-up from the section level:

1. Call `get_design_context` on a **direct child section**, never on the top-level frame node.
2. Within that section, call it again only for an instance the section-level response left
   unresolved (no props/variants returned, or a nested instance elided).
3. A section whose own scoped `get_metadata` exceeds ~25 descendants is itself split further —
   its direct children become the call unit.

`get_screenshot` stays one call for the top-level frame, taken once (step 9's visual cross-check)
and reused; it is never a per-section dependency. If it fails, section resolution continues — the
screenshot's role is covered by the numeric fallback in §5.

## 4. Failure handling: bounded retry, then a circuit breaker

A heavy call that times out or errors is recorded in `plan.md` (tool, node id, error, timestamp)
and then handled in this order — no unbounded retrying, no re-running the same failed call
verbatim without a changed condition:

**Attempt 1 failed → change one condition, then retry once.** Ask the developer which, naming both
(`AskUserQuestion` when available):

- Raise the MCP idle timeout to 900s — env `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=900000`, or
  `"timeout": 900000` on the figma-dev-mode server entry in the settings file that configures it.
  **This skill never edits that config itself** — it is a harness/editor-global change; propose the
  exact edit and let the developer apply it or explicitly authorize it.
- Restart Figma desktop, reopen the file, keep the target frame selected, then retry.

Narrowing the scope further (§3) also counts as a changed condition and needs no developer input.

**Attempt 2 failed → open the circuit breaker for that frame.** Record
`heavy-calls: disabled (breaker open)` in `plan.md` and stop issuing heavy calls for this frame —
including for its descendants, which would fail the same way and cost another full timeout each.
Continue via §5. The breaker is reopened only by the developer (e.g. after applying the timeout
change or restarting Figma), never by the agent deciding to try again.

## 5. Numeric fallback (what a breaker-open run may still do)

With heavy calls unavailable, the run is **not** cancelled and is **not** free to guess. It
continues on `get_metadata` + `get_code_connect_map` alone:

- **Allowed:** resolve a node whose `get_code_connect_map` returns a real mapping; record layout,
  `itemSpacing`, `padding*`, `cornerRadius`, `absoluteBoundingBox`, and `characters` from metadata;
  call `get_variable_defs` (cheap, still available) to auto-resolve tokens by variable name;
  resolve remaining spacing/color to tokens by number; reuse an existing project asset; write
  `plan.md` rows.
- **Not allowed:** infer a `B<Name>` component or its props/variants from a node name or the
  screenshot; invent copy for a text node metadata didn't return (output-contract.md's "Never
  invent visible copy" is unchanged); export a new asset that needed a heavy call to produce.
- Every node that needed a heavy call and didn't get one is a **gap row** in `plan.md`'s Coverage
  table, not a silent native-layout resolution.

The step 15 human gate is unchanged and explicitly names the breaker state and every resulting
gap. If the gaps cover most of the screen, say so at the gate — generating a mostly-gapped screen
is a developer decision, not an agent one.

At verification (step 19), a breaker-open run uses that step's existing numeric cross-check path:
re-diff every node's coordinates/dimensions and every spacing/radius token against a fresh
`get_metadata`, and record in the Progress checklist that the visual half was replaced by the
numeric fallback and why. Never check that box with no evidence.
