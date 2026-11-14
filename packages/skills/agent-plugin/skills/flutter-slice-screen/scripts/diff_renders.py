#!/usr/bin/env python3
"""Score a Flutter render against its Figma render: geometry first, pixels second.

Run: python3 diff_renders.py <slice-dir> <node-id> [--continue]

Reads renders/section-<id>-figma.png + section-<id>.png (else figma.png + render.png), the
render test's work/layout-<id>.json and the node's work/raw/get_metadata-*.md. Overwrites
work/iter/<id>/{render.png,layout.json,diff.png,score.json} each round; score.json keeps `history`
(one row per round). Only score.json is tracked (work/iter/.gitignore). Fidelity = 100 − pixel diff %.
Exit 0 pass, 1 fix and re-render, 4 stop, 5 verify first: after a scored fail the next round needs a
fresh work/section-<id>-verify.md naming every failing node. Stop: two renders in a row without
progress and a verifier `NEEDS_CONTEXT` line, or STALE_HARD renders without progress → escalate
NEEDS_CONTEXT (flutter-verify-fidelity §1). After a stop it refuses to score until the developer says
continue (`--continue`: history kept, counter reset).
`--check` re-scores the current renders."""

from __future__ import annotations

import json
import re
import shutil
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

# Fidelity % = 100 − % of unmasked pixels that differ. Pass: the section at PASS_AT and every
# node of NODE_AREA px² or more at NODE_PASS_AT (a 2% total can hide one part drawn 11% wrong).
PASS_AT = 98.0
NODE_PASS_AT = 90.0
NODE_AREA = 400
PROGRESS = 0.5  # fidelity points a fix round must gain (or fewer geometry errors)
STALE_STOP = 2  # renders in a row without progress → stop, if the verifier names NEEDS_CONTEXT
STALE_HARD = 4  # ponytail: hard stop when the verifier traces everything yet nothing improves
NODE_ID = re.compile(r"I?\d+:\d+(?:;\d+:\d+)*")
# Rounds overwrite the images; only score.json (with its history) is worth a commit.
ITER_IGNORE = "*\n!.gitignore\n!*/\n!*/score.json\n"
MAX_DELTA = 35215 * 0.1**2  # pixelmatch YIQ threshold 0.1
BOX_TOL = 1.0  # px, keyed frames
TEXT_TOL = 2.0  # px, text boxes and their pixels (font rasterisation)
MASK_LINE = re.compile(r"^-?\s*mask\s+(I?\d+:\d+(?:;\d+:\d+)*):", re.M)
CHART_LINE = re.compile(r"^-?\s*chart\s+(I?\d+:\d+(?:;\d+:\d+)*):", re.M)


def file_id(node: str) -> str:
    return re.sub(r"[:;]", "-", node)


