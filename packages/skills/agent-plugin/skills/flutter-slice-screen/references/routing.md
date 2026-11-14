# Routing modes

Project routing is screened once by [project-screening.md](project-screening.md). Do not ask again
for a routing mode or route file unless the developer explicitly overrides the detected result.

## `none`

Only when explicitly requested. Do not inspect or modify routing files.

## `suggest`

Only when explicitly requested. Return a concise route snippet, required import, and exact
destination detected during screening. Do not edit the route file.

## `auto` — default

Use the registry fixed by [project-screening.md](project-screening.md) §3. Follow the existing
router's style. No routing package or registry → install and wire per
[environment.md](environment.md) §5. Never introduce typed routing or migrate another router.

Before editing, check for an existing path/name/screen registration. After editing, verify exactly
one registration and run package analysis. If insertion into an existing non-standard registry is
unsafe, stop with a concrete blocker; do not silently fall back to repeated questions.

**Under orchestration:** frame workers never edit the shared registry. Each reports its proposed
entry; the orchestrator applies entries serially after workers finish. See
[orchestration.md](orchestration.md).
