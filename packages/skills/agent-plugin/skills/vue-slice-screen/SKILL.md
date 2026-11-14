---
name: vue-slice-screen
description: Slice an approved Figma screen into presentation-only Vue.js code using the BUMA Design System. Use when translating Figma designs into consistent, UI-only Vue components/pages without wiring business logic, repositories, or APIs.
---

# Vue Slice Screen

Create a runnable Vue screen while preserving the developer's explicit target and the existing package boundaries.

## Required inputs

Collect only missing information:

- Figma frame or node URL.
- Screen name.
- Exact target feature directory.
- Routing mode: `none`, `suggest`, or `auto`. Default to `suggest`. See
  [references/routing.md](references/routing.md) for what each mode does.

Do not ask about store, API, or business-logic wiring in this skill — presentation-only, see
Boundaries below.

## Workflow

1. **Check repository scaffold.** Locate the target's nearest `package.json` and verify it is a
   runnable Vue app: Vue is installed, an app entry and bundler config exist, and the target has
   a usable `src/` tree. This skill's active flow targets a **standalone** app — check it
   against the "Identify" section in
   [references/scaffold-standalone.md](references/scaffold-standalone.md) (no
   `federationConfig.ts`/`remotes`/`exposes`, owns its own `createRouter`). If the target is
   instead an existing shell or remote repo (federation config present), that's outside this
   flow's current focus — stop and confirm with the developer before proceeding; scaffold-shell
   and scaffold-project remain available as references but aren't part of the active steps
   below. If the standalone scaffold passes, continue to step 3. If it is absent or incomplete,
   continue to step 2.

2. **Initialize the Vue project.** Use
   [references/scaffold-standalone.md](references/scaffold-standalone.md) to set up a
   self-contained Vue app with no federation wiring. Do not invent `federationConfig.ts`,
   `remotes`, or `exposes`. Complete the scaffold's minimum runnable setup, then continue to
   step 4 — package installation is checked separately there.

3. **Check BUMA packages.** Resolve the target repo's actual UI-kit package and
   `@buma-dev/styles` on disk, per [references/design-system.md](references/design-system.md)'s
   "Resolve the packages on disk first" section. Existing screens decide whether the UI kit is
   v1 or v2; do not mix majors. If both required packages are installed, continue to step 5. If
   either is missing, continue to step 4.

4. **Install BUMA packages.** Install only the missing UI-kit major and/or `@buma-dev/styles`
   using the repo's existing package manager and the selected scaffold reference's minimum
   package list. Do not add auth, layout, state, API, chart, or federation packages for a
   presentation-only screen. Then continue to step 5.

5. **Verify BUMA integration.** Check imports against
   [references/design-system.md](references/design-system.md): the UI kit's public stylesheet and
   plugin are installed once in this app's own `main.ts` (a standalone supplies them itself —
   there is no shell to do it); components are `B<Name>` globals with no deep/per-component imports; SCSS tokens are
   wired once through bundler `additionalData`, not imported into each screen. If compliant,
   continue to step 6. If not, fix the incorrect imports/wiring and repeat this step until it
   passes. Record steps 1, 3, and 5 in `plan.md`'s Environment checks table.

6. Check for conflicting files before writing. Never overwrite or restructure existing files
   without explicit authorization.

7. Confirm Figma MCP tools are available. Do not install an MCP server or modify editor-global
   config silently. If unavailable, stop before generating UI and give the client-specific
   connection step.