def unfilter(kind: int, line: bytearray, prev: bytearray, bpp: int) -> None:
    for x in range(len(line) if kind else 0):
        a = line[x - bpp] if x >= bpp else 0
        b = prev[x]
        if kind == 1:
            line[x] = (line[x] + a) & 255
        elif kind == 2:
            line[x] = (line[x] + b) & 255
        elif kind == 3:
            line[x] = (line[x] + (a + b) // 2) & 255
        else:
            c = prev[x - bpp] if x >= bpp else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255


def read_png(path: Path) -> tuple[int, int, list[tuple[int, int, int]]]:
    """8-bit non-interlaced PNG → (w, h, RGB pixels composited on white)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")
    pos, idat, palette, trns, head = 8, b"", b"", b"", None
    while pos < len(data):
        size, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + size]
        pos += 12 + size
        if kind == b"IHDR":
            head = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = body
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    w, h, depth, ctype, _, _, interlace = head
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if depth != 8 or interlace or channels is None:
        raise ValueError(f"{path.name}: only 8-bit non-interlaced PNGs (got depth {depth}, type {ctype})")
    raw, stride = zlib.decompress(idat), w * channels
    prev, px, i = bytearray(stride), [], 0
    for _ in range(h):
        line = bytearray(raw[i + 1 : i + 1 + stride])
        unfilter(raw[i], line, prev, channels)
        i += 1 + stride
        prev = line
        for x in range(0, stride, channels):
            p = line[x : x + channels]
            if ctype == 3:
                k = p[0]
                r, g, b, a = *palette[3 * k : 3 * k + 3], trns[k] if k < len(trns) else 255
            elif ctype in (0, 4):
                r = g = b = p[0]
                a = p[1] if ctype == 4 else 255
            else:
                r, g, b = p[:3]
                a = p[3] if ctype == 6 else 255
            px.append(tuple(255 - (255 - v) * a // 255 for v in (r, g, b)))
    return w, h, px


def write_png(path: Path, w: int, h: int, px: list[tuple[int, int, int]]) -> None:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    rows = b"".join(b"\x00" + bytes(v for p in px[y * w : (y + 1) * w] for v in p) for y in range(h))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def metadata_node(spec_dir: Path, node: str) -> ET.Element | None:
    for raw in sorted((spec_dir / "work" / "raw").glob("get_metadata-*.md")):
        for fence in re.findall(r"```xml\s*\n(.*?)```", raw.read_text(encoding="utf-8"), re.S):
            try:
                root = ET.fromstring(fence)
            except ET.ParseError:
                continue
            for el in root.iter():
                if el.get("id") == node:
                    return el
    return None


def boxes(node: ET.Element) -> list[tuple[str, str, str, float, float, float, float]]:
    """(id, tag, name, x, y, w, h) of every visible node, relative to `node`'s top-left."""
    out = []

    def walk(el: ET.Element, ox: float, oy: float) -> None:
        if el.get("hidden") == "true":
            return
        x, y = ox + float(el.get("x", 0)), oy + float(el.get("y", 0))
        if el.get("width") is not None:
            size = (float(el.get("width")), float(el.get("height", 0)))
            out.append((el.get("id", ""), el.tag, el.get("name", ""), x, y, *size))
        for child in el:
            walk(child, x, y)

    walk(node, -float(node.get("x", 0)), -float(node.get("y", 0)))
    return out


def spec_assets(spec_dir: Path, node: str, meta: ET.Element) -> list[ET.Element]:
    """Sized asset nodes of work/spec-<id>.md (figma_xml.py spec): each is keyed, so a missing or
    painted stand-in icon shows up as geometry, not as a few percent of pixels."""
    spec = spec_dir / "work" / f"spec-{file_id(node)}.md"
    part = re.search(r"^## Assets\n(.*?)(?=^## |\Z)", spec.read_text(encoding="utf-8"), re.S | re.M) if spec.is_file() else None
    ids = {line.split("|")[1].strip() for line in (part.group(1) if part else "").splitlines()[2:] if line.startswith("|")}
    return [el for el in meta.iter() if el.get("id") in ids and el is not meta
            and float(el.get("width", 0)) > 0 and float(el.get("height", 0)) > 0]


def section_widget(spec_dir: Path, node: str) -> Path | None:
    """presentation/<Sections File> of the node, found under the package's lib/."""
    plan = spec_dir / "plan.md"
    table = re.search(r"^##\s+Sections\s*$(.*?)(?=^##\s|\Z)", plan.read_text(encoding="utf-8"), re.M | re.S) if plan.is_file() else None
    for line in table.group(1).splitlines() if table else []:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) > 2 and cells[0] == node and cells[2].endswith(".dart"):
            return next((spec_dir.parent.parent / "lib").rglob(f"presentation/{cells[2]}"), None)
    return None


def fmt(rect) -> str:
    return ",".join(f"{v:g}" for v in (round(float(v), 1) for v in rect))


def parts(node: ET.Element) -> list[ET.Element]:
    """The section's parts: visible sized non-text children of the first node (through single-child
    wrappers) with 2+ of them — header, legend, plot. Each needs its own Key so a diff names it."""
    def kids(el: ET.Element) -> list[ET.Element]:
        return [c for c in el if c.get("hidden") != "true" and float(c.get("width", 0)) > 0 and float(c.get("height", 0)) > 0]

    el = node
    while len(kids(el)) == 1:
        el = kids(el)[0]
    return [c for c in kids(el) if c.tag != "text"]


