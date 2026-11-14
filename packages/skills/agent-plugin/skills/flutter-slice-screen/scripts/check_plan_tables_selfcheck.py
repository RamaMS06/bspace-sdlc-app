#!/usr/bin/env python3
"""Self-check for validate_output.py: --init skeleton, --check code + plan Sections/Assets.

Run: python3 check_plan_tables_selfcheck.py"""

import contextlib
import io
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import validate_output as vo  # noqa: E402
import diff_renders as dr  # noqa: E402
import figma_xml as fx  # noqa: E402

CLEAN_DART = """import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

class DemoContent extends StatelessWidget {
  const DemoContent({super.key});
  @override
  Widget build(BuildContext context) =>
      Row(key: const Key('1:2'), children: [
        SvgPicture.asset('assets/images/demo/demo_hauler.svg', width: 24, height: 24),
        const UILabel('Plan: 20.000', style: UILabelStyle.bodySmall),
      ]);
}
"""

METADATA = """# get_metadata 1:2

```xml
<frame id="1:2" name="Content" x="0" y="0" width="120.4" height="24">
  <text id="I1:2;3:4" name="Plan: 20.000" x="28" y="4" width="80" height="16" />
  <frame id="I1:2;3:5" name="Group" x="0" y="0" width="0" height="0" />
  <instance id="I1:2;10829:163943" name="hauler" x="0" y="0" width="24" height="24" />
</frame>
```
"""

DESIGN_CONTEXT = """const imgHauler = "https://www.figma.com/api/mcp/asset/hauler.svg";
<div data-node-id="1:2"><div className="font-['Poppins:Medium'] text-[11px]" data-node-id="I1:2;3:4"><p className="leading-[16px]">Plan: 20.000</p></div>
<div data-node-id="I1:2;10829:163943" data-name="hauler"><img alt="" src={imgHauler} /></div></div>
SUPER CRITICAL: convert
"""

RENDER_TEST = """import '../support/fidelity_harness.dart';
for (final s in const [Size(320, 568), Size(390, 844), Size(393, 852), Size(430, 932)]) {}
expect(tester.takeException(), isNull);
expect(p.didExceedMaxLines, isFalse);
tester.view.padding = const FakeViewPadding(top: 177);
const TextScaler.linear(1.3);
"""


def png(w: int, h: int) -> bytes:
    """Header-only PNG: validate_output reads the IHDR size, never the pixels."""
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))


def image(path: Path, w: int = 120, h: int = 24, box=None, color=(30, 30, 30)) -> None:
    """Real pixels: white, a dark text-like bar at 28,4 80x16, optional `box` (x, y, w, h) in `color`."""
    px = [(255, 255, 255)] * (w * h)
    for x0, y0, bw, bh, c in ((28, 4, 80, 16, (30, 30, 30)), *([(*box, color)] if box else [])):
        for y in range(y0, min(h, y0 + bh)):
            for x in range(x0, min(w, x0 + bw)):
                px[y * w + x] = c
    dr.write_png(path, w, h, px)

LAYOUT = '{"nodes": {"1:2": [0, 0, 120.4, 24], "I1:2;10829:163943": [0, 0, 24, 24]}, "texts": [{"text": "Plan: 20.000", "rect": [28, 4, 80, 16]}]}'

EVIDENCE = "| Property | Value | Source |\n| --- | --- | --- |"

def evidence(slice_dir: Path, row: str) -> None:
    plan = slice_dir / "plan.md"
    plan.write_text(plan.read_text(encoding="utf-8").replace(EVIDENCE, EVIDENCE + "\n" + row), encoding="utf-8")

def score(slice_dir: Path, node: str = "1:2") -> int:
    with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
        return dr.main([str(slice_dir), node])

def run(argv):
    # Fixtures edit widgets after writing renders; a real render test re-renders after each edit.
    for arg in argv:
        for render in arg.parents[2].glob("specs/*/renders/*.png") if isinstance(arg, Path) and "lib" in arg.parts else []:
            os.utime(render, (max(render.stat().st_mtime, *(w.stat().st_mtime for w in arg.rglob("*.dart"))),) * 2)
    err = io.StringIO()
    with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
        code = vo.main([str(a) for a in argv])
    return code, err.getvalue()


def metadata(slice_dir: Path, text: str) -> None:
    """Save get_metadata and re-run spec on it, as the skill does after every fetch."""
    (slice_dir / "work/raw/get_metadata-1-2.md").write_text(text, encoding="utf-8")
    xml = text.split("```xml\n")[1].split("```")[0] if "```xml\n" in text else text
    (slice_dir / "work/raw/get_metadata-1-2.json").write_text(dr.json.dumps([{"type": "text", "text": xml}]), encoding="utf-8")
    dc = (slice_dir / "work/raw/get_design_context-1-2.md").read_text(encoding="utf-8")
    try:
        doc = fx.spec(dc, "1:2", slice_dir / "work/raw/get_metadata-1-2.md", slice_dir.parent.parent)
    except (SystemExit, vo.ET.ParseError):
        return  # unparsable metadata: --check reports it, no spec to refresh
    (slice_dir / "work/spec-1-2.md").write_text(doc, encoding="utf-8")


def project(root: Path, assets_rows: str, dart: str = CLEAN_DART, files=("demo_hauler.svg",)):
    """A tiny package: pubspec, specs slice via --init, feature dir, asset files."""
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)  # no specs/: --init must create it
    (root / "pubspec.yaml").write_text(
        "name: demo\nflutter:\n  assets:\n    - assets/images/demo/\n", encoding="utf-8"
    )
    (root / ".fvmrc").write_text('{"flutter": "3.27.4"}\n', encoding="utf-8")
    assert run(["--init", "demo", "--epic", "HR GS", root / "specs"])[0] == 0
    slice_dir = vo.find_slice_dirs(root / "specs", "demo")[0]
    plan = slice_dir / "plan.md"
    text = plan.read_text(encoding="utf-8")
    text = text.replace(
        "|  |  | widgets/demo_<section>.dart |", "| 1:2 | Content | widgets/demo_content.dart |"
    )
    text = text.replace(
        "| Node | Name | Kind | Path |\n| --- | --- | --- | --- |",
        "| Node | Name | Kind | Path |\n| --- | --- | --- | --- |\n" + assets_rows,
    )
    plan.write_text(text, encoding="utf-8")
    feature = root / "lib/features/demo/presentation"
    (feature / "widgets").mkdir(parents=True)
    (feature / "demo.screen.dart").write_text(
        "Widget build(_) => const Scaffold(body: DemoContent());\n", encoding="utf-8"
    )
    (feature / "widgets/demo_content.dart").write_text(dart, encoding="utf-8")
    (root / "assets/images/demo").mkdir(parents=True)
    for name in files:
        (root / "assets/images/demo" / name).write_bytes(b"x")
    image(slice_dir / "renders/figma.png")
    image(slice_dir / "renders/render.png")
    (slice_dir / "work/raw/get_design_context-1-2.md").write_text(DESIGN_CONTEXT, encoding="utf-8")
    metadata(slice_dir, METADATA)
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT, encoding="utf-8")
    assert score(slice_dir) == 0
    (root / "test/demo").mkdir(parents=True)
    (root / "test/support").mkdir()
    shutil.copyfile(vo.HARNESS, root / vo.HARNESS_PATH)
    (root / "test/demo/demo_render_test.dart").write_text(RENDER_TEST, encoding="utf-8")
    return root / "lib/features/demo", slice_dir


