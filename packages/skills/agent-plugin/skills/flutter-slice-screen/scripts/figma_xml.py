#!/usr/bin/env python3
"""Figma get_metadata, read by script instead of by eye.

  figma_xml.py extract <saved-response> <node-id> [<out.md>]
      The node's subtree, verbatim (balanced tags), from a saved get_metadata response — plain XML,
      a .md with ```xml fences, or the MCP's JSON-wrapped [{"type": "text", "text": ...}] file.
      Writes work/raw/get_metadata-<id>.md (`# get_metadata <id>` + ```xml fence) or prints it.
  figma_xml.py classify <get_metadata.md> <node-id>
      Chart type from shapes, never from layer names (charts.md Read Figma): column / bar,
      stacked, stacked 100%, grouped, line overlay, pie/donut, gauge, scatter; series, points,
      bar width and gap, tooltip candidates. Exit 3 = too few sized shapes: re-fetch get_metadata
      on the chart node itself; still pruned → NEEDS_CONTEXT.
  figma_xml.py raw <tool> <node-id> <out> [--root <dir>]
      The latest successful <tool> call (get_metadata, get_design_context, get_variable_defs,
      get_screenshot) on <node-id>, copied verbatim from the host transcript: Claude Code
      (~/.claude/projects/<cwd>/**.jsonl, oversized results via their saved file) or Codex
      (~/.codex/sessions, last 7 days). <out> .json = the MCP item list, .png = the screenshot,
      else the joined text. A design context without data-node-id (Code Connect prompt) is
      skipped. Exit 1 = not found (write <out> from the tool result, verbatim) · 3 = empty.
  figma_xml.py spec <design-context> <node-id> --metadata <md> [--ds <app-root>] [<out.md>]
      Texts (string, size/weight/line, colour, align, box, DS style), assets (URL per owner
      node), Code Connect snippets and ## Unmatched, as markdown tables (work/spec-<id>.md).
      DS styles are read from the resolved buma_design_system source of <app-root> (default
      cwd), else a static table. No exact DS match → ## Unmatched, never a nearest style.
  figma_xml.py assets <spec.md> <dest-dir>
      Downloads every ## Assets URL of the spec once (same URL → one file, named after its first
      layer), checks the content (svg drawing / PNG signature) and prints the plan.md ## Assets
      rows. Exit 1 = a download failed or is not an image (URLs expire: re-run
      get_design_context, re-spec, retry once)."""

from __future__ import annotations

import base64
import html
import json
import re
import sys
import time
import urllib.request
from urllib.parse import unquote, urlparse
import xml.etree.ElementTree as ET
from pathlib import Path

MARKS = {"instance", "rectangle", "rounded-rectangle", "vector", "ellipse", "line", "boolean-operation"}
TAG = re.compile(r"<(/?)([a-z][\w-]*)\b[^>]*?(/?)>")


def response_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    items = data if isinstance(data, list) else data.get("content", [data]) if isinstance(data, dict) else []
    return "\n".join(i.get("text", "") for i in items if isinstance(i, dict))


def extract(text: str, node: str) -> str | None:
    """Verbatim subtree of `node`: from its start tag to the matching close tag."""
    start = re.search(rf'<([a-z][\w-]*)\b[^>]*\bid="{re.escape(node)}"', text)
    if not start:
        return None
    depth = 0
    for m in TAG.finditer(text, start.start()):
        closing, self_closing = m.group(1), m.group(3)
        if self_closing:
            if depth == 0:
                return text[start.start() : m.end()]
            continue
        depth += -1 if closing else 1
        if depth == 0:
            return text[start.start() : m.end()]
    return None


def load(path: Path, node: str) -> ET.Element | None:
    for fence in re.findall(r"```xml\s*\n(.*?)```", path.read_text(encoding="utf-8"), re.S) or [response_text(path)]:
        sub = extract(fence, node)
        if sub:
            return ET.fromstring(sub)
    return None


def num(el: ET.Element, key: str) -> float | None:
    v = el.get(key)
    return float(v) if v is not None else None


def absolute(root: ET.Element) -> list[tuple[ET.Element, float, float, float, float]]:
    """(el, x, y, w, h) relative to `root`, visible sized nodes only."""
    out = []

    def walk(el, ox, oy):
        if el.get("hidden") == "true":
            return
        x, y = ox + (num(el, "x") or 0), oy + (num(el, "y") or 0)
        w, h = num(el, "width"), num(el, "height")
        if w is not None and h is not None:
            out.append((el, x, y, w, h))
        for c in el:
            walk(c, x, y)

    walk(root, -(num(root, "x") or 0), -(num(root, "y") or 0))
    return out


