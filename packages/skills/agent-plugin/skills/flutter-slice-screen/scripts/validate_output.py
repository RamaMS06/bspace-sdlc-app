#!/usr/bin/env python3
"""flutter-slice-screen gate: `--init` allocates the slice folder, `--check` reads the generated code.

The gate checks code, not prose. plan.md is a short note (Sections / Assets / Evidence / Notes);
the parts read here are the tables. Fidelity is the per-section render pair scored by
diff_renders.py (geometry vs get_metadata, then pixels), re-scored here from the current renders.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diff_renders  # noqa: E402
import figma_xml  # noqa: E402
from diff_renders import file_id  # noqa: E402

HARNESS = Path(__file__).resolve().parent.parent / "assets" / "test-support" / "fidelity_harness.dart"
HARNESS_PATH = "test/support/fidelity_harness.dart"


FORBIDDEN_DIRECTORIES = {
    "data",
    "datasource",
    "datasources",
    "domain",
    "infrastructure",
    "repositories",
    "repository",
    "services",
}

FORBIDDEN_PATTERNS = {
    "unresolved template variable": re.compile(r"__(?:ScreenName|screen_name)__"),
    "placeholder layout": re.compile(r"Replace this placeholder|SizedBox\.shrink\(\)"),
    "raw Material button": re.compile(
        r"\b(?:ElevatedButton|OutlinedButton|TextButton|FilledButton)\s*\("
    ),
    "raw Material color": re.compile(r"\bColors\.[A-Za-z]+"),
    # `Icons.x` is legal, but only through `UIIcon(`, which carries the DS size scale.
    # `(?<!\w)` keeps `UIIcon(` out of the match.
    "raw Material badge/icon fallback (use UIIcon / DS badge)": re.compile(
        r"\b(?:Badge|IconButton)\s*\(|(?<!\w)Icon\s*\("
    ),
    # Figma reports sub-pixel geometry; Dart gets the integer (round half up). `.0` passes.
    "decimal geometry literal (round Figma decimals to integers)": re.compile(
        r"\b(?:width|height|left|top|right|bottom|start|end|horizontal|vertical|size|gap|spacing|"
        r"thickness|indent|endIndent|dimension)\s*:\s*-?\d+\.(?!0+\b)\d+"
        r"|\b(?:SizedBox|UIGap)[\w.]*\(\s*-?\d+\.(?!0+\b)\d+"
    ),
    "raw TextStyle (use DS typography tokens)": re.compile(r"\bTextStyle\s*\("),
    "screen-local raw text abstraction (use DS UILabel/typography)": re.compile(
        r"\bclass\s+_?(?:Body|Section|Caption|Heading|Title|Label)?Text\s+extends\s+StatelessWidget\b"
    ),
    "hardcoded colour literal (use a DS colour token)": re.compile(
        # bps_banner: `('R', …, 0xFF08A94C)` → `Color(value)` hid the hex from a Color(0x… match.
        r"\bColor\s*(?:\.from(?:ARGB|RGBO))?\s*\(\s*0x|\bColor\.from(?:ARGB|RGBO)\s*\(|\b0x[0-9A-Fa-f]{8}\b"
    ),
    "raw EdgeInsets literal (use DS paddings/margins tokens)": re.compile(
        r"\bEdgeInsets(?:\.all|\.only|\.symmetric|\.fromLTRB)?\s*\([^)]*?\b\d+(?:\.\d+)?\b"
    ),
    "raw border radius literal (use DS radius tokens)": re.compile(
        r"\b(?:BorderRadius\.circular|Radius\.circular)\s*\(\s*\d+(?:\.\d+)?\s*\)"
    ),
    "Opacity widget (put the alpha in the node's own colour token)": re.compile(r"\bOpacity\s*\("),
    "raw Text widget (use UILabel with the matching UIFont/UILabelStyle)": re.compile(
        r"(?<![\w.])Text(?:\.rich)?\s*\("
    ),
    "non-scrolling SingleChildScrollView (fix the layout; never hide an overflow)": re.compile(
        r"SingleChildScrollView\s*\((?:(?!SingleChildScrollView).){0,300}?NeverScrollableScrollPhysics",
        re.S,
    ),
    "FittedBox scaleDown (reflow Row→Column with LayoutBuilder; never shrink content)": re.compile(
        r"FittedBox\s*\((?:(?!FittedBox).){0,200}?BoxFit\.scaleDown", re.S
    ),
}

# Text wraps unless Figma cuts it; a cut needs `// Figma truncate <node-id>` on its line or the 2 above.
CUT_TEXT = re.compile(r"\boverflow\s*:\s*TextOverflow\.|\bmaxLines\s*:")

def uncited_cuts(source: str) -> int:
    lines = source.splitlines()
    return sum(
        1
        for i, line in enumerate(lines)
        if CUT_TEXT.search(line) and "Figma truncate" not in "\n".join(lines[max(0, i - 2) : i + 1])
    )

# Packages the DS locks; an override of one means the SDK is off the DS pin (environment.md §0/§8).
NODE_ID = re.compile(r"\bI?\d+:\d+")
DS_PINNED = re.compile(r"skeletonizer|syncfusion_flutter_\w+|google_fonts|flutter_screenutil|flutter_svg|lottie")
PASSING_STATUS = {"DONE", "DONE_WITH_CONCERNS"}

ASSET_KINDS = {"svg": {".svg"}, "raster": {".png", ".jpg", ".jpeg", ".webp", ".gif"}, "ds": set()}
ASSET_REF = re.compile(r"""['"](assets/[^'"\s]+\.\w+)['"]""")
SLICE_DIR_ENTRIES = {"plan.md", "spec.md", "renders", "work"}

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "screen-template" / "specs" / "__screen_name__"


def find_package_root(start: Path) -> Path | None:
    for candidate in (start, *start.parents):
        if (candidate / "pubspec.yaml").is_file():
            return candidate
    return None


SLICE_DIR = re.compile(r"\d+-.+-\d{2}_\d{2}_\d{4}")
PLAN_ID = re.compile(r"^\*\*ID:\*\*[ \t]*(\S+)", re.M)


def kebab(raw: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", raw.strip().lower())).strip("-")


def slice_slug(epic: str, screen_name: str) -> str:
    """`card-live` + `card_live_banner` → `card-live-banner`: the screen's leading epic words go."""
    screen = kebab(screen_name)
    if screen == epic or screen.startswith(epic + "-"):
        screen = screen[len(epic) :].lstrip("-")
    return f"{epic}-{screen}" if screen else epic


