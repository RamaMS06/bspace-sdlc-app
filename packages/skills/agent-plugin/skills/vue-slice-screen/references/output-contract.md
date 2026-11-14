# Presentation-only output contract

Before laying out new files, check the target repo's other features for an already established
convention: `views/<feature>/` vs `components/views/<feature>/` (see
[scaffold-project.md](scaffold-project.md)'s information architecture), a screen/content split
vs a single file, `<script setup>` vs Options API. Mirror that repo's own existing pattern
instead of the default below when one already exists. Use the default only for a genuinely new
feature with no sibling convention to follow.

Generate the smallest file set the supplied design needs, split along the section boundary the
Inventory grouping already establishes (SKILL.md step 9: one section per direct child of the
supplied frame, in Figma sibling order). The default boundary:

```text
<repo-root>/                        # nearest directory with package.json
├── specs/
│   └── <ID>-<screen-name>/
│       ├── spec.md                 # WHAT/WHY, finalized last
│       └── plan.md                 # HOW + progress checklist, written first, updated live
└── src/
    └── views/<feature>/            # or components/views/<feature>/ — match sibling
        ├── <ScreenName>.vue                  # thin: delegates to the content component
        └── components/
            ├── <ScreenName>Content.vue       # composes sections; no layout markup of its own
            ├── <ScreenName><SectionName>.vue  # one per direct-child section (step 9) — mandatory
            └── <ScreenName><SectionName>.vue  # ...one line per section, even if there's only one
```

### Section component naming

`<SectionName>` is the PascalCase of that section's own Figma layer name, with pure Figma
authoring noise stripped (`Group`, `Frame`, `Auto Layout`, a trailing numeric id) only when the
name stays meaningful after stripping — otherwise keep the sanitized literal name. If the layer
name is itself generic (`Frame 42`, `Group 7`), name the section after its content or purpose
instead (its heading text, or what it visibly does) and record that choice in `plan.md`. Two
sections in the same screen must never collide on the same PascalCase name; disambiguate if they
do.

`<ID>` is a zero-padded sequential number (`001`, `002`, ...), scoped to the `specs/` folder
at the repo root. Reuse the existing `<ID>` when a `specs/*-<screen-name>/` folder already
exists for this screen; otherwise allocate the next number. Every requirement-shaped item
inside these files carries its own short code — `AC-XX` (Acceptance Criteria, one per state),
`CM-XX` (Component Mapping row), `AS-XX` (Asset row) — so `plan.md` can reference a specific
`spec.md` requirement by ID instead of by prose. Write `plan.md` early, with its Inventory table
populated before any resolution work (SKILL.md step 10), then fill its Coverage/Component/Asset
tables live as each section resolves (steps 11–13) — never all at once at the end — and update its
Progress checklist live as implementation proceeds; finalize `spec.md` last, from the actual
output, once component/asset resolution and implementation are both settled.

New assets: reuse an existing project asset before exporting a new one; place exports into an
existing `assets/<category>/` folder when one matches the repo's existing layout; only add a
new category when nothing matches. Never invent a new asset pipeline for one screen. Non-icon
visual assets (images, illustrations, logos, backgrounds) are exported and validated per the
`vue-resolve-assets` skill, which uses Figma MCP `download_assets`; icons/vector glyphs are excluded
from that flow and resolve through Code Connect/the UI kit/the repo's icon path instead.

Every direct-child section from step 9's Inventory grouping becomes its own
`<ScreenName><SectionName>.vue` component — mandatory, not a judgment call, even when the screen
has only one section or a section is visually trivial (a divider, a single CTA row). This keeps
the split predictable across screens instead of depending on a per-screen "did this feel big
enough" decision. Below that first level, a section component may still extract further
screen-local children when that genuinely helps maintenance (a repeated list item, a card used
three times) — that narrower case stays discretionary, and still never means one file per
visual node.

The screen file owns page composition (route-level concerns only — no template markup beyond
delegating to the content component). The content component owns only the frame's top-level
wrapper — its auto-layout direction/gap/padding from the Inventory table's Layout column — and
renders the section components inside it in Figma sibling order; it carries no per-node template
markup of its own. Each section component owns the actual design layout for its own section.
This skill only ever produces presentation components — never a store, composable with
business logic, or API call — because state and business-logic wiring are explicitly out of
scope (see Boundaries in SKILL.md).

`spec.md` is a retrospective handoff artifact for its AC/CM/AS requirement IDs, finalized after
slicing from the actual generated output — do not leave skeleton placeholders unresolved.
`plan.md` is written earlier, before implementation, and its Progress checklist is updated live
as work proceeds; together the two files let another developer (or another agent) pick up an
interrupted or finished screen and know exactly what's done, what's decided, and what's left.

Generated output must:

- Have no unresolved template variables or placeholder layout.
- Preserve the target repo's import style, `<script setup>`/Options API choice, and file
  naming convention.
- Render without requiring an API — any preview data is a local `const` inside the content
  component, clearly local to the screen.
- Keep user-visible copy from Figma unless the user requests different copy.
- Avoid store, composable-with-business-logic, service, or API-client imports.
- **Truncate dynamic-length text by default, at generation time, not as a later patch.** Any
  label, running total, or other non-constant string placed inside a constrained container
  (a flex column, a fixed-width card, a table cell) gets `text-overflow: ellipsis` +
  `overflow: hidden` + `white-space: nowrap` (plus `min-width: 0` on the flex child — the
  single most common cause of an ellipsis rule silently not applying inside a flex row) the
  first time that layout is written, whether its children are Design System components or
  plain text. Don't write unconstrained text just because this instance's Figma copy happens
  to fit; a longer label or localized string will overflow a layout that only happened to fit
  the sample.
- **Scope padding to the content wrapper, never to a container a decorative asset shares.**
  When a section composes a full-bleed decorative element (a background graphic, a pinned
  illustration) as a sibling of padded regular content inside the same positioned container,
  put the padding on the content child only — never on the outer element both children share.
  Padding on the shared container insets the decorative asset along with the content, pulling
  it off the edges Figma shows it flush against.
- **Never use a negative margin to compensate for a parent's spacing.** Spacing between
  siblings belongs to the parent — as `gap`/`row-gap`/`column-gap` on the flex/grid container, or
  as the container's own padding — never as a child pulling itself closer with
  `margin-top: calc(-1 * token(...))` or similar. A negative margin here means the parent's gap
  or wrapper structure doesn't match what Figma's `itemSpacing`/`padding*` actually says for that
  node; fix the wrapper's own spacing value instead of compensating from inside a child. The
  only legitimate negative offset is one Figma itself shows as a genuine overlap (an avatar
  badge, a pinned corner element) — and that must be traceable to real overlapping
  coordinates/`absoluteBoundingBox` values in `get_metadata`, recorded as such in `plan.md`'s
  Coverage row, not inferred to make a screenshot comparison look closer.
- **Never ship a placeholder-shaped string, even when the tool really returned it.** This is the
  other half of the rule below, and the more common failure: `get_design_context` on an *instance*
  routinely returns the component's own default text (`Label`, `Title`, `Tab 1`/`Tab 2`/`Tab 3`,
  `Detail`, `Text`, `Lorem ipsum`, `—`, an empty string) rather than the override this instance
  displays. Copying that into the `.vue` file is not "keeping Figma's copy" — it is shipping the
  component library's default as if it were screen content. Treat any such value as **unresolved,
  never as resolved copy**:
  1. Re-call `get_metadata` scoped to **the leaf text node's own id** — not the instance, not the
     section wrapper. An instance-level response is the wrong altitude to read `characters` from;
     the override lives on the nested text node, so a scoped call on the parent returns the
     default and looks like a successful resolution.
  2. If the leaf's `characters` is real copy, use it verbatim.
  3. If it is still placeholder-shaped or empty, the node is a **text gap**: write a `gap` Coverage
     row in `plan.md` naming the node id and the placeholder value seen, leave no invented string
     in the output, and surface it at the step 15 gate for the developer to supply the copy.
  A repeated series (`Tab 1`, `Tab 2`, `Tab 3`; `Item 1`, `Item 2`) is placeholder-shaped by
  definition — real screen copy does not enumerate itself. Never resolve one of these by guessing
  from the surrounding context, the screenshot, or the component's purpose.
