# BUMA DS API — quick reference

Snapshot of the `buma_design_system` public API that slices use most. Use it instead of grepping
`.pub-cache`. A member not listed here, or a `--check`/`analyze` error naming one → read **that one**
category's `tokens.meta.yaml` ([tokens.md](tokens.md) "Locate the catalog"), never a broad grep.
Matching rules (variable first, semantic over primitive, nearest + gap) stay in [tokens.md](tokens.md).

Import: `package:buma_design_system/buma_design_system.dart` only.

## Colour — `UIColor.of(context)`

| Group | Members |
| --- | --- |
| `.text` | white, light, lightDark, dark, success, successBolder, secondary, secondaryBolder, error, errorBolder, info, infoBolder, warning, warningBolder |
| `.icon` | white, light, lightDark, dark, success, secondary, error, info, warning |
| `.background` | white, light, lightDark, dark, {success,secondary,error,info,warning,neutral}{Subtle,,Bolder} |
| `.stroke` | white, light, lightDark, dark, button, success, successBolder, secondary, secondaryBolder, error, errorBolder, info, infoBolder, warning, warningBolder |
| `.shadow` | percent10, percent15, percent20, percent25, percent50 |

Primitive only when Figma names Base: `UIColor.base.primary[500]` (primary, secondary, neutral,
success, warning, info, danger, grey). Never `Color(0x…)`, `Colors.*` or the Light-only static
`UIColor.text.*`.

## Spacing scale

Steps `xs2 xs sm md lg xl xl2 xl3 xl4 xl5` = `4 8 12 16 24 32 40 48 64 80`. No 20 (nearest + gap).

| Need | API |
| --- | --- |
| inner padding | `UIPadding.{all,top,bottom,left,right,horizontal,vertical}.<step>` — an `EdgeInsets` |
| outer margin | `UIMargin.{…same directions…}.<step>` |
| gap between Column/Row children | `UIGap.h2xs hxs hsm hmd hlg hxl h2xl h3xl h4xl h5xl` (4 8 12 16 20 24 32 48 64 80), `UIGap.w…` |
| gap in `CustomScrollView` | `UIGapSliver.h…`/`.w…` |
| spacer/size double | `SpacingSize.<step>` |

Direction first: `UIPadding.all.md`, never `UIPadding.md` or `EdgeInsets.all(16)`. Mixed sides →
`EdgeInsets.only(left: SpacingSize.md, top: SpacingSize.sm)` — token doubles, never number
literals (`--check` fails a digit inside `EdgeInsets(...)`).
`UIGap.*` are `static final`, not `const` — a `children:` list holding one cannot be `const`.

## Radius, stroke, elevation

- `UIRadius.sm md lg xl rd` = 5 10 20 30 full — already a `BorderRadius`: `borderRadius: UIRadius.md`,
  never `BorderRadius.circular(…)`. Static non-const fields: no `const BoxDecoration(...)` around them.
- `UIStrokeSize.xs sm md lg xl` = 1–5: `Border.all(width: UIStrokeSize.xs, color:
  UIColor.of(context).stroke.button)`.
- `boxShadow: [UIElevation.raised]` (ambient, raised, overlay, button, table.left/right, tooltip,
  toast, toggle).

## Typography

`style: UIFont.<group>.<name>`, colour via `.copyWith(color: UIColor.of(context).text.…)`. Figma →
token table: [tokens.md](tokens.md) "Typography".

## Icon — `UIIcon`

```dart
UIIcon(Icons.info_outline, size: UIIconSize.sm, color: UIColor.of(context).icon.info)
```

- **Not `const`.** `UIIcon(...)` has no const constructor; drop `const` from the call and from any
  enclosing `const` list/widget (`flutter analyze`: *The constructor being called isn't a const
  constructor*).
- `UIIconSize.xs sm md lg xl xl2 xl3` = 8 16 24 32 40 64 80; default `md`. Never a raw double.

## Responsive

`.w`/`.h`/`.sp` come from the transitive `flutter_screenutil`; the app root wraps
`ScreenUtilInit(designSize: UIResponsive.designSize(MediaQuery.of(context).size.width),
minTextAdapt: true, …)` ([environment.md](environment.md) §5). The barrel does not export
`ScreenUtilInit` — import `package:flutter_screenutil/flutter_screenutil.dart` where it is built.

**Not everything scales.** `UIResponsive.designSize` is 360×690 up to 400 wide, 412×740 up to 480.
On a 390/393 phone `.sp` text is ~1.09× and `.h` gaps ~1.23× their Figma value, while number
literals (`SizedBox(width: 153)`, icon sizes) and `const` paddings stay put. A Figma line that
fits exactly at the Figma width therefore runs out of room at 393 — the tightest common width for
text, which is why the render test pumps it. The section grows taller than its Figma bounds there;
that is the app's scale, not a layout bug (the render diff runs at the Figma width).

**Text style comes from the spec.** `work/spec-<id>.md` `## Texts` `DS` column names the style per
TEXT node (read from the resolved DS source); `--check` fails a `UILabel` with another style, and a
data-driven `UILabel(metric.plan, …)` whose style no text of its section's spec has. `⚑` =
no `UILabelStyle` member: `DefaultTextStyle.merge` with that `UIFont` token.

**DS text quirks.** `UILabelStyle.body` (`UIFont.body`) has no line height (renders 17, Figma 16):
wrap the section's content in `DefaultTextStyle.merge(style: UIFont.body.defaultStyle, …)` with a
`// ponytail:` comment — labels whose style sets a height ignore it. `UILabel(...)` drops
`softWrap` (always `false` in the base constructor); wrapping comes from width constraints, never
from the flag.
