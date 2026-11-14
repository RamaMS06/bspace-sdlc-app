# Charts

Single source for chart work. Read this, not package docs or the web. The user judges a chart by
**look and behaviour against Figma**, not by package; pick whatever reproduces both with the least
custom code.

## Pins

Verified against source at these versions (`~/.pub-cache/hosted/pub.dev/<pkg>-<version>/lib`). A
different resolved version in the target `pubspec.lock` → re-verify the rows used before trusting
them. Both packages are declared by `buma_design_system` (`.fvmrc` Flutter 3.27.4), so the
constraint comes from the DS `pubspec.yaml` ([external-packages.md](external-packages.md) step 3);
never override it.

| Package | Version | API reference |
|---|---|---|
| `fl_chart` | 1.0.0 (needs Flutter ≥ 3.27.4) | https://pub.dev/documentation/fl_chart/1.0.0/ |
| `syncfusion_flutter_gauges` | 23.2.4 | https://pub.dev/documentation/syncfusion_flutter_gauges/23.2.4/ |
| `syncfusion_flutter_charts` | 23.2.4 | https://pub.dev/documentation/syncfusion_flutter_charts/23.2.4/ |

The fl_chart GitHub `main` README and `help.syncfusion.com` track the latest release — never a source.
`super_tooltip` (DS-declared) is for non-chart popovers; a chart tooltip comes from the chart package.

## Read Figma first

The pick comes from the chart node's verbatim `get_metadata` XML (`work/raw/get_metadata-<id>.md`,
the ```xml fence as returned, every node with its x/y/width/height — a summary or a pruned subtree is
no evidence) plus its `get_design_context`. A layer named `Chart` says nothing: the type comes from
the shapes. Run, per chart:

```bash
python3 <skill-dir>/scripts/figma_xml.py classify work/raw/get_metadata-<id>.md <chart-id>
```

| Shapes | Type |
|---|---|
| 3+ equal-width sibling frames, each holding marks, x step constant | column (same left, different widths → bar) |
| several marks per column, same x | stacked; all columns the same height → stacked 100% |
| several marks per column, different x | grouped |
| a `vector`/`line` spanning ≥ half the plot | line, or an overlay when columns exist |
| 2+ concentric ellipses | pie/donut |
| 5+ small round dots | scatter |
| one arc / ellipse | gauge / progress arc |
| a box with 2+ texts, one numeric, over the plot | tooltip candidate |

It prints type, points, series, stacking, bar width and gap, overlay and tooltip ids, DS instances.
Exit 3 = a childless frame covers the plot (get_metadata pruned it): re-fetch `get_metadata` on that
node; still empty → `NEEDS_CONTEXT` naming it — never a guessed chart. Stacked 100% gives shares
only: absolute values (tooltip, labels) need per-point evidence (Data). Then read, per chart:

| Read | From | Decides |
|---|---|---|
| mark shape | column/bar/line/slice/arc geometry | matrix row |
| series count | segments per column, legend items | DS widget or the stacked bar pattern |
| points | column frames (one per point, not per axis label) | data length |
| geometry (width, gap, radius, heights) | the column frames' x/y/width/height | the widget's values, scored by the render diff |
| line over the bars | a `vector` spanning the plot | overlay `LineChart` — its data is evidence too |
| floating tooltip + content | frame over the plot | `· tooltip`, overlay content, a `mask` line |
| behaviour | prototype interactions, variants (chips, selected state) | `## Evidence` rows |

Each reading the code uses is a `## Evidence` row with its node id; geometry the render diff
checks needs no rule of its own — a wrong bar width, gap, radius or stacking shows up as diff
pixels on the column nodes. The Notes line is the summary, e.g. `chart 10306:79036: column ·
4 × 24 · fl_chart stacked bar · UIChartFixedBar: 4 series · tooltip`.

## Pick