def plan_id(slice_dir: Path) -> str | None:
    plan = slice_dir / "plan.md"
    match = plan.is_file() and PLAN_ID.search(plan.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def find_slice_dirs(specs_dir: Path, screen_name: str) -> list[Path]:
    """Every slice folder whose plan.md `**ID:**` is this screen (`_` and `-` count as one)."""
    if not specs_dir.is_dir():
        return []
    return sorted(
        p
        for p in specs_dir.iterdir()
        if p.is_dir() and SLICE_DIR.fullmatch(p.name) and kebab(plan_id(p) or "") == kebab(screen_name)
    )


def related_slices(specs_dir: Path, screen_name: str) -> list[Path]:
    """Slices whose ID is a word-prefix of this screen or the reverse: `table_unit_status` vs
    `table_unit_status_chart` is usually one screen gaining a section, not a new screen."""
    if not specs_dir.is_dir() or find_slice_dirs(specs_dir, screen_name):
        return []
    new = kebab(screen_name)
    return sorted(
        p
        for p in specs_dir.iterdir()
        if p.is_dir()
        and SLICE_DIR.fullmatch(p.name)
        and (old := kebab(plan_id(p) or ""))
        and (new.startswith(old + "-") or old.startswith(new + "-"))
    )


def resolve_slice_dir(specs_dir: Path, screen_name: str, epic: str) -> Path:
    """Reuse this screen's folder, else allocate the next `<ID>-<slug>-<date>`."""
    existing = find_slice_dirs(specs_dir, screen_name)
    if existing:
        return existing[0]
    used = [
        int(m.group(1))
        for p in specs_dir.iterdir()
        if p.is_dir() and (m := re.match(r"(\d+)-", p.name))
    ]
    today = datetime.date.today().strftime("%d_%m_%Y")
    return specs_dir / f"{max(used, default=0) + 1:03d}-{slice_slug(epic, screen_name)}-{today}"


def write_skeleton(dest: Path, screen_name: str) -> list[str]:
    """Write plan.md/spec.md and renders/, work/raw/. Never overwrites an existing file."""
    screen_class = "".join(
        part[:1].upper() + part[1:] for part in re.split(r"[_\-\s]+", screen_name) if part
    )
    for sub in ("renders", "work/raw"):
        (dest / sub).mkdir(parents=True, exist_ok=True)
    results = []
    for name in ("plan.md", "spec.md"):
        path = dest / name
        if path.exists():
            results.append(f"kept existing {name}")
            continue
        template = (TEMPLATE / name).read_text(encoding="utf-8")
        path.write_text(
            template.replace("__ScreenName__", screen_class).replace("__screen_name__", screen_name),
            encoding="utf-8",
        )
        results.append(f"wrote {name}")
    return results


def table_rows(text: str, heading: str) -> list[list[str]]:
    """Body rows of the first table under `## heading`, header and separator dropped."""
    match = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    if not match:
        return []
    rows = []
    for line in match.group(1).splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
            continue
        rows.append(cells)
    rows = rows[1:]  # header
    return [r for r in rows if any(r)]


def pubspec_assets(package_root: Path) -> list[str]:
    # ponytail: line regex, not a YAML parser; reads every uncommented `- assets/...` entry.
    # Upgrade to a real parser if a project declares assets via flavors or `path:` maps.
    text = (package_root / "pubspec.yaml").read_text(encoding="utf-8")
    return re.findall(r"^\s*-\s*['\"]?(assets/[^'\"\s#]+)", text, re.M)


def declared(path: str, entries: list[str]) -> bool:
    return any(path == e or (e.endswith("/") and path.startswith(e)) for e in entries)


def check_plan(plan: Path, target: Path, package_root: Path, dart: dict[str, str]) -> list[str]:
    errors = []
    where = plan.relative_to(package_root).as_posix()
    text = plan.read_text(encoding="utf-8")

    sections = table_rows(text, "Sections")
    if not sections:
        errors.append(f"{where}: ## Sections has no rows (Node | Name | Widget file)")
    single = len(sections) == 1
    presentation = target / "presentation"
    renders = plan.parent / "renders"
    for row in sections:
        if len(row) < 3 or not row[2]:
            errors.append(f"{where}: Sections row {row} needs Node | Name | Widget file")
            continue
        if not (presentation / row[2]).is_file():
            errors.append(f"{where}: section {row[1]} ({row[0]}) widget file missing: presentation/{row[2]}")
        if single:
            continue  # one section: render.png/figma.png are its pair, checked with the screen
        render = renders / f"section-{file_id(row[0])}.png"
        if not render.is_file():
            errors.append(
                f"{where}: section {row[1]} ({row[0]}) has no Flutter render "
                f"{render.relative_to(package_root).as_posix()} — run its render test (SKILL.md step 8)"
            )

    pubspec = pubspec_assets(package_root)
    planned: dict[str, str] = {}
    nodes: list[str] = []
    for row in table_rows(text, "Assets"):
        if len(row) < 4:
            errors.append(f"{where}: Assets row {row} needs Node | Name | Kind | Path")
            continue
        node, name, kind, path = row[:4]
        kind = kind.lower()
        if kind not in ASSET_KINDS:
            errors.append(f"{where}: asset {name} ({node}) Kind '{kind}' must be svg | raster | ds")
            continue
        # One id form per node: a short `7:2` next to `I1:2;7:2` is the same layer downloaded twice.
        bare = node.lstrip("I")
        for other in nodes:
            if other.lstrip("I").endswith(";" + bare) or bare.endswith(";" + other.lstrip("I")):
                errors.append(
                    f"{where}: asset rows {other} and {node} are one layer — keep the full "
                    f"get_metadata id (I…;…) only"
                )
        nodes.append(node)
        if kind == "ds":
            continue
        if path in planned:
            errors.append(f"{where}: asset {path} has two rows — one row (one download) per file")
        planned[path] = kind
        suffix = Path(path).suffix.lower()
        if suffix not in ASSET_KINDS[kind]:
            want = ".svg" if kind == "svg" else ".png/.jpg"
            errors.append(
                f"{where}: asset {name} ({node}) is {kind} but path is {suffix or 'none'}; "
                f"want {want} (vector → download_assets defaultFormat svg, never the export PNG)"
            )
        if not (package_root / path).is_file():
            errors.append(f"{where}: asset {name} ({node}) file missing: {path}")
        if not declared(path, pubspec):
            errors.append(f"{where}: asset {path} not declared in pubspec.yaml flutter.assets")

    for rel, source in dart.items():
        for path in ASSET_REF.findall(source):
            kind = planned.get(path)
            if kind is None:
                errors.append(f"{rel}: uses {path}, which is not a svg/raster row in plan.md ## Assets")
            elif Path(path).suffix.lower() in ASSET_KINDS["raster"] and kind != "raster":
                errors.append(f"{rel}: uses raster {path} but plan.md marks it {kind}")
    return errors


def metadata_nodes(spec_dir: Path) -> list[ET.Element]:
    """Root nodes of every ```xml fence in work/raw/get_metadata-*.md."""
    roots = []
    for raw in sorted((spec_dir / "work" / "raw").glob("get_metadata-*.md")):
        fences = re.findall(r"```xml\s*\n(.*?)```", raw.read_text(encoding="utf-8"), re.S)
        if not fences:
            roots.append(ET.Element("unparsed", name=f"{raw.name}: no ```xml fence — save get_metadata verbatim, not a summary"))
        for fence in fences:
            try:
                roots.append(ET.fromstring(fence))
            except ET.ParseError as exc:
                roots.append(ET.Element("unparsed", name=f"{raw.name}: {exc}"))
    return roots


# `expect(tester.takeException(), isNull)`: a printed exception is a hidden overflow, not a pass.
TAKE_EXCEPTION = re.compile(r"expect\(\s*tester\.takeException\(\)\s*,\s*isNull\s*\)")

def check_harness(package_root: Path, where: str, source: str) -> list[str]:
    """The skill owns pumpDs/writeLayout: a copy edited per project silently measured nothing
    (bspace_chart: a double-escaped RegExp left layout.json empty) or paragraph glyph boxes."""
    errors = []
    copy = package_root / HARNESS_PATH
    if not copy.is_file():
        errors.append(f"{HARNESS_PATH} missing — copy <flutter-slice-screen>/assets/test-support/fidelity_harness.dart verbatim")
    elif copy.read_text(encoding="utf-8").replace("\r\n", "\n") != HARNESS.read_text(encoding="utf-8"):
        errors.append(f"{HARNESS_PATH} differs from the skill's copy — never edit it; re-copy it verbatim")
    if not re.search(r"""import\s+['"][^'"]*support/fidelity_harness\.dart['"]""", source):
        errors.append(f"{where}: render test must import '{HARNESS_PATH}' (pumpDs, writeLayout, loadDsFonts)")
    own = sorted(set(re.findall(r"^\s*(?:void|Future<void>|Widget)\s+_?(pumpDs|writeLayout|loadDsFonts|\w*(?:[Ww]rite|[Dd]ump|[Ss]ave)\w*Layout\w*)\s*\(", source, re.M)))
    if own:
        errors.append(f"{where}: defines its own {', '.join(own)} — use the harness's, unchanged")
    if "setSurfaceSize(" in source:
        errors.append(f"{where}: setSurfaceSize( sets the canvas, not the view — pumpDs sizes the view (frameWidth/sectionWidth)")
    return errors


def frame_widths(roots: list[ET.Element]) -> set[float]:
    """Figma root frame widths a render test may pump at: a root frame's own width, or a section
    placed in its frame (x + width + x). ponytail: assumes equal side margins; add the frame's own
    get_metadata when a section sits off-centre."""
    out = set()
    for r in roots:
        try:
            x, w = float(r.get("x", 0)), float(r.get("width", ""))
        except ValueError:
            continue
        out |= {round(w), round(2 * x + w)}
    return out

def check_render_test(
    package_root: Path, screen: str, roots: list[ET.Element] = ()
) -> list[str]:
    """Overflow and size drift are caught only by pumping the widget; analyze never sees them."""
    tests = sorted((package_root / "test").rglob(f"{screen}*_render_test.dart"))
    if not tests:
        return [
            f"no test/**/{screen}*_render_test.dart — write the render test "
            f"(flutter-verify-fidelity §5) and run it before --check"
        ]
    where = tests[0].relative_to(package_root).as_posix()
    source = "\n".join(t.read_text(encoding="utf-8") for t in tests)
    errors = check_harness(package_root, where, source)
    if not TAKE_EXCEPTION.search(source):
        errors.append(
            f"{where}: render test must expect(tester.takeException(), isNull) — never print or filter it "
            f"(a swallowed overflow passes a broken layout)"
        )
    for width in (320, 390, 393, 430):
        if not re.search(rf"Size\(\s*{width}(?:\.0+)?\s*,", source):
            errors.append(f"{where}: render test must pump at width {width} (flutter-run-verify §2: 320/390/393/430)")
    # bps_banner: frameWidth 412 (a designSize, not Figma) scaled every `.sp` by 412/393.
    allowed = frame_widths(roots)
    for width in re.findall(r"\bframeWidth\s*:\s*(\d+(?:\.\d+)?)", source):
        if allowed and round(float(width)) not in allowed:
            errors.append(f"{where}: pumpDs frameWidth: {width} is not the Figma root frame width "
                          f"({' or '.join(map(str, sorted(allowed)))} from get_metadata)")
    # bps_banner: `pumpDs(tester, SizedBox(height: 220, child: …))` faked the Figma height.
    for child in re.findall(r"\bpumpDs\(\s*\w+\s*,(.*?)\b(?:frameWidth|sectionWidth)\s*:", source, re.S):
        if re.search(r"\bheight\s*:|\.fromSize\(|\.expand\(|BoxConstraints", child):
            errors.append(f"{where}: pumpDs child forces a size ({' '.join(child.split())[:60]}) — pump the section "
                          f"itself; its height must come out at the Figma height on its own")
    if "didExceedMaxLines" not in source:
        errors.append(f"{where}: render test must assert no RenderParagraph didExceedMaxLines (text never cut)")
    # Headless stands in for the device: notch/home indicator and a large system font (flutter-run-verify §2).
    for needle, why in (("FakeViewPadding(", "notch/safe-area insets"), ("TextScaler.linear(", "text scale 1.3")):
        if needle not in source:
            errors.append(f"{where}: render test must pump with {needle}…) — {why} (flutter-run-verify §2)")
    return errors


# Node id only: `- chart package: …` is a Notes line about the dependency, not a chart.
CHART_LINE = re.compile(r"^-?\s*chart\s+(I?\d+:\d+(?:;\d+:\d+)*):(.*)$", re.M)
CHART_BUILDERS = re.compile(
    r"package:(syncfusion_flutter_charts|syncfusion_flutter_gauges|fl_chart)/|\bUIChart\w+\("
)
CHART_TOUCH = re.compile(r"\b(TrackballBehavior|TooltipBehavior|touchCallback)\b|\bUIChart\w+\(")


REFERENCE_LINE = re.compile(r"^-?\s*reference\s+(I?\d+:\d+(?:;\d+:\d+)*):\s*`?([^\s`]+)", re.M)


def check_references(spec_dir: Path, package_root: Path) -> list[str]:
    """`- reference <node-id>: <DS source path>` (nearest DS component the section could not use as
    is): the section's worker report names that file and what it copied (flutter-match-component)."""
    plan = spec_dir / "plan.md"
    if not plan.is_file():
        return []
    errors = []
    reports = sorted((spec_dir / "work").glob("*-report.md"))
    for node, path in REFERENCE_LINE.findall(plan.read_text(encoding="utf-8")):
        report = spec_dir / "work" / f"section-{file_id(node)}-report.md"
        report = report if report.is_file() or not reports else reports[0]
        text = "\n".join(r.read_text(encoding="utf-8") for r in reports)
        if reference_path(path).name not in text:
            errors.append(
                f"{report.relative_to(package_root).as_posix()}: section {node} has reference {path} but the "
                f"report {'is missing' if not text else 'never names it'} — read it, copy its pattern, list what was copied"
            )
    return errors


# Any Notes line starting `chart` (other than `chart package:`) must name its node.
LOOSE_CHART = re.compile(r"^-\s*chart\b(?!\s+package:)(?!\s+I?\d+:\d+(?:;\d+:\d+)*:)(.*)$", re.M)
HOSTED = re.compile(r"/hosted/[^/]+/([a-z_]\w*)-(\d+\.\d+\.\d+[^/]*)/")


def reference_path(raw: str) -> Path:
    """`/abs/file.dart:120` → the file; the line suffix is a pointer, not part of the path."""
    return Path(re.sub(r":\d+(?::\d+)?$", "", raw)).expanduser()


def check_reference_sources(spec_dir: Path, package_root: Path) -> list[str]:
    """A reference is read from disk at the version this package resolves, never another one."""
    plan = spec_dir / "plan.md"
    text = plan.read_text(encoding="utf-8") if plan.is_file() else ""
    lock = (package_root / "pubspec.lock").read_text(encoding="utf-8") if (package_root / "pubspec.lock").is_file() else ""
    errors = []
    for node, raw in REFERENCE_LINE.findall(text):
        path = reference_path(raw)
        if not path.is_file():
            errors.append(f"plan.md: reference {node}: {raw} does not exist — run chart_refs.py and cite a real file")
            continue
        hosted = HOSTED.search(path.as_posix())
        if hosted and lock:
            pkg, version = hosted.groups()
            m = re.search(rf'^  {pkg}:\n(?:    .*\n)*?    version: "([^"]+)"', lock, re.M)
            if m and m.group(1) != version:
                errors.append(f"plan.md: reference {node} is {pkg} {version}, pubspec.lock resolves {m.group(1)} — cite the resolved version")
    return errors


def chart_lines(spec_dir: Path) -> dict[str, str]:
    """`## Notes` `chart <node-id>: …` lines, node id → the rest of the line."""
    plan = spec_dir / "plan.md"
    return dict(CHART_LINE.findall(plan.read_text(encoding="utf-8"))) if plan.is_file() else {}


def check_charts(
    spec_dir: Path,
    package_root: Path,
    screen: str,
    sections: list[list[str]],
    dart: dict[str, str],
    roots: list[ET.Element],
) -> list[str]:
    """A chart is a DS UIChart* or the pinned fl_chart/Syncfusion API, interactive when it has a
    tooltip, and declared in pubspec — never a hand-painted plot (charts.md)."""
    charts = chart_lines(spec_dir)
    plan = spec_dir / "plan.md"
    plan_text = plan.read_text(encoding="utf-8") if plan.is_file() else ""
    references = dict(REFERENCE_LINE.findall(plan_text))
    nodes = {n.get("id"): n for root in roots for n in root.iter()}
    files = {row[0]: f"presentation/{row[2]}" for row in sections if len(row) > 2}
    pubspec = (package_root / "pubspec.yaml").read_text(encoding="utf-8")
    tests = "\n".join(
        t.read_text(encoding="utf-8") for t in (package_root / "test").rglob(f"{screen}*_render_test.dart")
    )
    errors = [
        f"plan.md: '- chart{rest[:60]}' names no node — write '- chart <node-id>: <type> · …' (charts.md Pick)"
        for rest in LOOSE_CHART.findall(plan_text)
    ]
    for node, rel in files.items():
        if node not in charts and CHART_BUILDERS.search(dart.get(rel, "")):
            errors.append(f"{rel}: builds a chart but plan.md has no '- chart {node}: …' Notes line — the chart checks never ran")
    for node, rest in charts.items():
        if node in nodes:
            shape = figma_xml.classify(nodes[node])
            if shape.get("insufficient"):
                errors.append(f"chart {node}: {shape['insufficient']} (figma_xml.py classify)")
        rel = files.get(node)
        if rel is None:
            errors.append(f"chart {node}: no ## Sections row — a chart is its own section")
            continue
        source = dart.get(rel, "")
        if "CustomPaint" in source:
            errors.append(f"{rel}: chart {node} hand-painted (CustomPaint) — use the DS chart or the charts.md matrix")
        if not CHART_BUILDERS.search(source):
            errors.append(f"{rel}: chart {node} builds no UIChart*, Syncfusion or fl_chart widget (charts.md Pick)")
        if "SfCartesianChart" in source:
            errors.append(f"{rel}: chart {node} uses SfCartesianChart — axis charts are fl_chart (charts.md Pick)")
        if not re.search(r"\bUIChart\w+\(", source) and node not in references:
            errors.append(
                f"plan.md: chart {node} builds no DS UIChart* and has no '- reference {node}: <DS chart "
                f"source>' Notes line — the orchestrator names the DS chart to copy from (charts.md Pick)"
            )
        for pkg in set(re.findall(r"package:(syncfusion_flutter_\w+|fl_chart)/", source)):
            if not re.search(rf"^\s+{pkg}:", pubspec, re.M):
                errors.append(f"{rel}: imports {pkg}, not in pubspec.yaml — orchestrator applies the harness: line before dispatch")
        if "tooltip" in rest.lower():
            if not CHART_TOUCH.search(source):
                errors.append(f"{rel}: chart {node} has a tooltip but no TrackballBehavior/TooltipBehavior/touchCallback")
            if "tapAt(" not in tests:
                errors.append(f"chart {node}: render test needs tester.tapAt + the tooltip assertion (charts.md Proof)")
            # Axis charts are dragged: the tooltip must follow the finger (charts.md Drag).
            if re.search(r"\b(BarTouchData|LineTouchData)\(", source) and "FlPanUpdateEvent" not in source:
                errors.append(f"{rel}: chart {node} touchCallback ignores FlPanUpdateEvent — tooltip must follow a drag")
            draggable = re.search(r"BarTouchData|LineTouchData|UIChartFixedBar", source)
            if draggable and not re.search(r"\b(dragFrom|timedDragFrom|drag|moveBy|moveTo)\(", tests):
                errors.append(f"chart {node}: render test needs a drag (tester.dragFrom) + the moved-tooltip assertion (charts.md Proof)")
    return errors


def check_section_files(target: Path, screen: str, others: list[str], sections: list[list[str]]) -> list[str]:
    """Every widgets/<screen>_*.dart but _content is a ## Sections row; else --check never saw it."""
    listed = {row[2] for row in sections if len(row) > 2}
    longer = [o for o in others if o != screen and o.startswith(screen + "_")]
    errors = []
    for path in sorted((target / "presentation" / "widgets").glob(f"{screen}_*.dart")):
        rel = f"widgets/{path.name}"
        if path.stem == f"{screen}_content" or rel in listed or any(path.name.startswith(o + "_") for o in longer):
            continue
        errors.append(f"presentation/{rel}: not a ## Sections row of {screen} — add the row (one slice per screen)")
    return errors


def last_score(spec_dir: Path, node: str) -> dict:
    return diff_renders.last(spec_dir, node) or {}


def intent_hash(path: Path) -> str:
    """Same as using-bspace-sdlc's one-liner:
    grep -vE '^(Wireframe|Status|Approved-by):' intent.md | shasum -a 256 | cut -c1-12"""
    lines = path.read_bytes().split(b"\n")
    if lines[-1] == b"":
        lines.pop()
    kept = [line + b"\n" for line in lines if not re.match(rb"(Wireframe|Status|Approved-by):", line)]
    return hashlib.sha256(b"".join(kept)).hexdigest()[:12]


def check_intent(spec_dir: Path, package_root: Path) -> list[str]:
    """G4, only when spec.md pins an intent: every intent AC is mapped (or N/A: <why>), pin is fresh."""
    spec = spec_dir / "spec.md"
    pin = re.search(r"^\*\*Intent:\*\*\s*(\S+)@([0-9a-f]{12})\s*$", spec.read_text(encoding="utf-8"), re.M) \
        if spec.is_file() else None
    if not pin:
        return []
    intent = next((p / pin.group(1) for p in (package_root, *package_root.parents) if (p / pin.group(1)).is_file()), None)
    if intent is None:
        return [f"spec.md: intent {pin.group(1)} not found from {package_root.name} or a parent"]
    errors = []
    if intent_hash(intent) != pin.group(2):
        errors.append(f"spec.md: stale intent — pin @{pin.group(2)}, {pin.group(1)} is @{intent_hash(intent)}; "
                      f"re-map the ACs and update the pin")
    mapped = set(re.findall(r"AC-\d+", spec.read_text(encoding="utf-8")))
    missing = sorted(set(re.findall(r"AC-\d+", intent.read_text(encoding="utf-8"))) - mapped)
    if missing:
        errors.append(f"spec.md: intent {', '.join(missing)} not mapped — map each AC or write 'N/A: <why>'")
    return errors


def check_run_line(spec_dir: Path) -> list[str]:
    plan = spec_dir / "plan.md"
    text = plan.read_text(encoding="utf-8") if plan.is_file() else ""
    return [f"plan.md: '{m.strip()}' — fix the run errors (flutter-run-verify §3) and record run: PASS <device>"
            for m in re.findall(r"^-?\s*run:\s*BLOCKED.*$", text, re.M)]


def check_worker_reports(spec_dir: Path, package_root: Path, sections: list[list[str]]) -> list[str]:
    """A BLOCKED/NEEDS_CONTEXT worker is unfinished work, whatever the code looks like."""
    errors = []
    stopped = [row[0] for row in sections if last_score(spec_dir, row[0]).get("stop")]
    for report in sorted((spec_dir / "work").glob("*-report.md")):
        match = re.search(r"^##\s*Status\s*:?[ \t]*(.*?)\s*$\s*(.*)$", report.read_text(encoding="utf-8"), re.M)
        line = (match.group(1) or match.group(2)) if match else ""
        status = re.match(r"[`*]*([A-Z_]+)", line)
        if status and status.group(1) in PASSING_STATUS and stopped:
            errors.append(
                f"{report.relative_to(package_root).as_posix()}: status {status.group(1)} but the render loop of "
                f"{', '.join(stopped)} stopped — the status is NEEDS_CONTEXT with the diff (flutter-verify-fidelity §1)"
            )
        if not status or status.group(1) not in PASSING_STATUS:
            errors.append(
                f"{report.relative_to(package_root).as_posix()}: status "
                f"{status.group(1) if status else 'missing'} — fix the cause and re-run the worker; "
                f"route/run only after DONE"
            )
    # The worker's DONE is a claim; the render diff score closes a section (flutter-verify-fidelity §1).
    for row in sections:
        errors.extend(diff_renders.gate(spec_dir, row[0]))
    return errors


def check_evidence(spec_dir: Path, package_root: Path) -> list[str]:
    """A value the render cannot show is only as good as its Figma source."""
    plan = spec_dir / "plan.md"
    if not plan.is_file():
        return []
    where = plan.relative_to(package_root).as_posix()
    rows = table_rows(plan.read_text(encoding="utf-8"), "Evidence")
    errors = []
    for row in rows:
        if len(row) < 3 or not NODE_ID.search(row[2]):
            errors.append(
                f"{where}: Evidence '{row[0]}' cites no Figma node id (+ field, variant or prototype) — "
                f"no source is NEEDS_CONTEXT, never a guess"
            )
        elif "NEEDS_CONTEXT" in " ".join(row):
            errors.append(f"{where}: Evidence '{row[0]}' is NEEDS_CONTEXT — ask the user, then re-run")
    for node in chart_lines(spec_dir):
        if not any(re.search(rf"\bdata\b.*{re.escape(node)}(?![\d;:])", r[0]) for r in rows):
            errors.append(f"{where}: chart {node} has no '## Evidence' row 'data {node}' — where every value comes from")
    return errors

def check_sdk_pin(package_root: Path) -> list[str]:
    """The DS pins the SDK; a build on any other SDK breaks DS-pinned packages (environment.md §0)."""
    fvmrc = package_root / ".fvmrc"
    if not fvmrc.is_file():
        return ['.fvmrc missing — write {"flutter": "<DS .fvmrc version>"} (environment.md §0)']
    try:
        pin = json.loads(fvmrc.read_text(encoding="utf-8")).get("flutter", "")
    except json.JSONDecodeError:
        return [".fvmrc is not JSON with a \"flutter\" version"]
    errors = []
    dart_tool = package_root / ".dart_tool" / "version"
    if dart_tool.is_file() and dart_tool.read_text(encoding="utf-8").strip() != pin:
        errors.append(
            f".dart_tool/version is {dart_tool.read_text(encoding='utf-8').strip()}, .fvmrc pins {pin} "
            f"— re-run pub get on the pinned SDK (environment.md §0 runner)"
        )
    xcconfig = package_root / "ios" / "Flutter" / "Generated.xcconfig"
    if xcconfig.is_file():
        match = re.search(r"^FLUTTER_ROOT=(.*)$", xcconfig.read_text(encoding="utf-8"), re.M)
        root = match.group(1).strip() if match else ""
        version = Path(root) / "version"
        on_pin = (
            Path(root).name == pin
            or root.endswith(".fvm/flutter_sdk")
            or (version.is_file() and version.read_text(encoding="utf-8").strip() == pin)
        )
        if root and not on_pin:
            errors.append(
                f"ios/Flutter/Generated.xcconfig FLUTTER_ROOT={root} is not the {pin} pin — "
                f"point the IDE at the pinned SDK and re-run pub get (environment.md §0)"
            )
    pubspec = (package_root / "pubspec.yaml").read_text(encoding="utf-8")
    overrides = re.search(r"^dependency_overrides:\s*$(.*?)(?=^\S|\Z)", pubspec, re.M | re.S)
    for name in re.findall(r"^\s+([a-z_]\w*)\s*:", overrides.group(1) if overrides else "", re.M):
        if DS_PINNED.fullmatch(name):
            errors.append(
                f"pubspec.yaml dependency_overrides: {name} is pinned by the DS — remove the "
                f"override and build on the DS SDK (environment.md §8)"
            )
    return errors


def check_screen_entry(
    target: Path, package_root: Path, screen: Path | None, sections: list[list[str]]
) -> list[str]:
    """The route opens the *Screen (Scaffold); a bare section widget renders without a page."""
    errors = []
    if screen is not None and "Scaffold(" not in screen.read_text(encoding="utf-8"):
        rel = screen.relative_to(target).as_posix()
        errors.append(f"{rel}: the screen must build a Scaffold( (UIScaffold/Scaffold)")
    presentation = target / "presentation"
    classes = set()
    for row in sections:
        widget = presentation / row[2] if len(row) > 2 and row[2] else None
        if widget and widget.is_file():
            classes.update(re.findall(r"^class\s+([A-Z]\w*)", widget.read_text(encoding="utf-8"), re.M))
    if not classes:
        return errors
    used = re.compile(rf"\b(?:{'|'.join(sorted(classes))})\b")
    for path in sorted((package_root / "lib").rglob("*.dart")):
        if presentation in path.parents:
            continue
        if used.search(path.read_text(encoding="utf-8")):
            errors.append(
                f"{path.relative_to(package_root).as_posix()}: uses a section widget — route to the "
                f"*Screen, never a section"
            )
    return errors


def check_slice_dir_shape(spec_dir: Path, package_root: Path) -> list[str]:
    where = spec_dir.relative_to(package_root).as_posix()
    return [
        f"{where}: unexpected {entry.name} at the slice-folder root — move it into work/ or renders/"
        for entry in sorted(spec_dir.iterdir())
        if entry.name not in SLICE_DIR_ENTRIES
    ]


def check_plan_tracked(spec_dir: Path, package_root: Path) -> list[str]:
    """plan.md is committed with the screen, or the next developer re-slices from scratch."""
    git = shutil.which("git")
    if git is None:
        return []
    inside = subprocess.run(
        [git, "-C", str(package_root), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
    )
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return []
    tracked = subprocess.run(
        [git, "-C", str(package_root), "ls-files", "--error-unmatch", str(spec_dir / "plan.md")],
        capture_output=True,
        text=True,
    )
    if tracked.returncode == 0:
        return []
    rel = spec_dir.relative_to(package_root).as_posix()
    return [f"{rel}: plan.md is not tracked by git — git add {rel}"]


def check(target: Path) -> tuple[list[str], int]:
    errors = []
    if not (target / "presentation").is_dir():
        errors.append(
            "missing presentation/ directory — TARGET is the feature dir that contains "
            "presentation/ (lib/features/<feature>/), not presentation/ itself"
        )
    # Only presentation/ is ours; domain/ and data/ beside it belong to later layers.
    for path in sorted((target / "presentation").rglob("*")):
        if path.is_dir() and path.name.lower() in FORBIDDEN_DIRECTORIES:
            errors.append(f"out-of-scope directory: {path.relative_to(target).as_posix()}")

    dart_files = sorted((target / "presentation").rglob("*.dart"))
    screens = [p for p in dart_files if p.name.endswith(".screen.dart")]
    if not screens:
        errors.append("no *.screen.dart file found — name the screen file <screen>.screen.dart")
    dart = {}
    for path in dart_files:
        rel = path.relative_to(target).as_posix()
        dart[rel] = path.read_text(encoding="utf-8")
        for label, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(dart[rel]):
                errors.append(f"{rel}: {label}")
        if uncited_cuts(dart[rel]):
            errors.append(
                f"{rel}: overflow:/maxLines: without // Figma truncate <node-id> "
                f"(Figma has no truncate: let the text wrap)"
            )

    package_root = find_package_root(target)
    if package_root is None:
        return [*errors, "could not locate pubspec.yaml above target"], len(dart_files)
    errors.extend(check_sdk_pin(package_root))
    names = {s.name.removesuffix(".screen.dart"): s for s in screens}
    if not screens:
        # No screen file yet: still gate the slice whose plan names widgets in this feature.
        for plan in sorted((package_root / "specs").glob("*/plan.md")):
            rows = table_rows(plan.read_text(encoding="utf-8"), "Sections")
            if any(len(r) > 2 and (target / "presentation" / r[2]).is_file() for r in rows):
                screen_name = plan_id(plan.parent)
                if screen_name:
                    names[screen_name] = None
    for name, screen in names.items():
        matches = find_slice_dirs(package_root / "specs", name)
        if len(matches) != 1:
            errors.append(
                f"expected one specs/<ID>-<slug>-<date>/ folder with plan.md **ID:** {name}, "
                f"found {len(matches)}"
            )
            continue
        spec_dir = matches[0]
        for filename in ("spec.md", "plan.md"):
            if not (spec_dir / filename).is_file():
                errors.append(f"missing {(spec_dir / filename).relative_to(package_root)}")
        sections = []
        if (spec_dir / "plan.md").is_file():
            errors.extend(check_plan(spec_dir / "plan.md", target, package_root, dart))
            sections = table_rows((spec_dir / "plan.md").read_text(encoding="utf-8"), "Sections")
        roots = metadata_nodes(spec_dir)
        errors.extend(f"work/raw: {r.get('name')}" for r in roots if r.tag == "unparsed")
        for png, source in (
            ("figma.png", "get_screenshot of the root node (SKILL.md step 4)"),
            ("render.png", "the full-screen render test writes it (flutter-verify-fidelity §5)"),
        ):
            if not (spec_dir / "renders" / png).is_file():
                errors.append(
                    f"{(spec_dir / 'renders' / png).relative_to(package_root).as_posix()} missing — {source}"
                )
        errors.extend(check_render_test(package_root, name, roots))
        plan_text = (spec_dir / "plan.md").read_text(encoding="utf-8") if (spec_dir / "plan.md").is_file() else ""
        errors.extend(figma_xml.check_slice(spec_dir, package_root, sections, dart, plan_text, set(chart_lines(spec_dir))))
        errors.extend(check_charts(spec_dir, package_root, name, sections, dart, roots))
        errors.extend(check_section_files(target, name, list(names), sections))
        errors.extend(check_worker_reports(spec_dir, package_root, sections))
        errors.extend(check_evidence(spec_dir, package_root))
        errors.extend(check_references(spec_dir, package_root))
        errors.extend(check_reference_sources(spec_dir, package_root))
        errors.extend(check_run_line(spec_dir))
        errors.extend(check_intent(spec_dir, package_root))
        errors.extend(check_screen_entry(target, package_root, screen, sections))
        errors.extend(check_slice_dir_shape(spec_dir, package_root))
        errors.extend(check_plan_tracked(spec_dir, package_root))
    return errors, len(dart_files)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--init",
        metavar="SCREEN_NAME",
        help="Write plan.md/spec.md into TARGET (the specs/ dir, created if missing) under "
        "<ID>-<epic>[-<screen minus epic>]-<DD_MM_YYYY>/, reusing this screen's folder. Needs --epic.",
    )
    parser.add_argument("--epic", help="Epic/module slug for --init, e.g. hr-gs.")
    parser.add_argument(
        "--new",
        action="store_true",
        help="With --init: the developer confirmed a new screen despite a related slice (exit 3).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check the generated feature directory TARGET (default when --init is absent).",
    )
    parser.add_argument(
        "target",
        type=Path,
        help="specs/ dir with --init (created if missing), else the feature dir containing "
        "presentation/",
    )
    args = parser.parse_args(argv)
    target = args.target.expanduser().resolve()

    if args.init is not None:
        screen_name, epic = args.init.strip(), kebab(args.epic or "")
        if not screen_name or not epic:
            print("ERROR: --init needs a screen name and --epic <slug>", file=sys.stderr)
            return 2
        target.mkdir(parents=True, exist_ok=True)
        related = [] if args.new else related_slices(target, screen_name)
        if related:
            print(
                f"ASK: {screen_name} looks related to "
                + ", ".join(f"{plan_id(p)} ({p.name})" for p in related)
                + ". A section of that screen → add a ## Sections row to its plan.md, no --init. "
                "A new screen → re-run with --new.",
                file=sys.stderr,
            )
            return 3
        slice_dir = resolve_slice_dir(target, screen_name, epic)
        for line in write_skeleton(slice_dir, screen_name):
            print(f"{line} in {slice_dir}")
        return 0

    if not target.is_dir():
        print(f"ERROR: target is not a directory: {target}", file=sys.stderr)
        return 2
    errors, count = check(target)
    if errors:
        unique = list(dict.fromkeys(errors))
        print(f"flutter-slice-screen check failed ({len(unique)} error(s)):", file=sys.stderr)
        for error in unique:
            print(f"- {error}", file=sys.stderr)
        print(
            "fix all of them in one pass and re-run once; if round 2 still fails, stop and "
            "report these errors to the user",
            file=sys.stderr,
        )
        return 1
    print(f"flutter-slice-screen check passed: {count} Dart file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