8. Call `get_metadata` on the supplied Figma node/URL and check what kind of node it resolved to
   before doing any further Figma-specific work.
   - **Single frame (default, unchanged):** the node is a `FRAME`, `COMPONENT`, or `INSTANCE`.
     Continue with steps 9–21 below exactly as written — nothing in this case changes.
   - **Multiple frames:** the node is a `PAGE`/`CANVAS`/`SECTION` whose direct children include
     more than one `FRAME` that each look like an independent screen. Stop here and read
     [references/orchestration.md](references/orchestration.md) instead of continuing to step 9
     — this session becomes the orchestrator per the separate `subagent-driven-development` skill's rules
     (fresh subagent per task file, file-based reports, external verification, human gates
     relayed not self-answered) and dispatches one subagent per frame, each of which runs steps
     1–21 scoped to its own frame.
   - **Single heavy frame (optional):** even for one frame, if the screen is large enough that a
     single continuous context risks dropped nodes or self-certified gates (many complex
     sections, deep nested instances), the session may adopt the `subagent-driven-development` skill:
     dispatch section-resolution and generation as scoped task files to fresh subagents and
     verify their reports externally, while still following this skill's steps as the task
     content. The workflow's gates (step 15, step 19) are unchanged — SDD only separates who
     executes from who verifies. Follow
     [references/figma-heavy-calls.md](references/figma-heavy-calls.md)'s batch-wide heavy-call
     semaphore; SDD workers do not make Figma-heavy calls concurrently.
   - **Ambiguous** (e.g. exactly one qualifying frame, or multiple frames that look like variants
     of the same screen rather than different screens): ask the developer once, naming the
     candidate frames found, whether to treat them as separate screens (orchestrated batch) or as
     one screen (continue at step 9 with the originally supplied node).

9. Enumerate every entry `get_metadata` returns for the node — every layer, group, vector, text
   node, and nested frame, at every depth, regardless of whether it looks decorative or already
   covered by a parent. This is a complete inventory, not a filtered one. For every entry that
   is itself a component/instance carrying more than trivial content (a stat row, a card, a
   list item — not a single leaf text/icon), re-call `get_metadata` scoped to that entry's node
   id and merge the result in place before moving on — a single top-level call is not
   guaranteed to expand every nested instance to full depth. From this merged inventory, run the
   complexity preflight in
   [references/figma-heavy-calls.md](references/figma-heavy-calls.md) and record the class before
   the first heavy call (`get_screenshot`, `get_design_context`, `send_code_connect_mappings`).
   Then call `get_screenshot` on the top-level node — following that same reference's failure
   handling if it stalls or errors — and visually cross-check it against the merged inventory;
   any visible element with no inventory row means a subtree is still missing. Group the
   inventory by the node's direct children (one section each, in Figma sibling order) — steps
   11–13 resolve one section at a time, not the whole screen in one pass, and for a
   `medium`/`heavy` frame this section boundary is also the heavy-call scoping boundary. This
   same grouping fixes the generated file boundary: each section becomes its own
   `<ScreenName><SectionName>.vue` component at step 16, listed in `plan.md`'s Files to create at
   step 10, per [references/output-contract.md](references/output-contract.md).

