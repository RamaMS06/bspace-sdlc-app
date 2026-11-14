# Proposal: `component.meta.yaml` in the design system package

**Status:** proposal — not implemented. Needs a change in the design system repo, not in this
skills repo.
**Audience:** whoever owns `buma_design_system`'s Flutter package.
**Asks for:** one small YAML file per component, written by whoever writes the widget.

## The problem

A Code Connect `.figma.ts` mapping is a **curated subset** of a component's constructor, not its
API surface. It tells an agent *which* component a Figma node is. It does not tell it *which
props* that component has.

Two confirmed omissions, both found by reading the widget source against its mapping file:

| Component | Prop the mapping omits | What happens when it is missed |
| --- | --- | --- |
| a navigation-shell component | an optional slot omitted from the mapping | a visible divider or accessory silently disappears |
| a segmented-control component | a size or variant prop omitted from the mapping | the call site takes its default and the screen renders at the wrong scale |

The segmented-control case is worth dwelling on because it captures the proposal's core failure mode.
The mapping snippet **did** show a non-default size. The slicing plan recorded it correctly. The
generated Dart omitted the prop entirely. Nothing failed: the code compiled, the widget took its DS
default, and the screen shipped visibly wrong while every mechanical check passed.

That failure mode is structural, not a one-off:

- A prop left off a call site **does not fail to compile** — Dart named arguments are optional
  when the constructor gives them a default.
- The component then renders at its own default, which is a plausible-looking value.
- Nothing in a golden test, a prop assertion, or a table diff can see the difference between
  "default was deliberately correct here" and "the prop was never written."

So the only reliable defence is knowing the complete prop list up front. Today the only way an
agent can get that is **parsing the widget's Dart source**, per component, per screen.

## Why source-reading is the wrong long-term answer

It works and it is authoritative. It is also:

- **Expensive per use.** One source read per component per screen. A 14-component screen is 14
  reads of a few hundred lines each, re-done on every slice of every screen.
- **Parsing, not reading.** Named constructors, nullable types, defaults, and `super` forwarding
  all have to be recovered from syntax. That is a chance to recover them wrong.
- **Knowledge that is never retained.** Every slice re-derives the same prop list from scratch.

The obvious fix — cache a constructor index inside the skills repo — is worse. An index of a
package we do not own rots silently with the next DS release, and a stale index is worse than an
expensive correct read, because it is confidently wrong. The skills repo deliberately bans
building one (`plugins/bspace-sdlc-skills/skills/flutter-match-component/SKILL.md`).

The knowledge has to live where it cannot drift: **beside the widget it describes, inside the
package, versioned with it.**

## The precedent already in the package

Tokens already solved exactly this problem, in exactly this way.

`lib/src/components/tokens/<category>/tokens.meta.yaml` is agent-facing metadata that ships inside
the DS package. It carries `class` (the Dart API to call), `usage` (copy-paste call sites),
`aiHints` (Figma evidence → token), and an exhaustive `tokens:` list. The slicing skill reads it
off the resolved checkout and never guesses a token name.

Tokens consequently have **no drift problem**: the YAML and the Dart are in the same package, the
same PR, and the same released version. A wrong entry is wrong in the same change that made it
wrong, where a reviewer is already looking.

Components have no equivalent:

| | Tokens | Components |
| --- | --- | --- |
| Agent-facing metadata file | `tokens.meta.yaml` ✅ | — ❌ |
| Ships beside the source it describes | ✅ | — |
| Versioned with the DS release | ✅ | — |
| Consumer has to parse Dart | no | **yes** |

This proposal is just: add the missing half.

## The proposal

One file per component, in the component's own folder:

```
lib/src/components/<atoms|molecules|organisms|patterns>/<component>/component.meta.yaml
```

```yaml
class: UINavigationShell
namedConstructors: [back, close, search, custom]
props:
  - {name: title, type: String, inFigmaTs: true}
  - {name: bottom, type: PreferredSizeWidget?, default: null, inFigmaTs: false}
```

```yaml
class: UISegmentedControl
namedConstructors: []
props:
  - {name: items, type: List<UISegmentedControlItem>, inFigmaTs: true}
  - {name: size, type: UISegmentedControlSize, default: UISegmentedControlSize.small, inFigmaTs: true}
  - {name: isHugging, type: bool, default: false, inFigmaTs: false}
```

Fields:

| Field | Why it is there |
| --- | --- |
| `class` | the Dart API to call, same role as `tokens.meta.yaml`'s `class` |
| `namedConstructors` | a variant selected by constructor rather than by prop is invisible to a prop list |
| `props[].name`, `.type` | the complete surface, so "is this prop real?" stops being a parsing question |
| `props[].default` | **the value that silently wins when the prop is omitted.** Without it, an agent cannot tell a safe omission from a wrong one |
| `props[].inFigmaTs` | **the delta.** `false` means Code Connect does not mention this prop, so a consumer reading only the mapping will never know it exists |

`inFigmaTs` is the field that carries the actual value of this file. It converts "props Code
Connect omits" from something a consumer discovers by reading source into something the DS
**states**, authored by the person who knows — whoever wrote the widget and its mapping, in the
same PR, where the two are already side by side.

## How it gets consumed

No new resolution logic is needed on the consumer side. The path is already resolved:

1. `flutter pub get` writes the target project's `.dart_tool/package_config.json`.
2. The entry whose `name` is the DS dependency carries `rootUri` — the exact on-disk checkout for
   the version or git ref currently pinned.
3. `tokens.meta.yaml` is already read from under that `rootUri`. `component.meta.yaml` would be
   read the same way, from the component folder instead of the token folder.

Note for anyone who has heard this described as reading from "dist": there is no dist. Flutter
packages ship Dart source, and `pub get` resolves a checkout, not a build output. The file is read
from source, in place.

The skills side is **already written and already live**
(`plugins/bspace-sdlc-skills/skills/flutter-match-component/SKILL.md`). Its read order is:

1. `component.meta.yaml`, when present — preferred.
2. the widget source — fallback.

So this proposal is safe to adopt incrementally and safe to ignore. No component has a
`component.meta.yaml` today, every read falls through to the source, and behaviour is exactly what
it was before. Each file added makes one component cheaper and one prop list authoritative, with
no coordinated migration and no flag day.

## What this does not solve

- **It is a claim, not a proof.** A hand-written `inFigmaTs: true` on a prop the mapping actually
  omits is wrong in a way nothing here detects. Mitigated by being reviewed next to the
  `.figma.ts` file in the same PR, not by a check. A generator or CI check that diffs the YAML
  against both the constructor and the mapping would close this, and is the natural follow-up —
  but it is a second step, not a precondition.
- **It does not make the prop get written.** Knowing `size` exists is necessary, not sufficient.
  The consumer side handles that separately: the slicing plan stores the Code Connect snippet
  verbatim and `validate_output.py` greps the generated Dart for every prop the plan claims.
- **It adds a file per component.** Real cost, paid by the DS team, in exchange for every consumer
  stopping having to parse Dart. Worth stating plainly rather than presenting as free.

## Decision needed

Whether the DS package takes on `component.meta.yaml` as a convention alongside
`tokens.meta.yaml`. If yes, the cheap start is the components that already have known mapping
omissions — a navigation-shell component and a segmented-control component — rather than a sweep of the whole library.

If no, nothing breaks: the skills side keeps reading source, and the known-omission list keeps
growing by hand in `flutter-match-component/SKILL.md`'s gotcha table as each one is encountered.