def geometry(rects: list, layout: dict, required: list[ET.Element] = (), free: set = frozenset()) -> list[str]:
    """Keyed frames ±1px; text: same top and height (size, line height, line count), no wider
    than the Figma box (laid-out `textSize`, so alignment inside the box is the pixels' job)."""
    errors = []
    by_id = {r[0]: r for r in rects}
    nodes = layout.get("nodes", {})
    if not nodes:
        errors.append(
            "layout has no keyed node at all — writeLayout matched no Key; call writeLayout from "
            "test/support/fidelity_harness.dart unchanged (a copied one with a double-escaped RegExp matches nothing)"
        )
    elif rects[0][0] not in nodes:
        errors.append(f"layout has no Key('{rects[0][0]}') — the section root carries its node id key")
    for el in required:
        if el.get("id") not in nodes:
            errors.append(f"layout has no Key('{el.get('id')}') for part '{el.get('name')}' — key every part of the section")
    for nid, got in nodes.items():
        want = by_id.get(nid)
        if want is None:
            errors.append(f"Key('{nid}') is no visible node of this section's get_metadata")
        elif any(abs(g - v) > BOX_TOL for g, v in zip(got, want[3:])):
            errors.append(f"{nid} {want[2]}: Flutter x,y,w,h {fmt(got)} vs Figma {fmt(want[3:])}")
    texts = layout.get("texts", [])
    for nid, tag, name, x, y, w, h in rects:
        found = [t for t in texts if tag == "text" and t.get("text") == name]
        if not found:
            # Masked and chart texts come from data or a later state; every other Figma TEXT is laid out.
            if tag == "text" and name and nid not in free:
                errors.append(f"text {nid} '{name}': not laid out — the Dart drops or rewords it")
            continue
        gx, gy, gw, gh = min(found, key=lambda t: abs(t["rect"][0] - x) + abs(t["rect"][1] - y))["rect"]
        if abs(gy - y) > TEXT_TOL or abs(gh - h) > TEXT_TOL or gw > w + TEXT_TOL:
            errors.append(f"text {nid} '{name}': Flutter x,y,w,h {fmt((gx, gy, gw, gh))} vs Figma {fmt((x, y, w, h))}")
    return errors


def delta(p: tuple, q: tuple) -> float:
    r, g, b = p[0] - q[0], p[1] - q[1], p[2] - q[2]
    y = r * 0.29889531 + g * 0.58662247 + b * 0.11448223
    i = r * 0.59597799 - g * 0.27417610 - b * 0.32180189
    j = r * 0.21147017 - g * 0.52261711 + b * 0.31114694
    return 0.5053 * y * y + 0.299 * i * i + 0.1957 * j * j


def near(img: list, w: int, h: int, x: int, y: int, color: tuple, r: int) -> bool:
    return any(
        delta(img[yy * w + xx], color) <= MAX_DELTA
        for yy in range(max(0, y - r), min(h, y + r + 1))
        for xx in range(max(0, x - r), min(w, x + r + 1))
    )


def paint(w: int, h: int, rects: list, keep: callable) -> bytearray:
    out = bytearray(w * h)
    for r in rects:
        if keep(r):
            for y in range(max(0, int(r[4])), min(h, int(r[4] + r[6] + 0.999))):
                for x in range(max(0, int(r[3])), min(w, int(r[3] + r[5] + 0.999))):
                    out[y * w + x] = 1
    return out


def pair(spec_dir: Path, node: str) -> tuple[Path, Path]:
    """2+ `## Sections` rows: section-<id>-figma.png + section-<id>.png; one: figma.png + render.png."""
    renders = spec_dir / "renders"
    plan = spec_dir / "plan.md"
    table = re.search(r"^##\s+Sections\s*$(.*?)(?=^##\s|\Z)", plan.read_text(encoding="utf-8"), re.M | re.S) if plan.is_file() else None
    rows = [l for l in table.group(1).splitlines() if re.match(r"\s*\|.*\w", l)] if table else []
    if len(rows) > 2:  # header + 2 sections
        return renders / f"section-{file_id(node)}-figma.png", renders / f"section-{file_id(node)}.png"
    return renders / "figma.png", renders / "render.png"


