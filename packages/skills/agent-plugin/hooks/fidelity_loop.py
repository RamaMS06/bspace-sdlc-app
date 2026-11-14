#!/usr/bin/env python3
"""Stop hook: the fidelity loop is not the model's to end. While a section's last score.json fails
and diff_renders.py has not said STOP, ending the turn is blocked with the next step. There is no
block-count escape: only `pass: true` or an explicit scorer `stop` permits the turn to end.

Reads the hook JSON on stdin (`cwd`); scans <cwd>[/<pkg>]/specs/*/work/iter/*/score.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

FRESH = 24 * 3600


def open_loops(root: Path, now: float) -> list[str]:
    reasons = []
    pattern = "specs/*/work/iter/*/score.json"  # package root, or one level down (monorepo)
    for score in sorted({*root.glob(pattern), *root.glob("*/" + pattern)}):
        if now - score.stat().st_mtime > FRESH:
            continue
        try:
            result = json.loads(score.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if result.get("pass") or result.get("stop"):
            continue
        slice_dir = score.parents[3]
        node = result.get("node", score.parent.name)
        weak = ", ".join(f"{n.get('id')} {n.get('fidelity')}%" for n in result.get('weak', [])[:2])
        geometry = ", ".join(result.get('geometry', [])[:2])
        detail = "; ".join(x for x in (weak, geometry) if x) or "see score.json"
        reasons.append(
            f"{node} ({slice_dir.name}): {result.get('fidelity')}% < "
            f"{result.get('pass_at', {}).get('section', 98)}%, round {result.get('round')}; "
            f"targets: {detail}. Read score.json, fix only these targets, re-render, score. "
            f"Only exit 0 (pass) or 4 (STOP) ends the loop."
        )
    return reasons


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}
    reasons = open_loops(Path(data.get("cwd") or "."), time.time())
    if reasons:
        print(json.dumps({"decision": "block", "reason": "\n".join(reasons)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
