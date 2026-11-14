#!/usr/bin/env python3
"""Version-exact chart code references, from disk: no web, no memory, no MCP.

Run: python3 chart_refs.py <package-root> <type> [tooltip] [stacked] [overlay] [area]

<type> is figma_xml.py classify's: column | bar | line | pie/donut | gauge/progress arc | scatter.
Reads the resolved versions from the package's pubspec.lock / .dart_tool/package_config.json, then
greps, in this order: the DS chart sources + their component.meta.yaml aiHints + DS chart tests,
then the resolved package's own example/. Prints `path:line: code` hits; the orchestrator copies
the best into the brief as `- reference <node-id>: <path>[:line]` (charts.md Pick)."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

# Terms per chart type and feature: the API that draws it in the DS-pinned packages.
TERMS = {
    "column": ("fl_chart", ["BarChartData(", "BarChartAlignment", "BarChartRodData("]),
    "bar": ("fl_chart", ["BarChartData(", "rotationQuarterTurns", "BarChartRodData("]),
    "line": ("fl_chart", ["LineChartData(", "LineChartBarData(", "isCurved"]),
    "pie/donut": ("syncfusion_flutter_charts", ["DoughnutSeries", "PieChartSectionData(", "centerSpaceRadius"]),
    "gauge/progress arc": ("syncfusion_flutter_gauges", ["SfRadialGauge(", "RangePointer(", "RadialAxis("]),
    "scatter": ("fl_chart", ["ScatterChartData(", "ScatterSpot("]),
}
FEATURES = {
    "tooltip": ["touchCallback", "FlPanUpdateEvent", "FlTapUpEvent", "handleBuiltInTouches"],
    "stacked": ["rodStackItems", "BarChartRodStackItem("],
    "overlay": ["LineChart(", "ExtraLinesData("],
    "area": ["belowBarData", "BarAreaData("],
}
PER_TERM = 4


def packages(root: Path) -> dict[str, Path]:
    config = root / ".dart_tool" / "package_config.json"
    if not config.is_file():
        return {}
    out = {}
    for p in json.loads(config.read_text(encoding="utf-8")).get("packages", []):
        uri = p.get("rootUri", "")
        path = Path(unquote(urlparse(uri).path)) if uri.startswith("file:") else (config.parent / uri).resolve()
        out[p["name"]] = path
    return out


def locked(root: Path, name: str) -> str | None:
    lock = root / "pubspec.lock"
    m = lock.is_file() and re.search(rf"^  {name}:\n(?:    .*\n)*?    version: \"([^\"]+)\"", lock.read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


def hits(files: list[Path], term: str) -> list[str]:
    out = []
    for f in files:
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if term in line:
                out.append(f"{f}:{n}: {line.strip()[:120]}")
                if len(out) >= PER_TERM:
                    return out
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) < 2 or args[1] not in TERMS or any(a not in FEATURES for a in args[2:]):
        print(__doc__, file=sys.stderr)
        return 2
    root, kind, features = Path(args[0]).expanduser().resolve(), args[1], args[2:]
    resolved = packages(root)
    if not resolved:
        print(f"{root}: no .dart_tool/package_config.json — run pub get on the pinned SDK first", file=sys.stderr)
        return 1
    pkg, terms = TERMS[kind]
    terms = terms + [t for f in features for t in FEATURES[f]]
    if "fl_chart" not in pkg and any(f in features for f in ("stacked", "overlay")):
        pkg = "fl_chart"
    ds = resolved.get("buma_design_system")
    print(f"# {kind} {' '.join(features)}".rstrip())
    if ds:
        chart = ds / "lib/src/components/organisms/chart"
        print(f"\n## DS {ds}")
        for meta in sorted(chart.rglob("component.meta.yaml")):
            text = meta.read_text(encoding="utf-8")
            name = re.search(r"^\s*(?:name|class):\s*(\S+)", text, re.M)
            when = re.search(r"^\s*whenToUse:\s*[>|]?-?\s*\n?\s*(.+)$", text, re.M)
            print(f"{meta}: {name.group(1) if name else meta.parent.name} — {when.group(1).strip()[:140] if when else ''}")
        files = sorted(chart.rglob("*.dart")) + sorted((ds / "test").rglob("*chart*_test.dart"))
        for term in terms:
            for h in hits(files, term):
                print(h)
    base = resolved.get(pkg)
    version = locked(root, pkg)
    print(f"\n## {pkg} {version or '(not in pubspec.lock)'} {base or ''}".rstrip())
    if base is None:
        print(f"{pkg} is not resolved here — the orchestrator adds it within the DS constraint, then pub get "
              f"(environment.md); until then the DS sources above are the reference", file=sys.stderr)
        return 0
    if version and not base.name.endswith(version):
        print(f"{base} is not {pkg} {version} from pubspec.lock — run pub get", file=sys.stderr)
        return 1
    example = sorted((base / "example").rglob("*.dart")) or sorted((base / "lib").rglob("*.dart"))
    for term in terms:
        for h in hits(example, term):
            print(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
