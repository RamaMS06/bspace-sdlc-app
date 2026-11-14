# <ID> <Feature> — Design
Input: FSD | intent | brief
Target-file: <https://www.figma.com/design/<fileKey>/...>
Target-page: <existing page URL with node-id | new page "<name from designer>">
Target-placement: <beside frame URL with node-id | inside section "<name>" | new section "<name>">
Source: generated | designer
Frame: <W>×<H>
Libraries: HIHSBFb6tatYWQYl2LudlV, ULzzM260MtOJNxjuhbmxHc, EFRs93Q9rAixMNcyXiQJgm
Brief-approved-by: <name> <YYYY-MM-DD> (only when Input is brief)
Reference-brief-by: <designer> <YYYY-MM-DD>
Components-approved-by: <name> <YYYY-MM-DD>
New-pattern-approved-by: <designer> <YYYY-MM-DD> (only when a Traceability row is new-pattern)
Reviewed-by: <designer> <YYYY-MM-DD>
Metadata-hash: <shasum -a 256 of the saved get_metadata output at review, 12 chars>

## Reference Brief
<!-- D0, from the designer. Several Figma URLs per screen OK (with node-id), or new-pattern.
     Inspiration: external URL + note only; never fetched. Change a row → re-date Reference-brief-by. -->
| Screen / SCR | Figma references (URL with node-id) | Take | Avoid | Inspiration (optional) |
|---|---|---|---|---|

## Screen Brief
<!-- Only when Input is brief (no FSD/intent). One block per SCR: purpose, user, platform, data/fields,
     actions → where, states (loading/empty/error/disabled/success), do/don't. Delete otherwise. -->

## Traceability
<!-- Every screen maps to its source and an approved reference or approved new-pattern decision.
     Source: FSD SCR-xx | intent AC-xx | brief SCR-xx. -->
| Source | US | AC / BR | Screen / SCR | Reference / REF | Decision | Deviation |
|---|---|---|---|---|---|---|

## Reference Inspection
<!-- Record evidence for each REF: exact file/node, frame, safe area, background, image, typography, components, states. -->
| REF | File key | Node ID | Platform | Frame | Background source | Image / asset source | Evidence |
|---|---|---|---|---|---|---|---|

<!-- Decision: reuse | adapt | compose | new-pattern. Why lives in sdlc/figma-reference-catalog.md.
     Evidence: screenshot/metadata path under design-evidence/. TBD or blank fails C1. -->

## Components
<!-- One row per element × screen/state. Props: every prop of the component, Name=Value, from its
     definitions. Why: the source (AC, constitution, DS note, file convention, user answer).
     No DS match: Component = local (why), only with user OK. Node: filled by the build. -->
| Element | Screen / state | AC | Component (key) | Props | Why | Code Connect | Node |
|---|---|---|---|---|---|---|---|

## Flows
<!-- From each AC's When → Then. Action: navigate | open overlay (bottom|center) | back | change to <variant> -->
| From (element) | Trigger | Action | To | AC |
|---|---|---|---|---|

## Gaps
<!-- no Code Connect, local components, moving AC without a link, review notes -->