SVG_ROW = "| 10829:163943 | hauler | svg | assets/images/demo/demo_hauler.svg |"

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "pkg"
    DS_BAR = Path(tmp) / "ds/lib/src/components/organisms/chart/fixed.bar/chart.fixed.bar.dart"
    DS_BAR.parent.mkdir(parents=True)
    DS_BAR.write_text("// UIChartFixedBar\n", encoding="utf-8")

    # --init: folder name, skeleton, idempotent.
    feature, slice_dir = project(root, SVG_ROW)
    assert re.fullmatch(r"001-hr-gs-demo-\d{2}_\d{2}_\d{4}", slice_dir.name), slice_dir.name
    assert (slice_dir / "work/raw").is_dir() and (slice_dir / "renders").is_dir()
    assert run(["--init", "demo", "--epic", "hr-gs", root / "specs"])[0] == 0
    assert len(vo.find_slice_dirs(root / "specs", "demo")) == 1
    assert run(["--init", "demo", root / "specs"])[0] == 2, "--epic is required"
    # Folder slug: the screen's leading epic words are not repeated; `_` reads as `-`.
    specs = root / "specs"
    for screen, epic, slug in (
        ("card_live_banner", "card-live", "002-card-live-banner"),
        ("banner", "banner", "003-banner"),
        ("table_unit_status", "Table Unit", "004-table-unit-status"),
        ("task_screen", "hr-gs", "005-hr-gs-task-screen"),
    ):
        assert run(["--init", screen, "--epic", epic, specs])[0] == 0
        (made,) = vo.find_slice_dirs(specs, screen)
        assert re.fullmatch(rf"{slug}-\d{{2}}_\d{{2}}_\d{{4}}", made.name), made.name
    assert run(["--init", "card_live_banner", "--epic", "card-live", specs])[0] == 0
    assert len(vo.find_slice_dirs(specs, "card_live_banner")) == 1, "re-run reuses the folder"
    old = specs / "009-card-live-card_live_old-19_10_2026"  # pre-0.1.36 name, found by plan ID
    old.mkdir()
    (old / "plan.md").write_text("**ID:** card_live_old\n", encoding="utf-8")
    assert vo.find_slice_dirs(specs, "card_live_old") == [old]
    (specs / "010-orphan-19_10_2026").mkdir()  # no plan.md: never matched
    assert vo.find_slice_dirs(specs, "orphan") == []
    plan_lines = (slice_dir / "plan.md").read_text(encoding="utf-8").count("\n")
    assert plan_lines < 60, f"skeleton plan grew to {plan_lines} lines"

    # Clean package passes (git check is skipped outside a repository).
    code, err = run(["--check", feature])
    assert code == 0, err

    # Hauler exported as PNG (the 0.1.23 bug): plan says svg, file is png.
    png_row = "| 10829:163943 | hauler | svg | assets/images/demo/demo_hauler.png |"
    feature, _ = project(root, png_row, CLEAN_DART.replace(".svg", ".png"), ("demo_hauler.png",))
    code, err = run(["--check", feature])
    assert code == 1 and "is svg but path is .png" in err, err

    # Same PNG, plan marks nothing: Dart reference to an unplanned asset fails.
    feature, _ = project(root, "", CLEAN_DART.replace(".svg", ".png"), ("demo_hauler.png",))
    code, err = run(["--check", feature])
    assert code == 1 and "not a svg/raster row" in err, err

    # A real photo marked raster passes.
    photo = "| 10829:163943 | photo | raster | assets/images/demo/demo_hauler.png |"
    feature, _ = project(root, photo, CLEAN_DART.replace(".svg", ".png"), ("demo_hauler.png",))
    assert run(["--check", feature])[0] == 0

    # DS icon row needs no file.
    feature, _ = project(root, SVG_ROW + "\n| 1:7 | chevron | ds | - |")
    assert run(["--check", feature])[0] == 0

    # Missing asset file, missing pubspec entry, bad kind.
    feature, _ = project(root, SVG_ROW, files=())
    assert "file missing" in run(["--check", feature])[1]
    feature, _ = project(root, SVG_ROW.replace("demo/demo_hauler", "other/demo_hauler"))
    assert "not declared in pubspec" in run(["--check", feature])[1]
    feature, _ = project(root, SVG_ROW.replace("| svg |", "| vector |"))
    assert "must be svg | raster | ds" in run(["--check", feature])[1]

    # Section widget file missing.
    feature, _ = project(root, SVG_ROW)
    (feature / "presentation/widgets/demo_content.dart").rename(
        feature / "presentation/widgets/other.dart"
    )
    assert "widget file missing" in run(["--check", feature])[1]

    # Code rules: hardcoded colour, raw Icon(, decimal geometry, out-of-scope dir.
    for bad, label in (
        ("Color(0xFF112233)", "hardcoded colour"),
        ("[(\'R\', 0xFF08A94C)]", "hardcoded colour"),  # bps_banner: hex table → Color(value)
        ("Icon(Icons.add)", "raw Material badge/icon"),
        ("SizedBox(width: 13.5)", "decimal geometry"),
        ("Container(width: 12.75)", "decimal geometry"),
        ("TextStyle(fontSize: 12)", "raw TextStyle"),
    ):
        feature, _ = project(root, SVG_ROW, CLEAN_DART + f"\nfinal x = {bad};\n")
        assert label in run(["--check", feature])[1], label
    feature, _ = project(root, SVG_ROW, CLEAN_DART + "\nfinal x = UIIcon(Icons.add);\n")
    assert run(["--check", feature])[0] == 0, "UIIcon( must not match raw Icon("
    feature, _ = project(root, SVG_ROW)
    (feature / "presentation/data").mkdir()
    assert "out-of-scope directory" in run(["--check", feature])[1]
    (feature / "presentation/data").rmdir()
    (feature / "domain").mkdir()  # later layers sit beside presentation/
    code, err = run(["--check", feature])
    assert code == 0, err

    # No render test / no takeException / no Flutter section render (the banner overflow shipped this way).
    feature, slice_dir = project(root, SVG_ROW)
    (root / "test/demo/demo_render_test.dart").unlink()
    assert "demo*_render_test.dart" in run(["--check", feature])[1]
    feature, slice_dir = project(root, SVG_ROW)
    (root / "test/demo/demo_render_test.dart").write_text("// pumps only\n", encoding="utf-8")
    err = run(["--check", feature])[1]
    assert "takeException" in err, err
    assert "width 320" in err and "width 393" in err and "width 430" in err, err
    assert "didExceedMaxLines" in err, err
    assert "FakeViewPadding(" in err and "TextScaler.linear(" in err, err
    # chart_test (0.1.46): a printed exception hid a 130px overflow.
    for bad, want in (
        ("final e = tester.takeException(); if (e != null) debugPrint('$e');", "expect(tester.takeException(), isNull)"),
    ):
        test = RENDER_TEST.replace("expect(tester.takeException(), isNull);", "") if "debugPrint" in bad else RENDER_TEST
        (root / "test/demo/demo_render_test.dart").write_text(test + bad + "\n", encoding="utf-8")
        assert want in run(["--check", feature])[1], want
    (root / "test/demo/demo_render_test.dart").write_text(RENDER_TEST + "SizedBox(height: 8);\n", encoding="utf-8")
    code, err = run(["--check", feature])
    assert code == 0, err
    # bps_banner: frameWidth 412 (a designSize) and a SizedBox of the Figma height around the section.
    pump = "await pumpDs(tester, SizedBox(height: 24, child: const DemoContent()), frameWidth: 412, sectionWidth: 120);\n"
    (root / "test/demo/demo_render_test.dart").write_text(RENDER_TEST + pump, encoding="utf-8")
    err = run(["--check", feature])[1]
    assert "frameWidth: 412 is not the Figma root frame width (120 from" in err, err
    assert "pumpDs child forces a size (SizedBox(height: 24" in err, err
    (root / "test/demo/demo_render_test.dart").write_text(RENDER_TEST + "await pumpDs(tester, const DemoContent(), frameWidth: 120);\n", encoding="utf-8")
    code, err = run(["--check", feature])
    assert code == 0, err
    # One section: figma.png/render.png are its pair. Two: each needs its own pair at Figma size.
    feature, slice_dir = project(root, SVG_ROW)
    plan = slice_dir / "plan.md"
    plan.write_text(
        plan.read_text(encoding="utf-8").replace(
            "| 1:2 | Content | widgets/demo_content.dart |",
            "| 1:2 | Content | widgets/demo_content.dart |\n| 9:9 | Footer | widgets/demo_content.dart |",
        ),
        encoding="utf-8",
    )
    err = run(["--check", feature])[1]
    assert "has no Flutter render" in err and "section-1-2.png" in err and "section-9-9.png" in err, err
    (slice_dir / "renders/section-9-9.png").write_bytes(png(1, 1))  # 9:9 has no metadata bounds
    err = run(["--check", feature])[1]
    assert "9:9: render pair never scored" in err, err
    # A section render off the Figma size is scored as such (diff_renders), not a separate check.
    image(slice_dir / "renders/section-1-2-figma.png")
    image(slice_dir / "renders/section-1-2.png", h=690)
    assert score(slice_dir) == 1
    assert "render 120x690 vs Figma 120x24" in run(["--check", feature])[1]
    # 2+ sections: the section pair is scored, not figma.png/render.png.
    for name in ("section-1-2.png", "section-1-2-figma.png"):
        image(slice_dir / "renders" / name)
    assert score(slice_dir) == 0
    err = run(["--check", feature])[1]
    assert "1:2:" not in err and "9:9: render pair never scored" in err, err
    assert score(slice_dir, "9:9") == 1  # no metadata node: geometry error, never a pass
    assert "no node 9:9 in work/raw/get_metadata" in run(["--check", feature])[1]

    # Same layer listed with two id forms, or one file in two rows → downloaded twice.
    wave_long = "| I10306:78999;7712:27567 | wave | svg | assets/images/demo/demo_hauler.svg |"
    wave_short = "| 7712:27567 | wave | svg | assets/images/demo/demo_wave.svg |"
    feature, _ = project(root, wave_long + "\n" + wave_short, files=("demo_hauler.svg", "demo_wave.svg"))
    assert "are one layer" in run(["--check", feature])[1]
    feature, _ = project(root, SVG_ROW + "\n" + SVG_ROW.replace("10829:163943", "1:5"))
    assert "has two rows" in run(["--check", feature])[1]
    # Siblings that merely share a suffix digit are not duplicates.
    feature, _ = project(
        root,
        "| I1:2;3:4 | a | svg | assets/images/demo/demo_hauler.svg |\n"
        "| I1:2;13:4 | b | svg | assets/images/demo/demo_wave.svg |\n"
        "| 10829:163943 | hauler | ds | - |",
        files=("demo_hauler.svg", "demo_wave.svg"),
    )
    code, err = run(["--check", feature])
    assert code == 0, err

    # Stray file at slice root.
    feature, slice_dir = project(root, SVG_ROW)
    (slice_dir / "brief.md").write_text("x", encoding="utf-8")
    assert "unexpected brief.md" in run(["--check", feature])[1]

    # Banner regressions (0.1.33): each one alone fails --check.
    for bad, label in (
        ("Opacity(opacity: 0.5, child: x)", "Opacity widget"),
        ("Text('a', style: UIFont.body.bold)", "raw Text widget"),
        ("Text.rich(span)", "raw Text widget"),
        (
            "SingleChildScrollView(physics: const NeverScrollableScrollPhysics(), child: x)",
            "non-scrolling SingleChildScrollView",
        ),
        ("FittedBox(fit: BoxFit.scaleDown, child: x)", "FittedBox scaleDown"),
        ("UILabel('a', overflow: TextOverflow.ellipsis)", "without // Figma truncate"),
        ("UILabel('a', maxLines: 1)", "without // Figma truncate"),
    ):
        feature, _ = project(root, SVG_ROW, CLEAN_DART + f"\nfinal x = {bad};\n")
        assert label in run(["--check", feature])[1], label
    for ok in (
        "RichText(text: span)",
        "TextSpan(text: 'a')",
        "SingleChildScrollView(child: x)",
        "FittedBox(fit: BoxFit.cover, child: x)",
        "// Figma truncate 1:2\n    UILabel('a', maxLines: 1, overflow: TextOverflow.ellipsis)",
    ):
        feature, _ = project(root, SVG_ROW, CLEAN_DART + f"\nfinal x = {ok};\n")
        code, err = run(["--check", feature])
        assert code == 0, (ok, err)

    feature, slice_dir = project(root, SVG_ROW)
    (slice_dir / "work/section-1-2-report.md").write_text(
        "## Status: BLOCKED (test gate blocked by environment)\n", encoding="utf-8"
    )
    assert "status BLOCKED" in run(["--check", feature])[1]
    (slice_dir / "work/section-1-2-report.md").write_text("## Status\n\nDONE\n", encoding="utf-8")
    assert run(["--check", feature])[0] == 0

    feature, slice_dir = project(root, SVG_ROW)
    (root / ".fvmrc").unlink()
    assert ".fvmrc missing" in run(["--check", feature])[1]
    feature, slice_dir = project(root, SVG_ROW)
    (root / ".dart_tool").mkdir()
    (root / ".dart_tool/version").write_text("3.35.7\n", encoding="utf-8")
    (root / "ios/Flutter").mkdir(parents=True)
    (root / "ios/Flutter/Generated.xcconfig").write_text(
        "FLUTTER_ROOT=/Users/x/fvm/versions/3.35.7\n", encoding="utf-8"
    )
    with (root / "pubspec.yaml").open("a", encoding="utf-8") as f:
        f.write("dependency_overrides:\n  skeletonizer: 2.1.0\n  intl: 0.19.0\n")
    err = run(["--check", feature])[1]
    for want in (".dart_tool/version is 3.35.7", "FLUTTER_ROOT=", "dependency_overrides: skeletonizer"):
        assert want in err, (want, err)
    assert "intl" not in err, err
    (root / ".dart_tool/version").write_text("3.27.4\n", encoding="utf-8")
    (root / "ios/Flutter/Generated.xcconfig").write_text(
        "FLUTTER_ROOT=/Users/x/pkg/.fvm/flutter_sdk\n", encoding="utf-8"
    )
    (root / "pubspec.yaml").write_text(
        "name: demo\nflutter:\n  assets:\n    - assets/images/demo/\n", encoding="utf-8"
    )
    assert run(["--check", feature])[0] == 0
    # global SDK (no FVM) on the pin: FLUTTER_ROOT's version file is the pin
    (root / "sdk").mkdir()
    (root / "sdk/version").write_text("3.27.4\n", encoding="utf-8")
    (root / "ios/Flutter/Generated.xcconfig").write_text(
        f"FLUTTER_ROOT={root / 'sdk'}\n", encoding="utf-8"
    )
    assert run(["--check", feature])[0] == 0
    (root / "sdk/version").write_text("3.35.7\n", encoding="utf-8")
    assert "FLUTTER_ROOT=" in run(["--check", feature])[1]

    feature, slice_dir = project(root, SVG_ROW, CLEAN_DART.replace("'Plan: 20.000'", "'Plan'"))
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace("Plan: 20.000", "Plan"), encoding="utf-8")
    assert "text I1:2;3:4 'Plan: 20.000': not laid out" in run(["--check", feature])[1]
    # Charts (bspace_tester table_unit_status_chart, 0.1.36): a hand-painted plot with a static
    # tooltip, a package missing from pubspec and no tap test each fail.
    fl = CLEAN_DART.replace("'Plan: 20.000'", "'Plan'").replace(
        "import 'package:flutter_svg/flutter_svg.dart';",
        "import 'package:flutter_svg/flutter_svg.dart';\nimport 'package:fl_chart/fl_chart.dart';",
    ) + "\nfinal d = LineTouchData(touchCallback: (e, r) { if (e is FlTapUpEvent) {} });\nfinal c = LineChart(data);\n"
    feature, slice_dir = project(root, SVG_ROW, fl)
    line_meta = METADATA.replace('width="0" height="0" />', 'width="0" height="0" />\n  <vector id="1:9" name="Vector" x="0" y="4" width="120" height="16" />')
    metadata(slice_dir, line_meta)
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace('"nodes": {', '"nodes": {"1:9": [0, 4, 120, 16], '), encoding="utf-8")
    with (slice_dir / "plan.md").open("a", encoding="utf-8") as f:
        f.write("- chart 1:2: line · 4 × 24 · fl_chart · tooltip\n")
    err = run(["--check", feature])[1]
    assert "chart 1:2 has no '## Evidence' row 'data 1:2'" in err, err
    evidence(slice_dir, "| data 1:2 | tooltip 13:00 R 24 | I1:2;3:4 text |")
    err = run(["--check", feature])[1]
    assert "imports fl_chart, not in pubspec" in err, err
    assert "tester.tapAt" in err, err
    assert "'Plan: 20.000'" not in err, "chart text is data, not a literal"
    # Drag must move the tooltip: a tap-only touchCallback and no drag test both fail.
    assert "ignores FlPanUpdateEvent" in err and "tester.dragFrom" in err, err
    with (root / "pubspec.yaml").open("a", encoding="utf-8") as f:
        f.write("dependencies:\n  fl_chart: 1.0.0\n")
    with (root / "test/demo/demo_render_test.dart").open("a", encoding="utf-8") as f:
        f.write("await tester.tapAt(const Offset(60, 12));\nawait tester.dragFrom(o, const Offset(40, 0));\n")
    widget = feature / "presentation/widgets/demo_content.dart"
    widget.write_text(fl.replace("e is FlTapUpEvent", "e is FlTapUpEvent || e is FlPanUpdateEvent"), encoding="utf-8")
    # chart_test (0.1.46): no DS chart fits → the orchestrator names the DS source to copy from.
    err = run(["--check", feature])[1]
    assert "no '- reference 1:2: <DS chart source>'" in err, err
    with (slice_dir / "plan.md").open("a", encoding="utf-8") as f:
        f.write(f"- reference 1:2: {DS_BAR}:490\n")
    report = slice_dir / "work/section-1-2-report.md"
    report.write_text("## Status\nDONE\n", encoding="utf-8")
    assert "report never names it" in run(["--check", feature])[1]
    report.write_text("## Status\nDONE\n\n## Notes\n- copied from chart.fixed.bar.dart: touch, overlay\n", encoding="utf-8")
    code, err = run(["--check", feature])
    assert code == 0, err
    # bspace_chart 002 (0.1.42): SfCartesianChart pads its categories — axis charts are fl_chart.
    widget.write_text(
        fl.replace("import 'package:fl_chart/fl_chart.dart';", "import 'package:syncfusion_flutter_charts/charts.dart';")
        + "final s = SfCartesianChart(trackballBehavior: TrackballBehavior(enable: true));\n",
        encoding="utf-8",
    )
    err = run(["--check", feature])[1]
    assert "uses SfCartesianChart" in err and "imports syncfusion_flutter_charts" in err, err
    painted = "\nfinal p = CustomPaint(painter: _P());\n"
    widget.write_text(CLEAN_DART.replace("'Plan: 20.000'", "'Plan'") + painted, encoding="utf-8")
    err = run(["--check", feature])[1]
    assert "hand-painted (CustomPaint)" in err and "builds no UIChart*" in err, err
    assert "no TrackballBehavior" in err, err
    (slice_dir / "plan.md").write_text(
        (slice_dir / "plan.md").read_text(encoding="utf-8").replace("chart 1:2:", "chart 7:7:"),
        encoding="utf-8",
    )
    assert "chart 7:7: no ## Sections row" in run(["--check", feature])[1]

    # bspace_coba chart (0.1.39): every Figma column 131px tall → stacked 100%. Columns are
    # frame > frame > group > overlapping instances, plus a label frame below (as Figma returns it).
    col = (
        '<frame id="C{i}" name="Frame" x="{x}" y="0" width="12.75" height="155">'
        '<frame id="F{i}" name="Frame" x="0" y="0" width="12.75" height="131">'
        '<frame id="G{i}" name="Group" x="0" y="-0.0003" width="12.75" height="131">'
        '<instance id="A{i}" name="Frame 34719" x="0" y="0" width="12.75" height="115" />'
        '<instance id="B{i}" name="Bar" x="0" y="{y}" width="12.67" height="{h}" />'
        "</frame></frame>"
        '<frame id="L{i}" name="Frame" x="-1.6" y="139" width="16" height="16" /></frame>'
    )
    cols = "".join(col.format(i=i, x=i * 13.75, y=54.84 + i, h=76.16 - i) for i in range(6))
    chart_meta = f'# get_metadata 1:2\n\n```xml\n<frame id="1:2" name="Chart" x="0" y="0" width="120" height="24">{cols}<instance id="I1:2;10829:163943" name="hauler" x="0" y="0" width="24" height="24" /><text id="I1:2;3:4" name="Plan: 20.000" x="28" y="4" width="80" height="16" /></frame>\n```\n'
    bar = fl.replace("LineTouchData(", "BarTouchData(").replace("LineChart(data)", "BarChart(BarChartData(maxY: 45))")
    feature, slice_dir = project(root, SVG_ROW, bar)
    metadata(slice_dir, chart_meta)
    with (slice_dir / "plan.md").open("a", encoding="utf-8") as f:
        # bspace_chart (0.1.41): `chart package:` is a dependency note, never chart node "package".
        f.write("- chart 1:2: column · stacked 100% · 4 × 6 · fl_chart stacked bar\n- chart package: fl_chart 1.0.0\n")
    with (root / "pubspec.yaml").open("a", encoding="utf-8") as f:
        f.write("dependencies:\n  fl_chart: 1.0.0\n")
    evidence(slice_dir, "| data 1:2 | column heights | C0..C5 Bar 1:2 get_metadata height |")
    with (slice_dir / "plan.md").open("a", encoding="utf-8") as f:
        f.write(f"- reference 1:2: {DS_BAR}:490\n")
    (slice_dir / "work/section-1-2-report.md").write_text("## Status\nDONE\n- chart.fixed.bar.dart: geometry\n", encoding="utf-8")
    # Each part of the section (here: the columns) carries its Key, so a diff names the part.
    err = run(["--check", feature])[1]
    assert "layout has no Key('C0') for part 'Frame'" in err, err
    keys = ", ".join(f'"C{i}": [{i * 13.75}, 0, 12.75, 155]' for i in range(6))
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace('"nodes": {', '"nodes": {' + keys + ", "), encoding="utf-8")
    # Bar shape (width, gap, alignment, maxY) is the render diff's job, not a literal rule.
    code, err = run(["--check", feature])
    assert code == 0, err
    # bspace_chart 002: instances without geometry (pruned XML) measure nothing, not 0px.
    metadata(slice_dir, re.sub(r'(<instance [^>]*?) width="[\d.]+" height="[\d.]+"', r"\1", chart_meta))
    err = run(["--check", feature])[1]
    assert "get_metadata did not expand the plot" in err, err
    # A hand-written stub in a ```xml fence has no columns to measure, and is not verbatim.
    stub = '```xml\n<frame id="1:2" name="Chart" width="120" height="24"><bar-group id="1:3" width="12"><segment fill="red" /></bar-group></frame>\n```\n'
    (slice_dir / "work/raw/get_metadata-1-2.md").write_text(stub)
    err = run(["--check", feature])[1]
    assert "get_metadata did not expand the plot" in err, err
    # A prose summary saved as metadata is no evidence.
    metadata(slice_dir, "- Node: 1:2, fixed 155px plot\n")
    assert "no ```xml fence" in run(["--check", feature])[1]

    # The score closes a section, not a verifier's word (bspace_chart 001: "PASS" at 32% diff).
    feature, slice_dir = project(root, SVG_ROW)
    iters = slice_dir / "work/iter/1-2"
    shutil.rmtree(iters)
    image(slice_dir / "renders/render.png", box=(0, 0, 30, 24), color=(220, 40, 40))
    assert score(slice_dir) == 1, "first diff: fix and re-render"
    first = dr.json.loads((iters / "score.json").read_text(encoding="utf-8"))
    assert first["fidelity"] < dr.PASS_AT and "1:2" in [n["id"] for n in first["nodes"]], first
    assert (iters / "diff.png").is_file() and (iters / "render.png").is_file() and not (iters / "1").exists()
    assert "!*/score.json" in (iters.parent / ".gitignore").read_text(encoding="utf-8"), "only score.json is tracked"
    err = run(["--check", feature])[1]
    assert "1:2: render does not match Figma" in err and "the loop is open" in err, err
    # bps_banner: 9 renders guessed with no verifier. A failed round needs a fresh verify.md first.
    assert score(slice_dir) == 5, "no verifier after a fail: refused"
    verify = slice_dir / "work/section-1-2-verify.md"
    verify.write_text("1:2 Content — Figma white (fill) vs Flutter red\n", encoding="utf-8")
    assert score(slice_dir) == 5, "the verifier skipped the hauler node"
    def explain(extra: str = "") -> None:
        verify.write_text("1:2 Content, I1:2;10829:163943 hauler — Figma white vs Flutter red\n" + extra, encoding="utf-8")
    explain()
    assert score(slice_dir) == 1, "one round without progress: fix again"
    assert score(slice_dir) == 1, "unchanged verified nodes reuse their diagnosis"
    # Every difference traced, yet no progress: keep going up to STALE_HARD, never ask early.
    explain()
    assert score(slice_dir) == 1, "2 stale rounds, no NEEDS_CONTEXT: not a stop"
    explain("I1:2;3:4 Plan — NEEDS_CONTEXT: no Figma source for the badge colour\n")
    assert score(slice_dir) == 4
    assert "stop: 4 renders without progress, verifier: NEEDS_CONTEXT" in run(["--check", feature])[1]
    assert score(slice_dir) == 4, "a stopped loop never scores again"
    stopped = dr.json.loads((iters / "score.json").read_text(encoding="utf-8"))
    assert stopped["round"] == 5 and [h["round"] for h in stopped["history"]] == [1, 2, 3, 4, 5], stopped["history"]
    # The worker reported DONE on a stopped loop (bspace_chart 001): NEEDS_CONTEXT, not done.
    (slice_dir / "work/section-1-2-report.md").write_text("## Status\nDONE\n", encoding="utf-8")
    assert "render loop of 1:2 stopped" in run(["--check", feature])[1]
    (slice_dir / "work/section-1-2-report.md").unlink()
    # The developer says continue: history kept, counter reset; no cap while it improves.
    with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
        assert dr.main([str(slice_dir), "1:2", "--continue"]) == 1
    resumed = dr.json.loads((iters / "score.json").read_text(encoding="utf-8"))
    assert resumed["resumed"] and len(resumed["history"]) == 6 and resumed["stop"] is None, resumed
    verify.unlink()
    for n, width in enumerate((24, 18, 12, 6), 7):
        explain()
        image(slice_dir / "renders/render.png", box=(0, 0, width, 24), color=(220, 40, 40))
        assert score(slice_dir) == 1, n  # each round gains ≥ 0.5 points: never stops
    assert dr.json.loads((iters / "score.json").read_text(encoding="utf-8"))["round"] == 10
    # Without NEEDS_CONTEXT the loop stops only after STALE_HARD renders without progress.
    for n in range(dr.STALE_HARD):
        explain()
        assert score(slice_dir) == (4 if n == dr.STALE_HARD - 1 else 1), n
    shutil.rmtree(iters)
    verify.unlink()
    # A text box off Figma is geometry (line height / position), fix from Figma sources.
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace("[28, 4, 80, 16]", "[28, 4, 80, 32]"), encoding="utf-8")
    image(slice_dir / "renders/render.png")
    assert score(slice_dir) == 1
    err = run(["--check", feature])[1]
    assert "text I1:2;3:4 'Plan: 20.000'" in err and "fix from Figma sources" in err, err
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT, encoding="utf-8")
    # writeLayout that matched nothing (bspace_chart: double-escaped RegExp) is named as such.
    (slice_dir / "work/layout-1-2.json").write_text('{"nodes": {}, "texts": []}', encoding="utf-8")
    assert "writeLayout matched no Key" in run(["--check", feature])[1]
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT, encoding="utf-8")
    # A total pass with one large node far off fails: every node ≥ 400px² at ≥ 90%.
    badge = METADATA.replace('width="0" height="0" />', 'width="0" height="0" />\n  <rectangle id="1:8" name="Badge" x="0" y="0" width="20" height="20" />')
    metadata(slice_dir, badge)
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace('"nodes": {', '"nodes": {"1:8": [0, 0, 20, 20], '), encoding="utf-8")
    image(slice_dir / "renders/render.png", box=(0, 0, 9, 5), color=(220, 40, 40))  # 45px: 1.6% total, 11% of the badge
    result, _ = dr.score(slice_dir, "1:2")
    assert result["fidelity"] >= dr.PASS_AT and [n["id"] for n in result["weak"]] == ["1:8"] and not result["pass"], result
    assert "weak 1:8 " in run(["--check", feature])[1]
    metadata(slice_dir, METADATA)
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT, encoding="utf-8")
    # One-pixel anti-aliasing shift passes; a masked tooltip area is not counted.
    image(slice_dir / "renders/render.png", box=(29, 4, 80, 16))
    assert run(["--check", feature])[0] == 0
    image(slice_dir / "renders/render.png", box=(0, 0, 20, 24), color=(220, 40, 40))
    assert "render does not match" in run(["--check", feature])[1]
    with (slice_dir / "plan.md").open("a", encoding="utf-8") as f:
        f.write("- mask 1:2: tooltip hidden in Figma\n")
    meta = METADATA.replace('<frame id="I1:2;3:5" name="Group" x="0" y="0" width="0" height="0" />',
                            '<frame id="7:7" name="Tooltip" x="0" y="0" width="20" height="24" />')
    metadata(slice_dir, meta)
    (slice_dir / "plan.md").write_text((slice_dir / "plan.md").read_text(encoding="utf-8").replace("mask 1:2", "mask 7:7"), encoding="utf-8")
    assert run(["--check", feature])[0] == 0
    # bspace_chart 001 shipped at ~32%: the real pair fails.
    real = Path.home() / "Documents/buma/bspace_chart/specs/001-bps-mobile-20_10_2026"
    if (real / "renders/render.png").is_file():
        w, h, fpx = dr.read_png(real / "renders/figma.png")
        _, _, rpx = dr.read_png(real / "renders/render.png")
        bad = sum(a != b and dr.delta(a, b) > dr.MAX_DELTA for a, b in zip(fpx, rpx))
        assert bad / (w * h) > 0.2, bad

    # Evidence: a value with no Figma source, and a chart with no data row.
    feature, slice_dir = project(root, SVG_ROW)
    plan = slice_dir / "plan.md"
    text = plan.read_text(encoding="utf-8")
    plan.write_text(
        text.replace("| Property | Value | Source |\n| --- | --- | --- |",
                     "| Property | Value | Source |\n| --- | --- | --- |\n| bar values | 24, 2, 10 | looks right |"),
        encoding="utf-8",
    )
    assert "Evidence 'bar values' cites no Figma node id" in run(["--check", feature])[1]
    plan.write_text(
        text.replace("| Property | Value | Source |\n| --- | --- | --- |",
                     "| Property | Value | Source |\n| --- | --- | --- |\n| tap | tooltip | 10306:79270 prototype ON_CLICK |"),
        encoding="utf-8",
    )
    assert run(["--check", feature])[0] == 0

    # A widgets/<screen>_*.dart with no ## Sections row was never checked (the chart in its own slice).
    feature, slice_dir = project(root, SVG_ROW)
    (feature / "presentation/widgets/demo_chart.dart").write_text("// x\n", encoding="utf-8")
    assert "widgets/demo_chart.dart: not a ## Sections row of demo" in run(["--check", feature])[1]

    # --init for `demo_chart` next to `demo` asks first (exit 3); --new confirms a new screen.
    code, err = run(["--init", "demo_chart", "--epic", "hr-gs", root / "specs"])
    assert code == 3 and "ASK: demo_chart looks related to demo" in err, err
    assert vo.find_slice_dirs(root / "specs", "demo_chart") == []
    assert run(["--init", "demo_chart", "--epic", "hr-gs", "--new", root / "specs"])[0] == 0
    assert len(vo.find_slice_dirs(root / "specs", "demo_chart")) == 1
    assert run(["--init", "demo_chart", "--epic", "hr-gs", root / "specs"])[0] == 0, "re-run reuses, no ask"
    assert run(["--init", "demolition", "--epic", "hr-gs", root / "specs"])[0] == 0, "word prefix only"

    for name in ("render.png", "figma.png"):
        feature, slice_dir = project(root, SVG_ROW)
        (slice_dir / "renders" / name).unlink()
        assert f"{name} missing" in run(["--check", feature])[1], name

    feature, slice_dir = project(root, SVG_ROW)
    (feature / "presentation/demo.screen.dart").write_text("// no page\n", encoding="utf-8")
    assert "must build a Scaffold(" in run(["--check", feature])[1]
    feature, slice_dir = project(root, SVG_ROW)
    (root / "lib/core").mkdir(parents=True)
    (root / "lib/core/router.dart").write_text("builder: (_, __) => const DemoContent(),\n", encoding="utf-8")
    assert "route to the *Screen" in run(["--check", feature])[1]

    # 0.1.46 (bspace_chart / bspace_banner): each one alone fails --check.
    feature, slice_dir = project(root, SVG_ROW)
    test = root / "test/demo/demo_render_test.dart"
    for bad, want in (
        ("void writeLayout(WidgetTester tester) {}", "defines its own writeLayout"),
        ("await tester.binding.setSurfaceSize(const Size(361, 295));", "setSurfaceSize( sets the canvas"),
    ):
        test.write_text(RENDER_TEST + bad + "\n", encoding="utf-8")
        assert want in run(["--check", feature])[1], want
    test.write_text(RENDER_TEST.replace("import '../support/fidelity_harness.dart';", ""), encoding="utf-8")
    assert "must import 'test/support/fidelity_harness.dart'" in run(["--check", feature])[1]
    test.write_text(RENDER_TEST, encoding="utf-8")
    with (root / vo.HARNESS_PATH).open("a", encoding="utf-8") as f:
        f.write("// tweaked\n")
    assert "differs from the skill's copy" in run(["--check", feature])[1]
    shutil.copyfile(vo.HARNESS, root / vo.HARNESS_PATH)
    assert run(["--check", feature])[0] == 0
    plan = slice_dir / "plan.md"
    base = plan.read_text(encoding="utf-8")
    for line, want in (
        ("- chart: fl_chart stacked BarChart; tooltip tap", "names no node"),
        ("- run: BLOCKED pod install failed", "run: BLOCKED pod install failed"),
        (f"- reference 1:2: {Path(tmp)}/missing.dart", "does not exist"),
    ):
        plan.write_text(base + line + "\n", encoding="utf-8")
        assert want in run(["--check", feature])[1], want
    plan.write_text(base + "- chart package: fl_chart 1.0.0\n- run: PASS iPhone 16\n", encoding="utf-8")
    assert run(["--check", feature])[0] == 0, "chart package: and run: PASS are fine"
    # A cited hosted package at another version than pubspec.lock resolves.
    other = Path(tmp) / "pub-cache/hosted/pub.dev/fl_chart-0.68.0/example/lib/bar.dart"
    other.parent.mkdir(parents=True)
    other.write_text("// bar\n", encoding="utf-8")
    (root / "pubspec.lock").write_text('packages:\n  fl_chart:\n    dependency: "direct main"\n    version: "1.0.0"\n', encoding="utf-8")
    plan.write_text(base + f"- reference 1:2: {other}:3\n", encoding="utf-8")
    assert "is fl_chart 0.68.0, pubspec.lock resolves 1.0.0" in run(["--check", feature])[1]
    plan.write_text(base, encoding="utf-8")
    (root / "pubspec.lock").unlink()
    # Chart code with no `chart <id>:` line skipped every chart check.
    widget = feature / "presentation/widgets/demo_content.dart"
    widget.write_text(CLEAN_DART + "\nfinal c = UIChartFixedBar(items: items);\n", encoding="utf-8")
    assert "has no '- chart 1:2: …' Notes line" in run(["--check", feature])[1]
    widget.write_text(CLEAN_DART, encoding="utf-8")

    # figma_xml: a JSON-wrapped MCP response (bspace_banner) extracts the balanced subtree.
    wrapped = Path(tmp) / "root-metadata.txt"
    xml = '<frame id="9:1" name="Page" x="0" y="0" width="393" height="800"><frame id="9:2" name="A" x="0" y="0" width="10" height="10"><text id="9:3" name="a" x="0" y="0" width="5" height="5" /></frame><frame id="9:4" name="B" x="0" y="20" width="10" height="10" /></frame>'
    wrapped.write_text(dr.json.dumps([{"type": "text", "text": "Currently selected nodes: ..."}, {"type": "text", "text": xml}]), encoding="utf-8")
    sub = fx.extract(fx.response_text(wrapped), "9:2")
    assert sub == '<frame id="9:2" name="A" x="0" y="0" width="10" height="10"><text id="9:3" name="a" x="0" y="0" width="5" height="5" /></frame>', sub
    assert fx.extract(fx.response_text(wrapped), "9:4").endswith('height="10" />')
    # classify from shapes: 8 columns × 4 segments, equal heights → stacked 100%, tooltip box found.
    seg = '<rectangle id="S{i}{k}" name="Rectangle" x="0" y="{y}" width="12" height="25" />'
    cols = "".join(f'<frame id="C{i}" name="Frame" x="{i * 14}" y="0" width="12" height="100">'
                   + "".join(seg.format(i=i, k=k, y=k * 25) for k in range(4)) + "</frame>" for i in range(8))
    tip = '<frame id="T1" name="Frame" x="30" y="10" width="60" height="40"><text id="T2" name="13:00" x="0" y="0" width="30" height="10" /><text id="T3" name="R 24" x="0" y="12" width="30" height="10" /></frame>'
    shape = fx.classify(vo.ET.fromstring(f'<frame id="1:1" name="Chart" x="0" y="0" width="120" height="120"><frame id="P" name="Frame" x="0" y="0" width="112" height="100">{cols}</frame>{tip}</frame>'))
    assert (shape["type"], shape["points"], shape["series"], shape["stacking"], shape["bar_width"], shape["bar_gap"], shape["tooltips"]) == (
        "column", 8, 4, "stacked 100%", 12.0, 2.0, ["T1"]), shape
    # bspace_chart 001: the plot frame came back childless → re-fetch, else NEEDS_CONTEXT.
    pruned = fx.classify(vo.ET.fromstring('<frame id="1:1" name="Chart" x="0" y="0" width="361" height="295"><frame id="1:5" name="Frame" x="0" y="108" width="329" height="155" /></frame>'))
    assert "1:5 has no children" in pruned["insufficient"], pruned
    # raw: the response is copied from the host transcript, never retyped.
    logs = Path(tmp) / "logs"
    (logs / "s" / "subagents").mkdir(parents=True)
    big = Path(tmp) / "big.txt"
    big.write_text(dr.json.dumps([{"type": "text", "text": xml}]), encoding="utf-8")
    def use(i, tool, node):
        return {"message": {"content": [{"type": "tool_use", "id": i, "name": f"mcp__figma__{tool}", "input": {"nodeId": node}}]}}
    def res(i, content, err=False):
        return {"message": {"content": [{"type": "tool_result", "tool_use_id": i, "content": content, "is_error": err}]}}
    pixel = fx.base64.b64encode(png(2, 2)).decode()
    claude = [use("a", "get_metadata", "9:2"), res("a", [{"type": "text", "text": "old"}]),
              use("b", "get_metadata", "9:2"), res("b", f"Error: result (9 characters) exceeds maximum allowed tokens. Output has been saved to {big}.\nFormat: JSON"),
              use("c", "get_metadata", "9:4"), res("c", "boom", err=True),
              use("d", "get_screenshot", "9:2"), res("d", [{"type": "image", "source": {"type": "base64", "data": pixel}}]),
              use("e", "get_design_context", "9:2"), res("e", [{"type": "text", "text": '<div data-node-id="9:2">A</div>'}]),
              use("f", "get_design_context", "9:2"), res("f", [{"type": "text", "text": "Code Connect: map this component?"}])]
    (logs / "s" / "subagents" / "agent-1.jsonl").write_text("\n".join(dr.json.dumps(x) for x in claude), encoding="utf-8")
    codex = {"type": "event_msg", "payload": {"type": "item_completed", "item": {
        "type": "McpToolCall", "tool": "figma.get_variable_defs", "arguments": {"nodeId": "9-2"}, "status": "completed",
        "result": {"content": [{"type": "text", "text": '{"text/dark": "#333f47"}'}], "isError": False}}}}
    (logs / "rollout-1.jsonl").write_text(dr.json.dumps(codex) + "\n", encoding="utf-8")
    out = Path(tmp) / "raw"
    def raw(tool, node, name):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return fx.main(["raw", tool, node, str(out / name), "--root", str(logs)])
    assert raw("get_metadata", "9:2", "m.md") == 0 and (out / "m.md").read_text(encoding="utf-8") == xml
    assert raw("get_metadata", "9:2", "m.json") == 0 and dr.json.loads((out / "m.json").read_text(encoding="utf-8"))[0]["text"] == xml
    assert raw("get_screenshot", "9:2", "s.png") == 0 and (out / "s.png").read_bytes() == png(2, 2)
    assert raw("get_design_context", "9:2", "d.md") == 0 and "data-node-id" in (out / "d.md").read_text(encoding="utf-8")
    assert raw("get_variable_defs", "9:2", "v.md") == 0 and "#333f47" in (out / "v.md").read_text(encoding="utf-8")
    assert raw("get_metadata", "9:4", "x.md") == 1  # the only call errored
    assert raw("get_metadata", "8:8", "x.md") == 1
    # --check reads the slice against its spec: DS style, asset rows, painted stand-ins, raw files.
    feature, slice_dir = project(root, SVG_ROW)
    assert run(["--check", feature])[0] == 0
    # G4: an intent pin in spec.md (using-bspace-sdlc) — every AC mapped, hash fresh; no pin, no rule.
    intent = root / "intent/LV-1-leave/intent.md"
    intent.parent.mkdir(parents=True)
    intent.write_text("# LV-1 Leave\nStatus: draft\nWireframe: required\n- AC-01: a\n- AC-02: b", encoding="utf-8")
    one_liner = subprocess.run(["bash", "-c", "grep -vE '^(Wireframe|Status|Approved-by):' \"$0\" | shasum -a 256 | cut -c1-12",
                                str(intent)], capture_output=True, text=True).stdout.strip()
    assert vo.intent_hash(intent) == one_liner, (vo.intent_hash(intent), one_liner)
    spec_md = slice_dir / "spec.md"
    clean_spec = spec_md.read_text(encoding="utf-8")
    spec_md.write_text(clean_spec + f"\n**Intent:** intent/LV-1-leave/intent.md@{one_liner}\n", encoding="utf-8")
    assert "intent AC-02 not mapped" in run(["--check", feature])[1]
    spec_md.write_text(spec_md.read_text(encoding="utf-8") + "- AC-02: N/A: no UI\n", encoding="utf-8")
    assert run(["--check", feature])[0] == 0
    intent.write_text(intent.read_text(encoding="utf-8").replace("Status: draft", "Status: approved"), encoding="utf-8")
    assert run(["--check", feature])[0] == 0, "approving the intent must not stale the pin"
    intent.write_text(intent.read_text(encoding="utf-8") + "\n- AC-03: c\n", encoding="utf-8")
    err = run(["--check", feature])[1]
    assert "stale intent" in err and "intent AC-03 not mapped" in err, err
    spec_md.write_text(clean_spec, encoding="utf-8")
    widget = feature / "presentation/widgets/demo_content.dart"
    widget.write_text(CLEAN_DART.replace("UILabelStyle.bodySmall", "UILabelStyle.bodyXstraSmall"), encoding="utf-8")
    assert "UILabel('Plan: 20.000') uses UILabelStyle.bodyXstraSmall; spec says UILabelStyle.bodySmall" in run(["--check", feature])[1]
    widget.write_text(CLEAN_DART.replace(", style: UILabelStyle.bodySmall", ""), encoding="utf-8")
    assert "uses UILabelStyle.body; spec says UILabelStyle.bodySmall" in run(["--check", feature])[1]
    # bps_test banner: data-driven labels (UILabel(metric.plan, …)) still use a style of the section's spec.
    widget.write_text(CLEAN_DART + "\nfinal d = UILabel(metric.plan, style: UILabelStyle.bodyXstraSmall);\n", encoding="utf-8")
    assert "UILabel(metric.plan) uses UILabelStyle.bodyXstraSmall; the spec of this section has UILabelStyle.bodySmall" in run(["--check", feature])[1]
    widget.write_text(CLEAN_DART + "\nfinal d = UILabel(metric.plan, style: UILabelStyle.bodySmall);\n", encoding="utf-8")
    assert run(["--check", feature])[0] == 0
    # A design-context text with no metadata box: the nested instance was never expanded.
    meta_md = (slice_dir / "work/raw/get_metadata-1-2.md").read_text(encoding="utf-8")
    metadata(slice_dir, re.sub(r'<text id="I1:2;3:4"[^>]*/>', "", meta_md))
    assert "1 design-context text node(s) missing (first: I1:2;3:4) — get_metadata not expanded" in run(["--check", feature])[1]
    metadata(slice_dir, meta_md)
    widget.write_text(CLEAN_DART + "\nfinal m = CustomPaint(painter: _Mark());\n", encoding="utf-8")
    assert "paints shapes while the spec of 1:2 has assets" in run(["--check", feature])[1]
    # A render older than its widget scores the old code (diff_renders structure gate).
    widget.write_text(CLEAN_DART, encoding="utf-8")
    later = widget.stat().st_mtime + 100
    os.utime(widget, (later, later))
    assert any("renders/render.png is older than demo_content.dart" in e for e in vo.check(feature)[0])
    # Every spec asset is keyed: a dropped or painted icon is a geometry error, not 2% of pixels.
    os.utime(widget)
    (slice_dir / "work/layout-1-2.json").write_text(LAYOUT.replace(', "I1:2;10829:163943": [0, 0, 24, 24]', ""), encoding="utf-8")
    err = run(["--check", feature])[1]
    assert "layout has no Key('I1:2;10829:163943') for part 'hauler'" in err, err
    feature, slice_dir = project(root, "| 1:9 | other | ds | - |", CLEAN_DART.replace(
        "SvgPicture.asset('assets/images/demo/demo_hauler.svg', width: 24, height: 24),", ""))
    assert "no row for spec asset I1:2;10829:163943 (hauler.svg)" in run(["--check", feature])[1]
    feature, slice_dir = project(root, SVG_ROW)
    spec_md = slice_dir / "work/spec-1-2.md"
    spec_md.write_text(spec_md.read_text(encoding="utf-8").replace("bodySmall", "bodyBold"), encoding="utf-8")
    assert "differs from figma_xml.py spec" in run(["--check", feature])[1]
    spec_md.unlink()
    assert "work/spec-1-2.md missing" in run(["--check", feature])[1]
    dc_path = slice_dir / "work/raw/get_design_context-1-2.md"
    dc_path.write_text(DESIGN_CONTEXT.replace('data-node-id="I1:2;3:4"', ""), encoding="utf-8")
    assert "1 metadata text node(s) not in the design context (first: I1:2;3:4)" in run(["--check", feature])[1]
    dc_path.unlink()
    assert "get_design_context-1-2.md missing" in run(["--check", feature])[1]
    feature, slice_dir = project(root, SVG_ROW)
    (slice_dir / "work/raw/get_metadata-1-2.json").write_text(
        dr.json.dumps([{"type": "text", "text": METADATA.split("```xml\n")[1].split("```")[0].replace('width="80"', 'width="81"')}]),
        encoding="utf-8")
    assert "metadata edited by hand" in run(["--check", feature])[1]
    # spec: styles inherited from the wrapper, span runs joined, <img> owned by its metadata ancestor.
    meta = Path(tmp) / "spec-meta.md"
    meta.write_text('```xml\n<frame id="5:1" name="Card" x="0" y="0" width="200" height="60">'
                    '<text id="5:2" name="OB" x="0" y="0" width="30" height="20" />'
                    '<text id="5:3" name="Gap" x="0" y="20" width="60" height="16" />'
                    '<instance id="5:4" name="info" x="40" y="2" width="16" height="16" />'
                    '<text id="5:5" name="Odd" x="0" y="40" width="30" height="13" /></frame>\n```\n', encoding="utf-8")
    dc = Path(tmp) / "dc.md"
    icon = Path(tmp) / "icon.svg"
    icon.write_text('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16z"/></svg>', encoding="utf-8")
    dc.write_text(f'''const imgInfo = "{icon.as_uri()}";
<div data-node-id="5:1"><div className="font-[family-name:var(--(heading,h5),'Poppins:Bold')] text-[color:var(--text\\/text-dark,#333f47)] text-[length:var(--(heading,h5),16px)]" data-node-id="5:2"><p className="leading-[var(--(heading,h5),20px)]">OB</p></div>
<div className="font-['Poppins:Medium'] text-[11px] text-right" data-node-id="5:3"><p><span className="leading-[16px]">{{`Gap: `}}</span><span className="leading-[16px]">-5</span></p></div>
<div data-node-id="5:4" data-name="info"><div data-node-id="I5:4;1:9"><img alt="" src={{imgInfo}} /></div></div>
<div className="font-['Poppins:Medium'] text-[9px]" data-node-id="5:5"><p className="leading-[13px]">Odd</p></div>
<CodeConnectSnippet data-node-id="5:6" data-name="Component/Progress Bar">UIProgressbar( value: 0.5 )</CodeConnectSnippet></div>
SUPER CRITICAL: convert''', encoding="utf-8")
    doc = fx.spec(dc.read_text(encoding="utf-8"), "5:1", meta, Path(tmp))
    assert "| 5:2 | OB | 16/700/20 | text/text-dark #333f47 | left | 0,0,30,20 | UILabelStyle.headingH5 |" in doc, doc
    assert "| 5:3 | Gap: -5 | 11/500/16 | — | right | 0,20,60,16 | UILabelStyle.bodySmall |" in doc, doc
    assert f"| 5:4 | info | {icon.as_uri()} | 16×16 |" in doc, doc
    assert "| 5:5 | Odd 9/500/13 | no DS text style" in doc and "| 5:6 | Component/Progress Bar | `UIProgressbar( value: 0.5 )` |" in doc, doc
    # DS lookup reads the resolved DS source, not the static table.
    fonts = Path(tmp) / "fake_ds/lib/src/components/tokens/fonts"
    fonts.mkdir(parents=True)
    (fonts / "body.dart").write_text("final TextStyle defaultStyle = GoogleFonts.poppins(fontSize: 12.sp, fontWeight: FontWeight.w500, height: 16.sp);\n"
                                     "final TextStyle tiny = GoogleFonts.poppins(fontSize: 9.sp, fontWeight: FontWeight.w500, height: 13.sp);\n", encoding="utf-8")
    label = Path(tmp) / "fake_ds/lib/src/components/atoms/label/label.widget.dart"
    label.parent.mkdir(parents=True)
    label.write_text("UILabelStyle.bodyTiny => UIFont.body.tiny,\n", encoding="utf-8")
    styles, source = fx.ds_styles(Path(tmp) / "fake_ds")
    assert source.endswith("fake_ds") and fx.ds_match(styles, 9, 500, 13) == "UILabelStyle.bodyTiny", styles
    assert fx.ds_match(styles, 12, 500, 16) == "UIFont.body.defaultStyle ⚑" and fx.ds_match(styles, 16, 700, 20) is None
    # assets: one download per URL, content checked, plan rows printed.
    spec_md = Path(tmp) / "spec.md"
    spec_md.write_text(doc + "", encoding="utf-8")
    rows, errs = fx.download_assets(spec_md, Path(tmp) / "app/assets/images")
    assert not errs and rows == [f"| 5:4 | info | svg | {(Path(tmp) / 'app/assets/images/info.svg').as_posix()} |"], (rows, errs)
    icon.write_text("<html>expired</html>", encoding="utf-8")
    (Path(tmp) / "app/assets/images/info.svg").unlink()
    rows, errs = fx.download_assets(spec_md, Path(tmp) / "app/assets/images")
    assert not rows and "is not a .svg image" in errs[0] and not (Path(tmp) / "app/assets/images/info.svg").exists(), errs

# Shipped template matches the skeleton's shape.
template = (HERE.parent / "assets/screen-template/specs/__screen_name__/plan.md").read_text(
    encoding="utf-8"
)
for heading in ("## Sections", "## Assets", "## Evidence", "## Notes"):
    assert heading in template, heading
assert template.count("\n") < 80, "template plan.md must stay a short note"

print("check_plan_tables_selfcheck: all checks passed")