def columns(root: ET.Element) -> list[list[tuple]]:
    """Largest set of 3+ equal-width siblings holding marks: one entry per point, its mark rects."""
    boxes = {id(b[0]): b for b in absolute(root)}
    best: list[list[tuple]] = []
    for parent in root.iter():
        kids = [boxes[id(c)] for c in parent if id(c) in boxes and boxes[id(c)][3] > 0]
        by_w: dict[int, list] = {}
        for k in kids:
            by_w.setdefault(round(k[3] * 2), []).append(k)
        for group in by_w.values():
            cols = []
            for k in sorted(group, key=lambda b: b[1]):
                marks = [boxes[id(e)] for e in k[0].iter() if e.tag in MARKS and id(e) in boxes and boxes[id(e)][4] > 0]
                if marks:
                    cols.append(marks)
            if len(cols) >= 3 and len({round(c[0][1]) for c in cols}) == len(cols) and len(cols) > len(best):
                best = cols
    return best


def classify(root: ET.Element) -> dict:
    boxes = absolute(root)
    W, H = boxes[0][3], boxes[0][4]
    sized = [b for b in boxes[1:] if b[0].tag in MARKS and b[3] > 0 and b[4] > 0]
    out: dict = {"node": root.get("id"), "size": [W, H], "type": None, "notes": []}
    # A childless frame covering a fifth of the chart is a subtree get_metadata did not expand.
    empty = [b[0].get("id") for b in boxes[1:] if b[0].tag in ("frame", "group") and not len(b[0])
             and b[3] * b[4] >= W * H * 0.2]
    if len(sized) < 2:
        empty = empty or [root.get("id")]
    out["ds_instances"] = [f"{b[0].get('id')} {b[0].get('name')}" for b in boxes[1:]
                           if b[0].tag == "instance" and b[3] >= W * 0.6 and b[4] >= H * 0.4]
    cols = columns(root)
    long_vectors = [b for b in sized if b[0].tag in ("vector", "line") and b[3] >= W * 0.5 and b[4] > 2]
    if cols:
        series = max(len(c) for c in cols)
        lefts = [min(m[1] for m in c) for c in cols]
        widths = [max(m[1] + m[3] for m in c) - min(m[1] for m in c) for c in cols]
        tops = [min(m[2] for m in c) for c in cols]
        bottoms = [max(m[2] + m[4] for m in c) for c in cols]
        heights = [b - t for t, b in zip(tops, bottoms)]
        side = any(len({round(m[1]) for m in c}) > 1 for c in cols)
        horizontal = len({round(l) for l in lefts}) == 1 and len({round(w) for w in widths}) > 1
        out["type"] = "bar" if horizontal else "column"
        out["points"] = len(cols)
        out["series"] = series
        out["bar_width"] = round(min(m[3] for m in cols[0]), 2)
        steps = [b - a for a, b in zip(lefts, lefts[1:])]
        out["bar_gap"] = round(sum(steps) / len(steps) - widths[0], 2) if steps else 0
        aligned = len({round(b) for b in bottoms}) == 1
        if series > 1:
            out["stacking"] = "grouped" if side else "stacked 100%" if max(heights) - min(heights) <= 1 else "stacked"
        if out.get("stacking") == "stacked 100%":
            out["notes"].append("stacked 100%: geometry gives shares only — absolute values (tooltip, labels) need "
                                "per-point evidence, else NEEDS_CONTEXT")
        if not aligned and not horizontal:
            out["notes"].append("column bottoms differ — range/waterfall (fromY) or a misread column set")
        if long_vectors:
            out["overlay"] = [b[0].get("id") for b in long_vectors]
    elif long_vectors:
        out["type"] = "line"
        out["series"] = len(long_vectors)
        out["notes"].append("filled below the line → area: read the fill in get_design_context")
    else:
        ellipses = [b for b in sized if b[0].tag == "ellipse"]
        rings = {}
        for b in ellipses:
            rings.setdefault((round(b[1] + b[3] / 2), round(b[2] + b[4] / 2)), []).append(b)
        concentric = max(rings.values(), key=len, default=[])
        dots = [b for b in ellipses if abs(b[3] - b[4]) <= 1 and b[3] <= 16]
        if len(concentric) >= 2:
            out["type"] = "pie/donut"
            out["series"] = len(concentric)
            out["notes"].append("hole (donut) and arc angles: get_design_context; a grey track + one rounded arc → donut progress")
        elif len(dots) >= 5:
            out["type"] = "scatter"
            out["points"] = len(dots)
        elif len(ellipses) == 1 or any(b[0].tag == "vector" and abs(b[3] - b[4]) <= b[3] * 0.6 for b in sized):
            out["type"] = "gauge/progress arc"
        else:
            out["type"] = "unknown"
            out["notes"].append("no column set, long vector or arc — read the screenshot, ask once")
    if out["type"] == "unknown" and empty:
        out["insufficient"] = (
            f"{', '.join(empty)} has no children — get_metadata did not expand the plot; re-fetch get_metadata "
            f"on that node, still empty → NEEDS_CONTEXT naming it"
        )
    # Floating box: 2+ texts, one with a digit, smaller than the plot, holding no column mark.
    in_cols = {id(m[0]) for c in cols for m in c}
    out["tooltips"] = [
        b[0].get("id") for b in boxes[1:]
        if b[0].tag in ("frame", "instance", "group")
        and len(list(b[0].iter("text"))) >= 2
        and any(re.search(r"\d", t.get("name", "")) for t in b[0].iter("text"))
        and b[3] < W * 0.6 and b[4] < H * 0.6
        and not any(id(e) in in_cols for e in b[0].iter())
    ]
    return out