1. **DS chart** via `flutter-match-component` — exported from the barrel:

   | DS widget | Built on | Fits |
   |---|---|---|
   | `UIChartFixedBar` | fl_chart | bars with one value + one optional stack (**2 series max**), no value labels, no overlay line, legend, tap/drag tooltip + vertical indicator |
   | `UIChartDonut` | Syncfusion | solid-wedge part-of-whole, legend, tap tooltip, enlarge on tap |
   | `UIChartDonutProgress` | CustomPaint | rounded progress arcs, optional remainder track |
   | `UIChartGaugeSolid` | syncfusion_gauges | single value against a max, half/full arc |

   Each has `component.meta.yaml` (`whenToUse`, `aiHints`) beside its source; follow its hints
   (`barWidth`/`barSpacing` from the XML, `expandWidth: true` when the bars fill the plot).
2. **No DS fit** → the package the DS builds that family on. Bar/column/line/area/scatter/
   candlestick/radar → **fl_chart** (rod width and gap are pixels, as Figma's are); bar/column →
   the stacked bar pattern below, for any series count. Radial bar / gauge → Syncfusion.
   `SfCartesianChart` is never used: its width is a ratio of an auto-padded category, so Figma's
   pixel geometry never lands.
3. Record one `## Notes` line: `chart <node-id>: <type> · <series × points> · <DS widget | pattern>
   · <why the DS widget did not fit>[ · tooltip]`. `· tooltip` when Figma shows a floating container.
   Every chart has one; a `chart:` line without a node id, or chart code in a section with no
   chart line, fails `--check`.
4. **Reference code, version-exact** — never memory, never the web:

   ```bash
   python3 <skill-dir>/scripts/chart_refs.py <package-root> <type> [tooltip] [stacked] [overlay] [area]
   ```

   Reads `pubspec.lock` + `.dart_tool/package_config.json` (pub get first), then greps the DS
   chart sources, their `component.meta.yaml` `whenToUse`, the DS chart tests, and the resolved
   package's own `example/`. The best hit goes in the brief as `- reference <chart-id>: <path>:<line>`;
   the worker copies its pattern. `--check` fails a reference file that does not exist and a
   hosted package path at another version than `pubspec.lock`.

**The orchestrator decides, before dispatch.** It picks the package, applies its `harness:` line
from the DS `pubspec.yaml` ([external-packages.md](external-packages.md)), writes the Notes line,
and puts `chart package: <name> <version>` in the brief. A worker never writes `pubspec.yaml`, so a
worker left to pick ends up hand-painting.

**Never hand-painted.** No `CustomPaint`/`CustomPainter` plot and no `Positioned` tooltip with fixed
values. A Figma feature no package covers → `NEEDS_CONTEXT`, not a painter.

Only the plot comes from the package. Legend, header, chips, value labels and tooltip content are DS
widgets (`UILabel`, colour tokens, `UIDivider`).

## Stacked bar pattern — every bar/column chart past `UIChartFixedBar`

A plain bar chart is this pattern with one series (one stack item, one colour). A legend chip that
shows one series (a Figma variant with only that colour, values printed) is the same widget: one
stack item, `maxY` from the data, value labels on. All series → stacked; equal Figma column heights
→ each bar normalised to 100. Geometry, touch and overlay are copied from `UIChartFixedBar`
(`chart.fixed.bar.dart` in the DS): read it before writing this.

```dart
// Column frame width and x step − width from the XML (here 12.75 / 1); scaled to the real width.
const _barWidth = 12.75;
const _barGap = 1.0;

LayoutBuilder(builder: (context, c) {
  final n = points.length;
  // −0.5: fl_chart switches to spaceEvenly when bars overflow by a rounding error.
  final scale = (c.maxWidth - 0.5) / (n * _barWidth + (n - 1) * _barGap);
  final w = _barWidth * scale, gap = _barGap * scale;
  double centerX(int i) => i * (w + gap) + w / 2;
  return Stack(clipBehavior: Clip.none, children: [
    Positioned.fill(
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.start,
          groupsSpace: gap,
          minY: 0,
          maxY: stacked100 ? 100 : maxY,
          gridData: const FlGridData(show: false),
          borderData: FlBorderData(show: false),
          titlesData: _titles, // bottom only: SideTitles(reservedSize: <label frame h + gap>), every n-th
          barTouchData: BarTouchData(handleBuiltInTouches: false, touchCallback: _handleTouch),
          barGroups: [
            for (var i = 0; i < n; i++)
              BarChartGroupData(x: i, barRods: [
                BarChartRodData(toY: _stack(i).last.toY, width: w, borderRadius: _radius, rodStackItems: _stack(i)),
              ]),
          ],
        ),
        duration: Duration.zero,
      ),
    ),
    // Value labels, overlay line, indicator + tooltip: Positioned at centerX(i), DS widgets.
  ]);
});

List<BarChartRodStackItem> _stack(int i) {
  final sum = series.fold(0.0, (a, s) => a + s.value(points[i]));
  final items = <BarChartRodStackItem>[];
  var from = 0.0;
  for (final s in series) { // bottom → top, Figma order
    final to = from + (stacked100 ? s.value(points[i]) * 100 / sum : s.value(points[i]));
    items.add(BarChartRodStackItem(from, to, s.color));
    from = to;
  }
  return items;
}

void _handleTouch(FlTouchEvent event, BarTouchResponse? response) {
  final index = response?.spot?.touchedBarGroupIndex;
  switch (event) {
    case FlTapUpEvent():
      setState(() => _selected = index == _selected ? null : index);
    case FlPanStartEvent() || FlPanUpdateEvent() || FlLongPressStart() || FlLongPressMoveUpdate():
      if (index != null) setState(() => _selected = index);
    default:
      break;
  }
}
```

- **Overlay line** (a `vector` over the bars): a `LineChart` in the same `Stack` with `minX: 0`,
  `maxX: c.maxWidth`, the same `minY`/`maxY` and bottom `reservedSize`, spots at
  `FlSpot(centerX(i), v)`, `FlTitlesData` hidden, `lineTouchData: const LineTouchData(enabled:
  false)`. Its values follow the Data rule; no source → `NEEDS_CONTEXT` naming the vector's id.
- **Value labels**: `Positioned` `UILabel` per bar, centred on `centerX(i)`, bottom at the bar top.
- **Bar heights that disagree with the printed values** (two bars at one height, different labels):
  the values win; name the bars in the report — never fit the data to the pixels.

## Feature matrix (fl_chart 1.0.0)

| Figma feature | API |
|---|---|
| Column / bar, stacked, stacked 100% | the pattern above (`BarChartRodData.rodStackItems`) |
| Line / spline / area | `LineChart` + `LineChartBarData` (`isCurved`, `belowBarData`) |
| Pie / donut (no DS fit) | `PieChart` + `PieChartSectionData` (`centerSpaceRadius`) |
| Scatter / bubble | `ScatterChart` |
| Candlestick / OHLC | `CandlestickChart` |
| Radar | `RadarChart` |
| Range / waterfall | `fromY` on a rod |
| Radial bar / gauge | Syncfusion `SfCircularChart` + `RadialBarSeries`; `SfRadialGauge` (gauges pkg) |
| Axis label every n | `SideTitles(interval:, getTitlesWidget:)` |
| Hide grid / axis line | `FlGridData(show: false)`, `FlBorderData(show: false)` |
| Fixed max | `maxY` / `minY` |
| Reference line | `ExtraLinesData` + `HorizontalLine` / `VerticalLine` |
| **Tooltip, custom widget** | `BarTouchData(handleBuiltInTouches: false, touchCallback: …)` / `LineTouchData(handleBuiltInTouches: false, …)` + `Stack`/`Positioned` overlay (built-in `BarTooltipItem` is `TextSpan` only) |
| **Vertical line at selection** | overlay at `centerX(selected)` (`UIChartFixedBar`), or `ExtraLinesData(verticalLines: …)` |
| **Tap / drag selection** | `touchCallback`: `FlTapUpEvent` selects, `FlPanStartEvent`/`FlPanUpdateEvent`/`FlLongPressMoveUpdate` move it |
| Legend | DS widgets |
| Animation (off in goldens) | chart `duration: Duration.zero` (default 150 ms; `swapAnimationDuration` is deprecated) |

A feature missing here → read the pinned source, then add one row citing the class/field. Never
from memory.

## Tooltip = floating container

A container **absolutely positioned over the plot** whose content is per-point values (series dot +
label + value, a header for the x) is a tooltip, whatever its layer name. A vertical line through
the selected bar/point is the selection indicator. Behaviour:

- initial: hidden, no selection;
- tap on the plot: selects the nearest x, shows tooltip + indicator;
- drag on an axis chart (bar, column, line, area): the tooltip shows on the first move, without a
  tap first, and moves to each x the finger crosses, content updated;
- it stays visible after the finger lifts; tapping the selected x again clears it (as `UIChartFixedBar`);
- the tooltip widget is the Figma container sliced like any section (DS widgets, tokens) in the
  `Positioned` overlay — never the package's default tooltip look;
- content is built from that point's data and the series shown, never the Figma strings;
- the Figma tooltip is one sample: its values are evidence for that point's series.

`--check` skips TEXT nodes inside a node named by a `## Notes` `chart <node-id>:` line: axis labels,
value labels and tooltip values come from the data, not Dart literals.

A floating box with static content (a target label, an average annotation) is not a tooltip — it
always shows. Unsure → ask once.

## Data

Values come from Figma, never invented. Order of evidence: printed labels/values in the node
(tooltip, data labels, axis) → segment geometry: value = segment height ÷ plot height × axis max
(stacked 100%: × 100), rounded half up. Segments drawn overlapping (each tucked under the next):
visible slice = the next segment's top − its own top. Check the derived values against the Figma
tooltip sample for that point; off by more than 1 unit, or geometry that does not resolve →
`NEEDS_CONTEXT` with the column's node id; never guess, never a repeated pattern. Approximated,
"derived", estimated or preview data, or a static tooltip, is `NEEDS_CONTEXT`, never
`DONE_WITH_CONCERNS` — `--check` fails a report that says so.

## Proof — one render, a tap and a drag assertion

- **Look:** the normal render (animation off, the `data` Evidence values) scored by
  `diff_renders.py` against the section's Figma render, the Figma tooltip node masked
  (`- mask <tooltip-id>: tooltip hidden until tap`) — no tooltip may show. No extra PNG for the
  selected state.
- **Tap:** in the same test, `tester.tapAt` the centre of the bar Figma shows selected, pump,
  then `expect(find.byType(<TooltipWidget>), findsOneWidget)` and `find.text` for that point's
  values; pump again after the gesture ends and expect it still there.
- **Drag** (axis charts): `tester.dragFrom(<first bar centre>, Offset(<n bars × bar pitch>, 0))`,
  pump, expect the tooltip with the last crossed point's values (not the tapped one's).

## `--check`

Per `chart <node-id>:` Notes line: the node is a `## Sections` row with a passing render score;
`## Evidence` has a `data <node-id>` row with a source; its file builds a `UIChart*` or
fl_chart/Syncfusion widget, never `CustomPaint` or `SfCartesianChart`, and imports only packages in
`pubspec.yaml`. Bar/column: the XML has column frames with sized segments (a stub or pruned subtree
fails; `figma_xml.py classify` exit 3 fails too). Shape (width, gap, alignment, radius, stacking) is not a literal rule: the render diff
fails it. With `· tooltip`: `touchCallback` handling `FlPanUpdateEvent` (or a `UIChart*`), and
the render test calls `tester.tapAt` and, for an axis chart, `tester.dragFrom`.
