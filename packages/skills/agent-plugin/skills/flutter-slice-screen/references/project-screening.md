# One-pass project screening

Run this once, before collecting any input beyond the Figma node URL. The result fixes, for the
whole run: the package root, the presentation **convention**, the routing destination/mode, and the
dependency sources. Reuse those for every frame/worker; never ask the same structural question
again.

Screening does **not** fix the presentation **destination**: the convention is a rule (container
names, filename suffixes, screen/content split); the destination is that rule applied to one
screen's feature slug. A batch spanning two features has two destinations — never reuse the first
screen's.

## 1. Locate the Flutter package

Find the nearest `pubspec.yaml` from the supplied working target. Stay inside that package. Record
whether it is an established project (`lib/` contains Dart source) or an empty/new package. A new
root is scaffolded on the DS's pinned Flutter SDK ([environment.md](environment.md) §0).

## 2. Detect the presentation convention, then derive each screen's destination

Explicit paths in the developer's prompt always win. Otherwise inspect `lib/` once:

1. Find existing presentation conventions: `presentation/`, then screen containers used inside it
   (`screens/`, `pages/`, `views/`), filename suffixes, and whether siblings split screen/content.
   This is the run-wide part — detected once, reused by every frame and worker.
2. Then, **per screen**, resolve the destination by applying that convention to the feature slug
   **this screen** belongs to (inferred per [orchestration.md](orchestration.md) §1 for a batch; for
   a lone screen it is the one slug its own frame infers). If one existing presentation destination
   is relevant to that feature, use it. If several exist, select deterministically: exact
   screen/feature slug match first, then the convention used by the most sibling features. Create
   the new screen under that convention; do not ask for an exact target directory.
3. If no presentation convention exists, use `lib/features/<feature>/presentation/` (tests in
   `test/features/<feature>/presentation/`).

After screening, do not ask for screen name, target feature directory, route, package details, or
specs location when metadata supports a deterministic inference. The only routine user input is the
epic name from SKILL.md. A true multi-feature conflict may still stop under the blocker contract;
preserve the safest option first and never silently overwrite local work.

The specs path is fixed, not inferred from user choice: `<package-root>/specs/`. Create or reuse that
directory automatically. `.slice/specs/` and every other alternate specs directory are invalid.

Record each screen's resolved path as the `target:` line in its `plan.md` `## Notes`, and in a batch
also in `.slice-orchestration/<batch-id>/progress.md`'s `target feature dir` column.

## 3. Select the routing destination

Routing defaults to `auto` unless the developer explicitly requested `none` or `suggest`.

1. Detect the router package and the registry actually wired from `main.dart`. A wired registry is
   authoritative.
2. With no wired registry, inspect directories/files named `route`, `routes`, `router`, or `routing`.
   Reuse the existing top-level `lib/` convention. Prefer a directory containing router declarations;
   otherwise prefer the shallowest path, then lexical order for a deterministic tie-break.
3. If a relevant routing directory exists but no registry does, create `app_router.dart` there.
4. If no routing convention exists, create `lib/core/router/app_router.dart`.

Do not ask for a route file or routing mode after this screening. Existing registrations stay intact;
only the new screen entry and required imports/wiring may be added. Record mode and registry on the
`target:` line in `plan.md` `## Notes`. Modes and editing rules: [routing.md](routing.md).

## 4. Protect local work and deletions

Before proposing files, inspect Git/worktree state for every target path and shared file this run may
touch. A tracked file deleted locally is intentional local state until the developer says otherwise;
do not recreate it merely because the Figma screen or default file tree expects it. Likewise, do not
overwrite an existing modified file or replace its structure silently.

When target output conflicts with existing or locally deleted work, ask once with 2–4 concrete
options. Put the safest preservation choice first and label it `(Recommended)`:

1. **Preserve local state (Recommended)** — keep deletions/modifications, skip conflicting writes,
   and continue only where safe.
2. **Recreate or overwrite target files** — explicit authorization to reverse the named deletions or
   replace the named files; list every affected path before asking.
3. **Cancel this slice** — make no further slicing changes.

Tailor labels when another safe path exists, but keep the recommended preservation option first.
The recommendation is a displayed default, not consent: unanswered means stop, and recreation or
overwrite always needs the developer's explicit selection. Never emit only `BLOCKED: target already
deleted locally`; include the options and their consequences.

## 5. Screen dependency sources

Locate the three constraint sources now — target `pubspec.yaml`, the resolved `buma_design_system`
`pubspec.yaml`, [package-inventory.md](package-inventory.md). Their priority order and the
eligibility rule live in [external-packages.md](external-packages.md) "Resolution order".