REDIRECT = re.compile(r"exceeds maximum allowed tokens\. Output has been saved to (\S+?\.(?:txt|json|md))(?=\.?\s|$)")


def transcripts(root: str | None) -> list[Path]:
    """Transcript files, newest first."""
    if root:
        files = list(Path(root).rglob("*.jsonl"))
    else:
        projects = Path.home() / ".claude" / "projects"
        here = next((d for d in (projects / re.sub(r"[^A-Za-z0-9]", "-", str(c)) for c in [Path.cwd(), *Path.cwd().parents])
                     if d.is_dir()), None)
        files = list(here.rglob("*.jsonl")) if here else []
        cutoff = time.time() - 7 * 86400
        files += [f for f in (Path.home() / ".codex" / "sessions").rglob("rollout-*.jsonl") if f.stat().st_mtime > cutoff]
    return sorted(files, key=lambda f: f.stat().st_mtime, reverse=True)


def calls(path: Path):
    """(tool name, nodeId, result content) of each successful tool call, in file order."""
    uses: dict[str, tuple] = {}
    for line in path.open(encoding="utf-8", errors="replace"):
        if "nodeId" not in line and "tool_result" not in line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = (d.get("payload") or {}).get("item") or {} if isinstance(d.get("payload"), dict) else {}
        if item.get("type") == "McpToolCall":  # Codex
            result = item.get("result") or {}
            if item.get("status") == "completed" and not result.get("isError"):
                yield item.get("tool", ""), (item.get("arguments") or {}).get("nodeId"), result.get("content")
            continue
        content = (d.get("message") or {}).get("content") if isinstance(d.get("message"), dict) else None
        for b in content if isinstance(content, list) else []:
            if b.get("type") == "tool_use":  # Claude Code
                uses[b.get("id")] = (b.get("name", ""), (b.get("input") or {}).get("nodeId"))
            elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses and not b.get("is_error"):
                yield *uses[b["tool_use_id"]], b.get("content")


