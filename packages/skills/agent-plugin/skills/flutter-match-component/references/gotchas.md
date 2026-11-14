# Known component gotchas

DS components with real constructor props that Code Connect's `.figma.ts` mapping omits. Confirmed
by reading each component's source against its mapping. When a resolved component appears here,
every listed prop gets an explicit, evidence-backed value in its `## Notes` line — never
`(defaults)`, never the Code Connect example's literal.

The check fires the moment a component is matched, for a whole screen or a one-component fix.

| DS component | Props Code Connect omits | Rule |
| --- | --- | --- |
| `UISegmentedSwitch` | `isHugging`, `hasShadow`, `spacing`, `indicatorSize`, `withAnimation` | `isHugging` follows the instance's main-axis sizing in `get_design_context` (flutter-slice-screen 4d): `hug` → `true`; `fill` → `false` **and** the call site wrapped in `Expanded`/`Flexible`. Item count is not the trigger. `hasShadow` = the instance carries a `DROP_SHADOW`. The example always hardcodes a generic 4-item template; use the instance's real items. |
| `UITabSwitch` | `fillWidth`, `size` | `fillWidth` from the instance's sizing; `size` from the snippet or variant — omitted `size:` renders `small`. |
| `UITabBar` | `isScrollable`, `alignment` | The mapping states it as a comment: more than 4 tabs → `alignment: TabAlignment.start`, `isScrollable: true`. Default `fill` with 4 tabs overflowed inside the DS at a real viewport. Per-item `UITabBarItem.leftIcon`/`rightIcon` come from each item's `Has L/R Icon` booleans. |
| `UIAppBar` | `bottom` | Real param on every named constructor. Figma AppBar's last child is a divider/line → `bottom: PreferredSize(preferredSize: Size.fromHeight(1), child: UIDivider.horizontal())`. Not for body-flow tabs. |
| `UILabel` | `softWrap` (base constructor hardcodes it), line height of `UILabelStyle.body` | Never pass `overflow:`/`maxLines:` unless the TEXT node has `truncate`/`line-clamp` (flutter-slice-screen 4d). Body line height: `DefaultTextStyle.merge(UIFont.body.defaultStyle)` per [ds-api.md](../../flutter-slice-screen/references/ds-api.md) §Responsive. |
| Any node meeting the floating criteria (observed: `UISegmentedSwitch`) | placement, not a prop | `Scaffold.floatingActionButton` only per SKILL.md "Floating placement". |

Add a row when a source read finds another omitted prop. Do not build a full constructor index: the
DS package changes per release and a stale index is confidently wrong.