- **Accessibility is not optional presentation detail.** Figma carries no `alt` text and no
  `aria-*` attributes, so these are generated, never copied from the tool response:
  - Every `<img>` (including one wired from an `AS-XX` export) gets `alt` — derived from the
    Figma layer's own name for meaningful content, or `alt=""` when the Coverage row marks the
    node purely decorative (a background texture, a repeated divider graphic). Never leave an
    `<img>` with no `alt` attribute at all.
  - Every icon-only control (a `B<Name>` button/icon-button with no visible text label) gets an
    accessible name via the component's own label prop if it has one, otherwise `aria-label` —
    derived from the control's function (the adjacent Figma layer name, or its Code Connect
    mapping), never a generic "button"/"icon".
  - Heading levels (`h1`–`h6`, or a `B<Name>` heading component's `level`/`as` prop) follow
    document order from the Figma frame's own text-style hierarchy — never skip a level to match
    a font size alone.
  [scripts/validate-slice.sh](scripts/validate-slice.sh) checks the `alt` and icon-only-label
  rules mechanically at SKILL.md step 19; heading order still needs a human read of the output.
- **Never invent visible copy the Figma tool didn't actually return.** If
  `get_design_context`/`get_code_connect_map` returns a placeholder-shaped value for a text
  layer (`Label`, `Title`, `Text`, `Lorem ipsum`, an empty string) instead of real content, that
  node's text is unresolved — re-scope `get_metadata` to that text node directly to read its
  `characters` field before writing anything. If it still comes back empty/placeholder, do not
  guess a plausible-sounding label (e.g. "Back", "Back to <parent screen>") from context or
  convention — record it as a text gap in `plan.md` and surface it at the human gate (step 15).
  Every string in the generated output must trace back to a real Figma `characters` value or an
  explicit developer answer, never an assumption.

## Vue file skeleton

Generate these directly — there is no template file to copy for them. The screen file is a
thin delegate:

```vue
<script setup lang="ts">
import ScreenNameContent from './components/ScreenNameContent.vue'
// replace ScreenName / ScreenNameContent with the actual screen name, e.g.
// import UserProfileContent from './components/UserProfileContent.vue'
</script>

<template>
  <ScreenNameContent />
</template>
```

The content component composes the direct-child section components inside the top-level Figma
frame wrapper (never left as a placeholder). It owns only the wrapper's layout:

```vue
<script setup lang="ts">
import ScreenNameHeader from './ScreenNameHeader.vue'
import ScreenNameActivity from './ScreenNameActivity.vue'
// replace names with every direct-child section from the step 9 Inventory grouping
</script>

<template>
  <main class="screen-name-content">
    <ScreenNameHeader />
    <ScreenNameActivity />
  </main>
</template>

<style lang="scss" scoped>
/* only the top-level frame's token()/color() layout — never a raw literal */
</style>
```

Each section component holds the actual layout for exactly one direct-child section:

```vue
<script setup lang="ts">
// local preview const values only, if this section's design needs sample data
</script>

<template>
  <section class="screen-name-header">
    <!-- this section's Figma layout -->
  </section>
</template>

<style lang="scss" scoped>
/* token()/color() calls only — see references/design-system.md, never a raw literal */
</style>
```

`assets/screen-template/` holds only the `specs/` document templates (`plan.md`, `spec.md`) —
it defines the spec structure, not the `.vue` files.

## Class naming: BEM

Every class this skill writes follows BEM, in kebab-case:

- **Block** — one per component, named after the component itself, not after the Figma layer:
  `UserProfileContent.vue` → `.user-profile-content`. One block per file; a second block in the
  same file means that part should be its own component.
- **Element** — `block__element`, always one level deep. `.user-profile-content__header`, never
  `.user-profile-content__header__title` — a grandchild is still an element of the block
  (`__header-title`), or a sign the subtree needs its own component.
- **Modifier** — `block--modifier` / `block__element--modifier` for a visual variant only
  (`--compact`, `--active`, `--error`). State that comes from the design's own states, not an
  invented axis.

In SCSS, write the block once and nest with `&__` / `&--`:

```scss
.user-profile-content {
  display: flex;
  gap: token('gap', null, null, 'md');

  &__header {
    padding: token('padding', null, null, 'lg');

    &--compact {
      padding: token('padding', null, null, 'sm');
    }
  }
}
```

NEVER:

- Bare element/tag selectors (`div > span`, `p`, `ul li`) or structural descendant chains — every
  styled node gets its own BEM class, so markup can be reordered without breaking styles.
- A utility-ish class name describing the declaration (`.mt-16`, `.flex-row`, `.text-bold`) —
  that is what the token functions on a BEM class are for.
- Styling a UI-kit component's internals via `:deep()` / `::v-deep` into `B<Name>` classes. The
  kit's internal class names are not a public API; use the component's own props/variants, and if
  none fits, record it as a gap (SKILL.md step 15) instead of reaching inside.
- Overriding a block's styles from a parent component's stylesheet (`.parent .child__element`).
  A child component owns its own styles; pass a prop or add a modifier on the child instead.

When the target repo's existing screens already use a different, consistent convention, follow
the repo (output-contract's "preserve the target repo's conventions" rule wins) and note the
divergence in `plan.md` rather than mixing two conventions in one feature.