def items(content) -> list[dict]:
    if isinstance(content, str):
        saved = REDIRECT.search(content)
        if not saved:
            return [{"type": "text", "text": content}]
        try:
            return json.loads(Path(saved.group(1)).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
    return [i for i in content or [] if isinstance(i, dict)]


def find_raw(tool: str, node: str, root: str | None = None) -> list[dict] | None:
    node = node.replace("-", ":")
    for path in transcripts(root):
        found = None
        for name, nid, content in calls(path):
            if (name == tool or name.endswith(("_" + tool, "." + tool))) and str(nid).replace("-", ":") == node:
                got = items(content)
                text = "".join(i.get("text", "") for i in got)
                if tool == "get_design_context" and text and "data-node-id" not in text:
                    continue  # Code Connect prompt, not the design context
                found = got
        if found is not None:
            return found
    return None


def save_raw(got: list[dict], out: Path) -> bool:
    """Write the response verbatim; False when it holds nothing."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix == ".png":
        data = next((i.get("data") or (i.get("source") or {}).get("data") for i in got if i.get("type") == "image"), None)
        png = base64.b64decode(data) if data else b""
        url = re.search(r'"image_url"\s*:\s*"([^"]+)"', "".join(i.get("text", "") for i in got))
        if not png and url:  # hosted screenshot: the URL expires, fetch it now
            try:
                png = urllib.request.urlopen(url.group(1), timeout=30).read()
            except OSError:
                png = b""
        if png.startswith(b"\x89PNG"):
            out.write_bytes(png)
            return True
        return False
    text = "\n".join(i.get("text", "") for i in got if i.get("type") == "text")
    out.write_text(json.dumps(got, ensure_ascii=False) if out.suffix == ".json" else text, encoding="utf-8")
    return bool(text.strip())


JSX_TAG = re.compile(r'<(/?)([A-Za-z][\w.]*)((?:\s+[^\s=/>]+(?:=(?:"[^"]*"|\{[^}]*\}))?)*)\s*(/?)>')
JSX_ATTR = re.compile(r'([\w-]+)=(?:"([^"]*)"|\{([^}]*)\})')
LITERAL = re.compile(r'(\{\s*`(?:[^`\\]|\\.)*`\s*\}|\{\s*"[^"]*"\s*\})')
WEIGHTS = {"thin": 100, "extralight": 200, "light": 300, "regular": 400, "normal": 400, "medium": 500,
           "semibold": 600, "bold": 700, "extrabold": 800, "black": 900}
STYLE = {  # property → class pattern; the innermost element that sets it wins
    "font": re.compile(r"font-\[[^\]\s]*?'[^':]+:([A-Za-z ]+)'"),
    "size": re.compile(r"text-\[(?:length:)?(?:var\([^\]\s]*?,)?([\d.]+)px\)?\]"),
    "line": re.compile(r"leading-\[(?:var\([^\]\s]*?,)?([\d.]+)px\)?\]"),
    "colour": re.compile(r"text-\[(?:color:)?(?:var\(--([^\]\s]*?),)?(#[0-9a-fA-F]{3,8}|white|black|transparent)\)?\]"),
    "align": re.compile(r"\btext-(left|right|center|justify)\b"),
    "italic": re.compile(r"(?<![\w-])(italic|not-italic)(?![\w-])"),
    "underline": re.compile(r"(?<![\w-])(underline|no-underline)(?![\w-])"),
    "opacity": re.compile(r"(?<![\w-])opacity-0(?![\w-])"),
}
# Static fallback when no buma_design_system source resolves: (UILabelStyle, UIFont, size, weight, line).
DS_STATIC = [
    ("headingH1", "heading.h1", 35, 700, 40), ("headingH2", "heading.h2", 29, 600, 32),
    ("headingH3", "heading.h3", 24, 700, 28), ("headingH4", "heading.h4", 20, 500, 24),
    ("headingH5", "subheading.h5", 16, 700, 20), ("headingH6", "subheading.h6", 14, 600, 16),
    ("headingH7", "subheading.h7", 12, 600, 16), ("bodySmall", "body.small", 11, 500, 16),
    ("bodyXstraSmall", "body.extraSmall", 8, 500, 12), ("bodyBold", "body.bold", 12, 700, 16),
    ("bodyParagraph", "body.paragraph", 12, 500, 24), (None, "body.defaultStyle", 12, 500, 16),
    (None, "body.mediumCompact", 14, 500, 16), ("bodyMedium", "body.medium", 14, 500, 18),
]


def ds_styles(app: Path) -> tuple[list[tuple], str]:
    """(UILabelStyle | None, UIFont path, size, weight, line, italic, underline) in label order, then the rest."""
    ds = app if (app / "lib/src/components/tokens/fonts").is_dir() else None
    config = app / ".dart_tool" / "package_config.json"
    if ds is None and config.is_file():
        for pkg in json.loads(config.read_text(encoding="utf-8")).get("packages", []):
            if pkg.get("name") == "buma_design_system":
                uri = pkg.get("rootUri", "")
                ds = Path(unquote(urlparse(uri).path)) if uri.startswith("file:") else (config.parent / uri).resolve()
    fonts = ds / "lib/src/components/tokens/fonts" if ds else None
    if not fonts or not fonts.is_dir():
        return [(*row, False, False) for row in DS_STATIC], "static table (no resolved buma_design_system)"
    styles, deprecated = {}, set()
    for group in ("heading", "subheading", "body"):
        src = (fonts / f"{group}.dart").read_text(encoding="utf-8") if (fonts / f"{group}.dart").is_file() else ""
        for m in re.finditer(r"(@Deprecated\([^;]*?\)\s*)?final TextStyle (\w+) = GoogleFonts\.\w+\((.*?)\);", src, re.S):
            body = m.group(3)
            size = re.search(r"fontSize:\s*([\d.]+)", body)
            weight = re.search(r"FontWeight\.(\w+)", body)
            line = re.search(r"height:\s*([\d.]+)", body)
            w = weight.group(1) if weight else "normal"
            styles[f"{group}.{m.group(2)}"] = (float(size.group(1)) if size else None, WEIGHTS.get(w) or int(w.strip("w")),
                                               float(line.group(1)) if line else None, "FontStyle.italic" in body,
                                               "TextDecoration.underline" in body)
            if m.group(1):
                deprecated.add(f"{group}.{m.group(2)}")
        for alias, target in re.findall(r"TextStyle get (\w+) => (\w+);", src):
            if f"{group}.{target}" in styles:
                styles[f"{group}.{alias}"] = styles[f"{group}.{target}"]
    label = ds / "lib/src/components/atoms/label/label.widget.dart"
    pairs = re.findall(r"UILabelStyle\.(\w+) => UIFont\.(\w+\.\w+)", label.read_text(encoding="utf-8")) if label.is_file() else []
    rows = [(name, font, *styles[font]) for name, font in pairs if font in styles]
    rows += [(None, font, *v) for font, v in styles.items() if font not in {f for _, f in pairs}]
    rows.sort(key=lambda r: r[1] in deprecated)  # stable: label order kept, deprecated last
    return rows, str(ds)


def ds_match(rows: list[tuple], size, weight, line, italic=False, underline=False) -> str | None:
    for name, font, *key in rows:
        if key == [size, weight, line, italic, underline]:
            return f"UILabelStyle.{name}" if name else f"UIFont.{font} ⚑"
    return None


def jsx_text(chunk: str) -> str:
    out = []
    for i, part in enumerate(LITERAL.split(chunk)):
        if i % 2:
            out.append(part.strip()[1:-1].strip()[1:-1])
        elif "\n" in part:
            out.append(" ".join(l.strip() for l in part.split("\n") if l.strip()))
        else:
            out.append(part)
    return html.unescape("".join(out))


def resolve(classes: list[str]) -> dict:
    got: dict = {}
    for cls in reversed(classes):
        for key, pattern in STYLE.items():
            if key not in got and (m := pattern.search(cls)):
                got[key] = m.groups() if key == "colour" else m.group(m.lastindex or 0)
    font = (got.get("font") or "").lower()
    weight = next((v for k, v in sorted(WEIGHTS.items(), key=lambda kv: -len(kv[0])) if k in font.replace(" ", "")), None)
    return {
        "size": float(got["size"]) if "size" in got else None, "weight": weight,
        "line": float(got["line"]) if "line" in got else None,
        "italic": "italic" in font or got.get("italic") == "italic", "underline": got.get("underline") == "underline",
        "colour": " ".join(x.replace("\\/", "/") for x in got["colour"] if x) if "colour" in got else "—",
        "align": got.get("align", "left"), "hidden": "opacity" in got,
    }


def design_context(text: str) -> tuple[list[dict], list[dict], list[tuple]]:
    """(texts, images, code connect) of the code part of a get_design_context response."""
    code = text.split("SUPER CRITICAL", 1)[0]
    snippets = [(dict((a, b or c) for a, b, c in JSX_ATTR.findall(m.group(1))), m.group(2))
                for m in re.finditer(r"<CodeConnectSnippet\b([^>]*)>(.*?)</CodeConnectSnippet>", code, re.S)]
    code = re.sub(r"<CodeConnectSnippet\b[^>]*>.*?</CodeConnectSnippet>", "", code, flags=re.S)
    urls = dict(re.findall(r'const (\w+) = "([a-z]+://[^"]+)"', code))
    stack: list[tuple[str, dict]] = []
    texts, images, para = [], [], None
    pos = 0
    for m in JSX_TAG.finditer(code):
        if para is not None and m.start() > pos:
            para["parts"].append((jsx_text(code[pos:m.start()]), [a.get("className", "") for _, a in stack]))
        pos = m.end()
        closing, tag, attrs, self_closing = m.groups()
        attrs = {a: b or c for a, b, c in JSX_ATTR.findall(attrs)}
        owners = [a for _, a in [*stack, (tag, attrs)] if a.get("data-node-id")]
        if closing:
            while stack and stack.pop()[0] != tag:
                pass
            if tag == "p" and para is not None:
                texts.append(para)
                para = None
            continue
        if tag == "img" and attrs.get("src") in urls:
            images.append({"owners": [o["data-node-id"] for o in reversed(owners)], "names": [o.get("data-name") for o in reversed(owners)],
                           "url": urls[attrs["src"]]})
        if self_closing:
            continue
        stack.append((tag, attrs))
        if tag == "p":
            para = {"owner": owners[-1]["data-node-id"] if owners else None, "parts": []}
    return texts, images, [(a.get("data-node-id"), a.get("data-name"), " ".join(re.sub(r"</?[A-Z]\w*>", "", body).split()))
                           for a, body in snippets]


def cell(v) -> str:
    return str(v).replace("|", "\\|").replace("\n", "\\n")


def num_str(v) -> str:
    return "—" if v is None else f"{v:g}"


def spec(dc: str, node: str, metadata: Path, app: Path) -> str:
    root = load(metadata, node)
    if root is None:
        raise SystemExit(f"no node {node} in {metadata}")
    box = {b[0].get("id"): b for b in absolute(root)}
    rows, source = ds_styles(app)
    texts, images, snippets = design_context(dc)
    out = [f"# spec {node}", "", f"DS: {source}", "", "## Texts",
           "| Node | Text | Size/Weight/Line | Colour | Align | x,y,w,h | DS |", "|---|---|---|---|---|---|---|"]
    unmatched, merged = [], {}
    for t in texts:
        styles = [resolve(c) for s, c in t["parts"] if s.strip()]
        merged.setdefault(t["owner"], []).append(("".join(s for s, _ in t["parts"]), styles))
    for owner, paras in merged.items():
        string = "\n".join(s for s, _ in paras)
        styles = [st for _, sts in paras for st in sts] or [resolve([])]
        st = styles[0]
        key = (st["size"], st["weight"], st["line"])
        mixed = {(x["size"], x["weight"], x["line"], x["italic"], x["underline"]) for x in styles}
        ds = ds_match(rows, *key, st["italic"], st["underline"])
        if len(mixed) > 1:
            unmatched.append((owner, string, f"mixed styles {sorted(mixed, key=str)} — one Text.rich span each"))
        elif ds is None:
            unmatched.append((owner, f"{string} {'/'.join(num_str(k) for k in key)}", "no DS text style with this size/weight/line"))
        b = box.get(owner)
        where = ",".join(f"{v:g}" for v in b[1:]) if b else "not in metadata"
        colour = st["colour"] + (" · opacity 0" if st["hidden"] else "")
        out.append(f"| {owner} | {cell(string)} | {'/'.join(num_str(k) for k in key)}{' italic' if st['italic'] else ''}"
                   f"{' underline' if st['underline'] else ''} | {cell(colour)} | {st['align']} | {where} | {ds or '—'} |")
    out += ["", "## Assets", "| Node | Name | URL | Size |", "|---|---|---|---|"]
    for img in images:
        i = next((k for k, o in enumerate(img["owners"]) if o in box), 0)
        owner, b = img["owners"][i] if img["owners"] else "—", box.get(img["owners"][i] if img["owners"] else None)
        out.append(f"| {owner} | {cell(img['names'][i] or '—') if img['owners'] else '—'} | {img['url']} | "
                   f"{f'{b[3]:g}×{b[4]:g}' if b else '—'} |")
    out += ["", "## Code Connect", "| Node | Name | Snippet |", "|---|---|---|"]
    out += [f"| {n} | {cell(name)} | `{cell(body)}` |" for n, name, body in snippets]
    out += ["", "## Unmatched", "| Node | Value | Why |", "|---|---|---|"]
    out += [f"| {n} | {cell(v)} | {why} |" for n, v, why in unmatched]
    return "\n".join(out) + "\n"


def spec_rows(text: str, heading: str) -> list[list[str]]:
    part = re.search(rf"^## {heading}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    rows = [[c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]] for line in (part.group(1) if part else "").splitlines()
            if line.startswith("|")]
    return [r for r in rows[2:] if r]


def image_ok(data: bytes, suffix: str) -> bool:
    if suffix == ".svg":
        head = data[:400].lstrip()
        return head.startswith((b"<svg", b"<?xml")) and re.search(rb"<(path|rect|circle|ellipse|line|polyline|polygon|image|use)\b", data) is not None
    return data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")


def download_assets(spec_md: Path, dest: Path) -> tuple[list[str], list[str]]:
    """(plan.md rows, errors). One file per URL; every node sharing it gets a row pointing to it."""
    rows, errors, files, tried = [], [], {}, set()
    dest.mkdir(parents=True, exist_ok=True)
    for node, name, url, _size in spec_rows(spec_md.read_text(encoding="utf-8"), "Assets"):
        suffix = Path(urlparse(url).path).suffix.lower() or ".png"
        if url not in files and url not in tried:
            tried.add(url)
            stem = re.sub(r"[^a-z0-9]+", "_", (name if name != "—" else node).lower()).strip("_") or "asset"
            path, n = dest / f"{stem}{suffix}", 1
            while path in files.values():
                n += 1
                path = dest / f"{stem}_{n}{suffix}"
            try:
                data = urllib.request.urlopen(url, timeout=30).read()
            except OSError as e:
                errors.append(f"{node} {name}: {url} → {e}")
                continue
            if not data:
                errors.append(f"{node} {name}: {url} returned nothing — expired: re-run get_design_context, re-spec")
                path.unlink(missing_ok=True)
                continue
            if not image_ok(data, suffix):
                errors.append(f"{node} {name}: {url} is not a {suffix} image (expired URL?)")
                data = b""
            if not data:
                path.unlink(missing_ok=True)
                continue
            path.write_bytes(data)
            files[url] = path
        if url in files and not any(r.endswith(f" {files[url].as_posix()} |") for r in rows):
            kind = "svg" if suffix == ".svg" else "raster"
            rows.append(f"| {node} | {name} | {kind} | {files[url].as_posix()} |")
    return rows, errors


PAINTED = re.compile(r"\bCustomPaint\b|\.draw(Rect|RRect|Circle|Path|Oval)\(")


def label_styles(source: str):
    """(first argument, UILabelStyle) of each UILabel(…); no style: → body (the DS default)."""
    for m in re.finditer(r"\bUILabel\(", source):
        depth, i, comma = 1, m.end(), None
        while i < len(source) and depth:
            c = source[i]
            if c in "'\"":  # skip a string literal
                end = re.match(rf"{c}(?:\\.|[^{c}\\])*{c}", source[i:])
                i += end.end() if end else 1
                continue
            depth += {"(": 1, ")": -1, "[": 1, "]": -1, "{": 1, "}": -1}.get(c, 0)
            if c == "," and depth == 1 and comma is None:
                comma = i
            i += 1
        arg = source[m.end():comma or i - 1].strip()
        style = re.search(r"\bstyle:\s*UILabelStyle\.(\w+)", source[m.end():i])
        yield arg, style.group(1) if style else "body"

def check_slice(spec_dir: Path, app: Path, sections: list[list[str]], dart: dict[str, str],
                plan_text: str, charts: set[str]) -> list[str]:
    """Figma data in by script (SKILL.md step 4b–5): design context saved whole, spec current,
    DS text styles and assets used as the spec says, no painted stand-in for an asset."""
    raw, errors = spec_dir / "work" / "raw", []
    planned = [r[0].lstrip("I") for r in spec_rows(plan_text, "Assets") if r]
    allowed: dict[str, set[str]] = {}
    styles: dict[str, set[str]] = {}  # section file → every DS style its spec names
    for row in sections:
        node, fid = row[0], re.sub(r"[:;]", "-", row[0])
        dc_path, meta_path, spec_path = raw / f"get_design_context-{fid}.md", raw / f"get_metadata-{fid}.md", spec_dir / "work" / f"spec-{fid}.md"
        if not dc_path.is_file():
            errors.append(f"{dc_path.name} missing — figma_xml.py raw get_design_context {node} work/raw/{dc_path.name}")
            continue
        dc = response_text(dc_path)
        if not (raw / f"get_metadata-{fid}.json").is_file():
            errors.append(f"get_metadata-{fid}.json missing — figma_xml.py raw get_metadata {node} work/raw/get_metadata-{fid}.json, then extract")
        elif meta_path.is_file():
            whole = extract(response_text(raw / f"get_metadata-{fid}.json"), node)
            fence = re.search(r"```xml\s*\n(.*?)\n?```", meta_path.read_text(encoding="utf-8"), re.S)
            if whole and (not fence or fence.group(1).strip() != whole.strip()):
                errors.append(f"{meta_path.name}: differs from the saved response — metadata edited by hand; re-run figma_xml.py extract")
        root = load(meta_path, node) if meta_path.is_file() else None
        if root is None:
            continue
        lost = [b[0].get("id") for b in absolute(root) if b[0].tag == "text" and b[3] * b[4] > 0
                and f'data-node-id="{b[0].get("id")}"' not in dc]
        if lost:
            errors.append(f"{dc_path.name}: {len(lost)} metadata text node(s) not in the design context (first: {lost[0]}) — "
                          f"truncated or summarised; re-save with figma_xml.py raw")
        if not spec_path.is_file():
            errors.append(f"work/{spec_path.name} missing — figma_xml.py spec work/raw/{dc_path.name} {node} "
                          f"--metadata work/raw/{meta_path.name} work/{spec_path.name}")
            continue
        text = spec_path.read_text(encoding="utf-8")
        if text != spec(dc, node, meta_path, app):
            errors.append(f"work/{spec_path.name}: differs from figma_xml.py spec on the saved raw files — re-run it, never edit it")
        rows = spec_rows(text, "Texts")
        loose = [r[0] for r in rows if r[5] == "not in metadata"]
        if loose:
            errors.append(f"{meta_path.name}: {len(loose)} design-context text node(s) missing (first: {loose[0]}) — "
                          f"get_metadata not expanded; fetch the nested instance (SKILL.md 4b) and re-run spec")
        section: set[str] = set()
        for r in rows:
            ds = re.match(r"UILabelStyle\.(\w+)|UIFont\.body\.defaultStyle", r[6])
            if ds:
                allowed.setdefault(r[1].replace("\\|", "|"), set()).add(ds.group(1) or "body")
                section.add(ds.group(1) or "body")
        assets = spec_rows(text, "Assets")
        by_url: dict[str, list[str]] = {}
        for a in assets:
            by_url.setdefault(a[2], []).append(a[0])
        for url, owners in by_url.items():
            if not any(o.lstrip("I") == p or o.lstrip("I").endswith(";" + p) or p.endswith(";" + o.lstrip("I"))
                       for o in owners for p in planned):
                errors.append(f"plan.md ## Assets: no row for spec asset {owners[0]} ({url.rsplit('/', 1)[-1]}) — "
                              f"figma_xml.py assets work/{spec_path.name} <dest>, or a ds row naming the DS widget")
        rel = f"presentation/{row[2]}" if len(row) > 2 else None
        if section and rel in dart:
            styles[rel] = section
        if assets and node not in charts and rel in dart and PAINTED.search(dart[rel]):
            errors.append(f"{rel}: paints shapes while the spec of {node} has assets — use the downloaded files, not a CustomPaint stand-in")
    for rel, source in dart.items():
        for arg, style in label_styles(source):
            literal = re.fullmatch(r"""(['"])(.*)\1""", arg)
            text = literal.group(2).replace("\\'", "'") if literal else None
            if text in allowed and style not in allowed[text]:
                want = " or ".join(f"UILabelStyle.{x}" for x in sorted(allowed[text]))
                errors.append(f"{rel}: UILabel('{text}') uses UILabelStyle.{style}; spec says {want}")
            elif (text is None or "$" in text) and rel in styles and style not in styles[rel]:
                # Data-driven labels (UILabel(metric.plan, …)) still use one of the section's spec styles.
                errors.append(f"{rel}: UILabel({arg[:40]}) uses UILabelStyle.{style}; the spec of this section has "
                              f"{', '.join(f'UILabelStyle.{x}' for x in sorted(styles[rel]))}")
    return errors


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) >= 3 and args[0] == "extract":
        sub = extract(response_text(Path(args[1])), args[2])
        if sub is None:
            print(f"no node {args[2]} in {args[1]}", file=sys.stderr)
            return 1
        ET.fromstring(sub)  # balanced or it raises
        doc = f"# get_metadata {args[2]}\n\n```xml\n{sub}\n```\n"
        if len(args) > 3:
            Path(args[3]).write_text(doc, encoding="utf-8")
        else:
            print(doc, end="")
        return 0
    if len(args) in (4, 6) and args[0] == "raw":
        got = find_raw(args[1], args[2], args[5] if len(args) == 6 and args[4] == "--root" else None)
        if got is None:
            print(f"no {args[1]} call on {args[2]} in the transcripts — write {args[3]} from the tool result, verbatim",
                  file=sys.stderr)
            return 1
        if not save_raw(got, Path(args[3])):
            print(f"{args[1]} {args[2]} returned nothing usable (empty node or expired image URL) — re-fetch once; still empty → stop and ask", file=sys.stderr)
            return 3
        print(f"wrote {args[3]}")
        return 0
    if len(args) >= 5 and args[0] == "spec" and "--metadata" in args:
        rest = list(args[1:])
        flags = {}
        for flag in ("--metadata", "--ds"):
            if flag in rest:
                i = rest.index(flag)
                flags[flag] = rest[i + 1]
                del rest[i : i + 2]
        doc = spec(response_text(Path(rest[0])), rest[1], Path(flags["--metadata"]), Path(flags.get("--ds", ".")))
        if len(rest) > 2:
            Path(rest[2]).write_text(doc, encoding="utf-8")
            print(f"wrote {rest[2]}")
        else:
            print(doc, end="")
        return 0
    if len(args) == 3 and args[0] == "assets":
        rows, errors = download_assets(Path(args[1]), Path(args[2]))
        print("\n".join(["| Node | Name | Kind | Path |", "|---|---|---|---|", *rows]))
        for e in errors:
            print(e, file=sys.stderr)
        return 1 if errors else 0
    if len(args) == 3 and args[0] == "classify":
        root = load(Path(args[1]), args[2])
        if root is None:
            print(f"no node {args[2]} in {args[1]}", file=sys.stderr)
            return 1
        result = classify(root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 3 if result.get("insufficient") else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