def score(spec_dir: Path, node: str) -> tuple[dict, tuple | None]:
    """Score dict + diff image (w, h, px) for the node's current render pair. No writes."""
    figma, render = pair(spec_dir, node)
    layout_path = spec_dir / "work" / f"layout-{file_id(node)}.json"
    result = {"node": node, "figma": figma.name, "render": render.name, "geometry": [], "pixels": None,
              "fidelity": None, "pass_at": {"section": PASS_AT, "node": NODE_PASS_AT, "node_area": NODE_AREA},
              "nodes": [], "weak": [], "masks": [], "pass": False}
    meta = metadata_node(spec_dir, node)
    missing = [
        why for ok, why in (
            (meta is not None, f"no node {node} in work/raw/get_metadata-*.md"),
            (figma.is_file(), f"renders/{figma.name} missing"),
            (render.is_file(), f"renders/{render.name} missing"),
            (layout_path.is_file(), f"work/{layout_path.name} missing — the render test writes it (flutter-verify-fidelity §5 writeLayout)"),
        ) if not ok
    ]
    if missing:
        result["geometry"] = missing
        return result, None
    rects = boxes(meta)
    plan = spec_dir / "plan.md"
    masks = set(MASK_LINE.findall(plan.read_text(encoding="utf-8"))) if plan.is_file() else set()
    text = plan.read_text(encoding="utf-8") if plan.is_file() else ""
    free = {t.get("id") for el in meta.iter() if el.get("id") in masks | set(CHART_LINE.findall(text)) for t in el.iter("text")}
    keyed = [el for el in parts(meta) if el.get("id") not in masks]  # a masked tooltip is hidden: no key
    keyed += [el for el in spec_assets(spec_dir, node, meta) if el not in keyed]
    result["geometry"] = geometry(rects, json.loads(layout_path.read_text(encoding="utf-8")), keyed, free)
    try:
        fw, fh, fpx = read_png(figma)
        rw, rh, rpx = read_png(render)
    except (ValueError, zlib.error, struct.error, TypeError) as exc:
        result["geometry"].append(f"unreadable render pair: {exc}")
        return result, None
    widget = section_widget(spec_dir, node)
    if widget and render.stat().st_mtime < widget.stat().st_mtime:
        result["geometry"].append(f"renders/{render.name} is older than {widget.name} — re-run the render test, then score")
    if (fw, fh) != (rw, rh):
        result["geometry"].append(f"render {rw}x{rh} vs Figma {fw}x{fh} — pump at the Figma size, export at scale 1")
        return result, None

    result["masks"] = sorted(m for m in masks if any(r[0] == m for r in rects))
    masked = paint(fw, fh, rects, lambda r: r[0] in masks)
    loose = paint(fw, fh, rects, lambda r: r[1] == "text")
    diff = []
    for k in range(fw * fh):
        if masked[k] or fpx[k] == rpx[k] or delta(fpx[k], rpx[k]) <= MAX_DELTA:
            continue
        x, y, r = k % fw, k // fw, 2 if loose[k] else 1
        # Anti-aliasing / sub-pixel shift: each colour is found within r px in the other image.
        if near(rpx, fw, fh, x, y, fpx[k], r) and near(fpx, fw, fh, x, y, rpx[k], r):
            continue
        diff.append(k)
    counted = fw * fh - sum(masked)
    percent = round(100 * len(diff) / counted, 2) if counted else 0.0
    result["pixels"] = {"diff": len(diff), "counted": counted, "percent": percent}
    result["fidelity"] = round(100 - percent, 2)

    # Each differing pixel goes to the smallest Figma node holding it: where to look, by id.
    by_area = sorted(rects, key=lambda r: r[5] * r[6])
    owners: dict[str, int] = {}
    for k in diff:
        x, y = k % fw + 0.5, k // fw + 0.5
        owner = next((r for r in by_area if r[3] <= x < r[3] + r[5] and r[4] <= y < r[4] + r[6]), rects[0])
        owners[owner[0]] = owners.get(owner[0], 0) + 1
    by_id = {r[0]: r for r in rects}
    ranked = [
        {"id": nid, "name": by_id[nid][2], "diff": n, "area": round(by_id[nid][5] * by_id[nid][6]),
         "fidelity": round(100 - 100 * n / max(1.0, by_id[nid][5] * by_id[nid][6]), 1)}
        for nid, n in sorted(owners.items(), key=lambda kv: -kv[1])
    ]
    result["nodes"] = ranked[:8]
    result["weak"] = [n for n in ranked if n["area"] >= NODE_AREA and n["fidelity"] < NODE_PASS_AT]
    result["pass"] = not result["geometry"] and result["fidelity"] >= PASS_AT and not result["weak"]

    red = set(diff)
    img = [
        (255, 0, 0) if k in red else (200, 210, 255) if masked[k]
        else (lambda v: (v, v, v))(255 - (255 - sum(fpx[k]) // 3) * 3 // 10)
        for k in range(fw * fh)
    ]
    return result, (fw, fh, img)


def summary(result: dict) -> str:
    parts = []
    if result["fidelity"] is not None:
        parts.append(f"fidelity {result['fidelity']}% (pass ≥ {PASS_AT:g}%, every node ≥ {NODE_AREA}px² ≥ {NODE_PASS_AT:g}%)")
    if result["weak"]:
        parts.append("weak " + ", ".join(f"{n['id']} {n['fidelity']}%" for n in result["weak"][:2]))
    elif result["nodes"]:
        parts.append("worst " + ", ".join(f"{n['id']} {n['fidelity']}%" for n in result["nodes"][:2]))
    parts += result["geometry"][:2]
    if len(result["geometry"]) > 2:
        parts.append(f"+{len(result['geometry']) - 2} geometry errors; see score.json")
    return "; ".join(parts)


def iter_dir(spec_dir: Path, node: str) -> Path:
    return spec_dir / "work" / "iter" / file_id(node)

def last(spec_dir: Path, node: str) -> dict | None:
    path = iter_dir(spec_dir, node) / "score.json"
    if not path.is_file():  # ≤ 0.1.48 slices: work/iter/<id>/<N>/score.json, latest N
        old = sorted(iter_dir(spec_dir, node).glob("[0-9]*/score.json"), key=lambda q: int(q.parent.name))
        path = old[-1] if old else path
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

def failure_ids(result: dict) -> list[str]:
    ids = [m.group(0) for e in result["geometry"] if (m := NODE_ID.search(e))]
    ids += [n["id"] for n in result["weak"]]
    return list(dict.fromkeys(ids))

def verify_path(spec_dir: Path, node: str) -> Path:
    return spec_dir / "work" / f"section-{file_id(node)}-verify.md"

def unexplained(spec_dir: Path, node: str, prev: dict, current: dict) -> list[str] | None:
    """Require verification only for a new failure signature; reuse verified node diagnoses while
    the same nodes remain. A round without pixels (missing file, stale render) needs no verifier."""
    if current["pass"] or current.get("fidelity") is None:
        return []
    ids = failure_ids(current)
    verified = set(prev.get("verified_ids", []))
    new_ids = [i for i in ids if i not in verified]
    if not new_ids:
        return []
    verify = verify_path(spec_dir, node)
    score_json = iter_dir(spec_dir, node) / "score.json"
    if not verify.is_file() or not score_json.is_file() or verify.stat().st_mtime < score_json.stat().st_mtime:
        return None
    text = verify.read_text(encoding="utf-8")
    return [i for i in new_ids if i not in text]

def stale(result: dict, prev: dict | None, resumed: bool = False) -> int:
    """Renders in a row without progress: fidelity up PROGRESS points or fewer geometry errors.
    A first round, a round after a pass and a `--continue` round count from 0."""
    if result["pass"] or prev is None or prev["pass"]:
        return 0
    now, before = (r.get("fidelity") or 0.0 for r in (result, prev))
    if now - before >= PROGRESS or len(result["geometry"]) < len(prev["geometry"]):
        return 0
    return 1 if resumed else prev.get("stale", 0) + 1

def stop_reason(result: dict, prev: dict | None, count: int, needs_context: bool) -> str | None:
    """Asking the developer is earned: the verifier found a difference with no Figma source."""
    if result["pass"] or count < STALE_STOP or (count < STALE_HARD and not needs_context):
        return None
    before = prev.get("fidelity") if prev else None
    why = "verifier: NEEDS_CONTEXT" if needs_context else "every difference traced, none fixed"
    return (f"{count} renders without progress, {why} (fidelity {before}% → {result['fidelity']}%, "
            f"geometry errors {len(prev['geometry']) if prev else 0} → {len(result['geometry'])})")

def gate(spec_dir: Path, node: str) -> list[str]:
    """--check: the loop ran and the current renders pass."""
    prev = last(spec_dir, node)
    if prev is None:
        return [f"{node}: render pair never scored — python3 diff_renders.py <slice-dir> {node} (flutter-verify-fidelity §1)"]
    result, _ = score(spec_dir, node)
    if result["pass"]:
        return []
    then = (
        f"stop: {prev['stop']} — escalate NEEDS_CONTEXT with this diff; the developer adds context and resumes with --continue"
        if prev.get("stop")
        else "verify, fix from Figma sources, re-render, re-run diff_renders.py — the loop is open"
    )
    return [f"{node}: render does not match Figma — {summary(result)} (work/iter/{file_id(node)}/diff.png); {then}"]

def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    resumed = "--continue" in args
    args = [a for a in args if a != "--continue"]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    spec_dir, node = Path(args[0]).resolve(), args[1]
    base = iter_dir(spec_dir, node)
    prev = last(spec_dir, node)
    if prev and prev.get("stop") and not resumed:
        # Only the developer resumes, with the missing context: `--continue`. Never delete iter/.
        print(f"STOP {node}: round {prev['round']} stopped ({prev['stop']}) — escalate NEEDS_CONTEXT; the developer "
              f"resumes with --continue (never delete {base.relative_to(spec_dir).as_posix()}/)", file=sys.stderr)
        return 4
    result, image = score(spec_dir, node)
    missing = unexplained(spec_dir, node, prev, result) if prev and not resumed else []
    if missing != []:
        what = "no work/" + verify_path(spec_dir, node).name + " for new failing nodes" if missing is None \
            else "it does not explain " + ", ".join(missing[:5])
        print(f"VERIFY {node}: {what} — run the verifier only for the new diff nodes, fix them, "
              f"then score", file=sys.stderr)
        return 5
    n = (prev or {}).get("round", 0) + 1
    newly_verified = failure_ids(result) if prev and result["fidelity"] is not None and not result["pass"] else []
    base.mkdir(parents=True, exist_ok=True)
    ignore = base.parent / ".gitignore"
    if not ignore.is_file():
        ignore.write_text(ITER_IGNORE, encoding="utf-8")
    render = pair(spec_dir, node)[1]
    layout = spec_dir / "work" / f"layout-{file_id(node)}.json"
    for src, name in ((render, "render.png"), (layout, "layout.json")):
        if src.is_file():
            shutil.copyfile(src, base / name)
    (base / "diff.png").unlink(missing_ok=True)
    if image:
        write_png(base / "diff.png", *image)
    verify = verify_path(spec_dir, node)
    needs_context = verify.is_file() and "NEEDS_CONTEXT" in verify.read_text(encoding="utf-8")
    result["round"] = n
    result["resumed"] = resumed
    result["verified_ids"] = list(dict.fromkeys((prev or {}).get("verified_ids", []) + newly_verified))
    result["next"] = "pass" if result["pass"] else "fix verifier targets"
    result["stale"] = stale(result, prev, resumed)
    result["stop"] = stop_reason(result, prev, result["stale"], needs_context)
    worst = (result["geometry"] or [f"{w['id']} {w['name']} {w['fidelity']}%" for w in result["weak"]] or [None])[0]
    result["history"] = (prev or {}).get("history", []) + [
        {"round": n, "fidelity": result["fidelity"], "geometry": len(result["geometry"]), "worst": worst}]
    (base / "score.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    where = base.relative_to(spec_dir).as_posix()
    if result["pass"]:
        print(f"PASS {node} round {n}: {summary(result)} → {where}")
        return 0
    if result["stop"]:
        print(f"STOP {node} round {n}: {result['stop']} — escalate NEEDS_CONTEXT: {summary(result)} → {where}", file=sys.stderr)
        return 4
    print(f"FAIL {node} round {n}: {summary(result)} → {where}/diff.png; the loop is open — run the verifier, "
          f"fix its lines from Figma sources, re-render, re-run (never end the turn here)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