10. Read [references/output-contract.md](references/output-contract.md) for the ID scheme,
    then compute the spec ID: reuse an existing `specs/<ID>-<screen-name>/` folder for this
    screen if one exists, otherwise allocate the next sequential number. **Exception:** under
    orchestration (step 8's multi-frame case), use the pre-allocated ID from the frame's own
    `briefs/<frame-id>.md` instead of computing one — see
    [references/orchestration.md](references/orchestration.md) step 1. Fill `plan.md`'s
    Environment checks table from steps 1, 3, and 5's results. Write `plan.md` from
    `assets/screen-template/` now, before any resolution work, with its Inventory table fully
    populated (unfiltered) and empty Coverage/Component/Asset/Routing/Progress sections. The
    **Files to create list is populated now too** — section boundaries are already known from
    step 9's grouping, so list the thin screen file, the content component, and one
    `<ScreenName><SectionName>.vue` line per direct-child section (even if there is only one), per
    [references/output-contract.md](references/output-contract.md). Steps 11–13 write directly
    into this file, section by section, not into working memory — the
    Coverage/Component/Asset/Routing tables fill in as each section resolves, not all at once at
    the end.

11. Before the first `get_design_context` call, invoke the `figma:figma-design-to-code` skill
    once to load its guidance — a mandatory precondition of that tool, not optional here. Read
    [references/design-system.md](references/design-system.md) before selecting components.
    Resolve one section at a time, in Figma sibling order: for each node, call
    `get_code_connect_map` scoped to that node first — if the repo already has a Code Connect
    mapping for it, use that resolution directly. Also call `get_variable_defs` scoped to that
    node (cheap, not a heavy call) and resolve any color/spacing/radius/typography token via
    [references/design-system.md](references/design-system.md)'s "Auto-resolve from Figma
    variables first" step before falling back to numeric matching. Only when no component
    mapping exists, call
    `get_design_context` on the node (this is what returns real props/variants, not a guess from
    the node name or screenshot), then match it to a global `B<Name>` component or, when nothing
    matches, default to a screen-local component. For a matched `B<Name>`, read that component's
    `component.meta.yaml` for props, variants, and slots before opening `<Component>.vue` or
    `types/*.ts`; read those files only when the metadata is missing or still ambiguous, per
    [references/design-system.md](references/design-system.md)'s "Resolving a component's real
    API". Scope and retry the `get_design_context` call per
    [references/figma-heavy-calls.md](references/figma-heavy-calls.md) (section-level node, never
    the whole frame; one heavy call at a time; bounded retry, then the frame's circuit breaker
    and its numeric fallback) — preferring one composite molecule/organism
    over hand-assembling atoms, and checking existing screens for the same pattern's prior
    choice, per [references/design-system.md](references/design-system.md)'s "Prefer one
    composite component over a hand-assembled pattern"; raise any inconsistency found at step 15
    instead of silently diverging. If the resolved text for any text node is a placeholder-shaped
    value (`Label`, `Title`, `Text`, `Detail`, `Tab 1`, `Tab 2`, `Tab 3`, `Lorem ipsum`, `—`,
    empty) rather than real copy, re-scope `get_metadata` to the **leaf text node's own id** —
    not its instance or wrapper — for its `characters` field before recording it. If the leaf is
    still placeholder-shaped, write a `gap` Coverage row naming the node and observed value —
    never write that value into the Coverage row as resolved copy or into the eventual `.vue`
    file; an unresolved text node is a gap for step 15, not an invented string (see
    output-contract.md's "Never ship a placeholder-shaped string" and "Never invent visible
    copy"). For every **visible text node**, resolve and record its color token and typography
    token in `plan.md`'s Coverage row (`Color`/`Typography` columns) before moving on — never
    leave either blank for a visible text node. Resolve them the same way as any other token: try
    `get_variable_defs` on that node first (`Source: variable`); fall through to matching
    `get_design_context`/`get_metadata`'s style fields against `token.meta.yaml` only when no
    variable is bound (`Source: context`), per
    [references/design-system.md](references/design-system.md)'s token-resolution rules. For a
    Coverage row that is not a visible text node (`native-layout`, `grouped-into <CM-XX>`, `gap`,
    or a resolved component/asset with no visible text of its own — an icon, an image, a pure
    layout wrapper), write `n/a` in both columns instead of leaving them blank, so a blank cell
    always means "not yet done," never "doesn't apply." Record
    each node's exact spacing numbers
    (`itemSpacing`, `padding*`, `cornerRadius`) from the tool response itself and resolve them to
    tokens by number per
    [references/design-system.md](references/design-system.md)'s "Spacing/radius: read the number
    before picking a token" — never estimate spacing from the screenshot. For every node in this
    section — including ones needing no component (pure layout, decorative grouping) — add a
    Coverage row noting the resolution or the reason no `CM-XX`/`AS-XX` applies, plus the Figma
    number and token for any spacing that did not match a token exactly. Write that section's `CM-XX` and
    Coverage rows into `plan.md` immediately, before moving to the next section.

12. Within that same per-section pass, identify image/icon/vector layers. For non-icon visual
    assets (images, illustrations, logos, backgrounds), invoke the `vue-resolve-assets` skill: reuse
    before export, use Figma MCP `download_assets` with the node-appropriate mode, validate every
    download, and record each as an `AS-XX` row. Icons and small vector glyphs are excluded from
    that export flow: resolve them through Code Connect, the UI kit, or the repo's established
    icon asset path; never substitute a guessed font icon. Follow
    [references/output-contract.md](references/output-contract.md) for the output contract.

13. Within that same per-section pass, when a node needs something with no UI-kit equivalent
    (chart, map, animation) and no existing project usage to match, do not add a new dependency
    — record it as a gap in `plan.md` for the developer to decide, rather than picking a library
    unilaterally.

14. After every section's loop (11–13) is done, confirm `plan.md`'s Coverage table has exactly
    one row for every Inventory entry from step 10, each resolving to a `CM-XX`, an `AS-XX`, a
    native-layout/no-component decision, or an explicit justified gap. Never a silent omission.
    Run [scripts/validate-slice.sh](scripts/validate-slice.sh) against `plan.md` and the target
    `.vue` directory and fix every finding — the script's exit code, not the agent's own reading
    of the table, is this step's evidence (no `.vue` files exist yet, so its `.vue` scans are
    expected to report the directory as missing here; step 19 is where they must pass). Do not
    write any `.vue` file before this confirmation.

15. **Hard human gate — cannot be self-answered.** Stop and ask the developer for explicit
    confirmation to proceed, using `AskUserQuestion` when available. Summarize what `plan.md`
    describes (states, components, assets, routing) and explicitly name every `CM-XX` row
    defaulted to a screen-local component (no UI-kit match). Do not write any `.vue` file
    before the developer confirms. Record their **verbatim answer** under the plan-reviewed
    checklist item — the agent's own paraphrase does not count.

16. Generate the `.vue` files per
    [references/output-contract.md](references/output-contract.md)'s file tree and skeleton —
    every direct-child section from step 9 gets its own `<ScreenName><SectionName>.vue`
    component (mandatory, whatever its size), and `<ScreenName>Content.vue` only composes them
    inside the frame's top-level wrapper. Generate exactly the files `plan.md`'s Files to create
    list names; step 19's validator fails on any listed file that doesn't exist.

17. Implement only presentation code. Represent loading/empty/content/error states only when
    they exist in Figma or the user requests them. Check off `plan.md` Progress items live, not
    only at the end.

18. For routing mode other than `none`, read [references/routing.md](references/routing.md)
    and check off the routing item in `plan.md`.

19. Verify: re-call `get_metadata` fresh on the same node (not step 10's persisted table, in
    case that itself was incomplete) and confirm every entry is still accounted for against the
    Coverage table — a grouped or native-layout resolution counts as accounted for if its
    Coverage row says so, it does not require a 1:1 DOM node per Figma node. Check text is
    verbatim, component props/variants match, and generated flex directions match the
    Inventory's Layout column. Cross-check every spacing/radius token used against the numbers
    recorded in step 11's Coverage rows (not a fresh visual guess) — a mismatch here is a bug to
    fix now, not a gap to log. Run
    [scripts/validate-slice.sh](scripts/validate-slice.sh) against `plan.md` and the generated
    `.vue` directory and fix every finding before relying on the reasoning below — the script
    is the mechanical half of this step, not a substitute for reading its output:
    - **Negative margins** (`margin-*: calc(-1 * ...)`, `margin-*: -`): each one fails
      verification unless its Coverage row records a real Figma overlap — remove it and fix the
      parent's `gap`/padding instead, per
      [references/output-contract.md](references/output-contract.md).
    - **Placeholder-shaped copy** (`Label`, `Title`, `Text`, `Detail`, `Tab \d`, `Item \d`,
      `Lorem`): every hit fails verification unless `plan.md` records a developer answer
      confirming that exact string is the real copy. A hit whose only source is a
      `get_design_context` instance default is an unresolved text gap that leaked into the
      output — remove it and re-resolve per step 11, never ship it.
    - **Accessibility** (per [references/output-contract.md](references/output-contract.md)'s
      a11y bullet): every `<img>` has `alt`, every icon-only control has an accessible name.
    Confirm every visible string in the output traces to a Figma `characters` value or an
    explicit developer answer recorded in `plan.md`; a string with no such source is an invented
    label and must be resolved, not shipped. Run the repo's dev server and visually compare against
    `get_screenshot` at a real viewport — look for overflow, truncation, or dropped children.
    Save that comparison's outcome (or a screenshot, if the environment supports capturing one)
    and record it under the Progress checklist — no evidence recorded means this step didn't
    run. If `get_screenshot` fails or times out, this step is **not satisfied by skipping the
    visual half and logging a gap** — retry it; if it still fails, fall back to a full numeric
    cross-check (re-diff every node's coordinates/dimensions and every spacing/radius token
    against a fresh `get_metadata` call) and record that fallback explicitly in the Progress
    checklist entry, so a missing screenshot is visibly compensated for, not silently dropped.
    Apply the same bounded retry, circuit-breaker, and numeric-fallback policy to any failed heavy
    call during steps 9–11; see
    [references/figma-heavy-calls.md](references/figma-heavy-calls.md). Fix any mismatch before
    finalizing `spec.md`.

20. Lint and format the changed files with the repo's own scripts (`npm run lint`, etc.),
    scoped to the changed files.

21. Finalize `specs/<ID>-<screen-name>/spec.md` from the actual output: resolve every
    `AC-XX`/`CM-XX`/`AS-XX` row, routing status, and validation outcome.

## Scaffolding a new repo

The active flow scaffolds one repo type:

- [references/scaffold-standalone.md](references/scaffold-standalone.md) — a **standalone**
  app with no shell and no federation at all (prototype, demo, internal tool, UI-first app).

Start from a sibling standalone repo when the workspace has one, otherwise generate fresh with
the workspace's current Vue tooling — see that file for why standalone can do that safely.

Module Federation scaffolds ([references/scaffold-shell.md](references/scaffold-shell.md),
[references/scaffold-project.md](references/scaffold-project.md)) are kept as references but are
**out of scope for this flow**. Use them only on an explicit request to build a shell or remote,
and note both require the sibling-repos workspace root as an input.

## Using design system components and tokens

Whether slicing a screen or scaffolding a repo, resolve components and styling from
[references/design-system.md](references/design-system.md) — the Vue UI-kit's global
`B<Name>` components and the SCSS token functions. Never hardcode a color/spacing/radius value
or guess a component's props.

## Boundaries

- Do not create or modify store modules, composables with business logic, API/service, or
  routing-guard/middleware files.
- Do not invent API data. Preview data belongs only inline in the content component, as local
  `const` values, clearly local to the screen.
- Prefer the resolved UI-kit's global `B<Name>` components over raw HTML equivalents. Never use
  a prop that's deprecated in the resolved package version.
- Never create a component inside the `@buma-dev/buma-ui-v2` package itself. When nothing
  matches, default to a screen-local component and report the gap; confirm at step 15.
- The active slicing flow supports standalone apps only. Do not add or repair shell/remote
  federation wiring from this skill; stop and request a target decision when federation config is
  detected.
- Never add a new dependency for a chart/map/animation. Use only what the repo already resolves
  for that purpose, matching its existing usage; otherwise report it as a gap.
- Do not modify files outside the target feature except an explicitly authorized route file
  (per [references/routing.md](references/routing.md)'s `suggest`/`auto` modes).
- Do not claim pixel-perfect completion without a rendered/visual verification (Workflow
  step 19).
- Under orchestration mode (step 8's multi-frame case), only the orchestrator — never a frame
  worker — touches the shared route file or any other file shared across frames. See
  [references/orchestration.md](references/orchestration.md).