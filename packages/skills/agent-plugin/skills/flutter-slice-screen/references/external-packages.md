# External (non-BUMA-DS) package usage

A Figma node can require a widget with no BUMA Design System equivalent — chart, map, lottie
animation, and similar. A package is eligible only when the screened node proves the capability is
needed and no resolved dependency already covers it. This file is the single source for constraint
priority.

## Resolution order

1. **Target `pubspec.yaml` first.** Reuse an existing dependency serving the capability. Preserve
   its constraint exactly.
2. **Confirm it is resolved.** Check `.dart_tool/package_config.json` for the package and `rootUri`.
3. **Resolved Design System `pubspec.yaml` second.** When the target lacks the package, read the
   exact constraint from the `buma_design_system` checkout selected through package config.
4. **Approved inventory third.** If the Design System does not declare it, use the exact constraint
   from [package-inventory.md](package-inventory.md).
5. **No approved constraint.** Record a package gap. Do not search pub.dev, invent a version, use
   `any`, or choose a newer release.

## Apply only what the screen needs

When steps 3 or 4 resolve a missing package, append one `harness:` line in `## Notes` —
`Pending (auto-apply before generation)`, exact YAML, source (`design-system pubspec` or `approved
inventory`). Deduplicate across the screen/batch; never ask a package/version question. Apply,
probe and override handling: [environment.md](environment.md) §5, §6, §8.

## Usage and styling

- Grep the target package's `lib/` for existing usage and mirror its construction/theming pattern.
- Widget composition is screen-local custom code, but every visual value still resolves through
  [tokens.md](tokens.md). Raw literals remain limited to genuinely non-visual values without a token
  equivalent, such as `Colors.transparent` on a hidden fill.
- Never add packages speculatively, duplicate capabilities, or upgrade unrelated constraints.
