#!/usr/bin/env python3
"""Validate a lo-fi wireframe hand-off."""
from pathlib import Path
import re
import sys

def main(root):
    folder = Path(root).resolve()
    path = folder / "wireframe.md"
    errors = []
    if not path.is_file() or not path.stat().st_size: errors.append("missing or empty wireframe.md")
    if not (folder / "wireframe-evidence").is_dir(): errors.append("missing wireframe-evidence/")
    if errors:
        for error in errors: print(f"ERROR: {error}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    status = re.search(r"^Status:\s*(\S+)\s*$", text, re.M)
    if not status or status.group(1) not in {"draft", "needs-clarification", "approved", "blocked"}: errors.append("invalid Status")
    if status and status.group(1) == "approved" and not re.search(r"^Approved-by:\s*.+\s+\d{4}-\d{2}-\d{2}\s*$", text, re.M): errors.append("approved wireframe needs dated Approved-by")
    for field in ("Figma-file", "Figma-page", "Figma-placement"):
        if not re.search(rf"^{re.escape(field)}:\s*[^<].+", text, re.M): errors.append(f"missing {field}")
    for section in ("Purpose", "Screens and states", "Flow", "Field and component inventory", "Stakeholder review"):
        if not re.search(rf"^## {re.escape(section)}\s*$", text, re.M): errors.append(f"missing section: {section}")
    if not re.search(r"\bSCR-\d{2,}\b", text): errors.append("missing SCR-xx")
    if not re.search(r"\b(?:US|AC|BR)-\d{2,}\b", text): errors.append("missing traceability ID")
    if errors:
        for error in errors: print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"PASS: {folder}")
    return 0

if __name__ == "__main__": raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
