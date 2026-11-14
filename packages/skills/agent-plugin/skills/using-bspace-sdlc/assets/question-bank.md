# Brainstorm question bank

One question per message, in this order. Skip a question when a PRD, Figma link,
`intent/constitution.md` or the code already answers it (say what answered it). Ask in plain
words; the `intent.md` field column is for the AI only.

| # | Ask (plain words) | Type | Recommendation source | `intent.md` field |
|---|---|---|---|---|
| 1 | What problem are we solving, and for whom? | open | none — user's words | `## Problem`, `## Users` |
| 2 | How will we know it worked? | open → AI proposes measurable SC | PRD, analytics | `## Success criteria` |
| 3 | How much time is this worth? | single | PRD, sprint plan | `Appetite:` |
| 4 | Which apps get it (mobile, web)? | single | repo type | `Platforms:` |
| 5 | Which situations must it handle? (e.g. "balance is 0") | multi — AI proposes from 1–3 | PRD, existing screens | `## User stories` (US/AC), `## Edge cases` |
| 6 | Anything it must or must not do? | multi | constitution, repo | `## Constraints & do's/don'ts` |
| 7 | What is explicitly out? | multi | PRD | `## No-gos`, `## Rabbit holes` |
| 8 | Which way should we build it? | single — 2–3 options, first `(Recommended)` | code, constitution | `## Approaches`, `## Decisions` |
| 9 | Is there a design already? | single: existing link / generate (designer picks file, page, placement in `figma-generate-screen` D0) / ask designer | Figma link | `Design:` |
| 10 | Playback: "Here is what I heard … agree?" | approve | — | `Status: approved`, `Approved-by:` |

A gate failure (G1/C1/G2/GD/P1) re-asks only the failing items, each with one proposed answer.
