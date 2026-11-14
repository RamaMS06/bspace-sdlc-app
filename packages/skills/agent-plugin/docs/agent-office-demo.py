#!/usr/bin/env python3
"""Agent Office demo: a dummy feature run that writes real-shaped intent/ + specs/ files step by step,
the way the agents would, and refreshes .office/state.js after each step like the PostToolUse hook does.
Shows the final live view without a real run.

  python3 docs/agent-office-demo.py            # recover path, opens the 3D page
  python3 docs/agent-office-demo.py --blocked  # run-verify ends BLOCKED
  options: --dir <path> (default: new temp dir) · --step <seconds> (default 3) · --no-open
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hooks"))
import office_state  # noqa: E402

ID = "LV-012-leave-request"
INTENT = """# LV-012 Leave request
Platforms: flutter
## US-1 Ajukan cuti
- AC-1 Given saldo cuti, When buka form, Then saldo tampil. UI: yes
- AC-2 Given tanggal valid, When submit, Then status Pending. UI: yes
- AC-3 Given saldo 0, When submit, Then {q}. UI: yes
"""


def main(argv: list[str]) -> int:
    arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731
    root = Path(arg("--dir", "") or tempfile.mkdtemp(prefix="office-demo-"))
    step, blocked = float(arg("--step", 3)), "--blocked" in argv
    idir, spec = root / "intent" / ID, root / "specs" / "leave_request"
    idir.mkdir(parents=True, exist_ok=True)

    def w(p: Path, s: str):
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(s, encoding="utf-8")

    def score(node, history, **extra):
        last = history[-1]
        w(spec / "work/iter" / node / "score.json", json.dumps({
            "node": node, "round": len(history), "fidelity": last, "pass": last >= 98, "pass_at": {"section": 98},
            "history": [{"round": i + 1, "fidelity": f} for i, f in enumerate(history)], **extra}))

    design = "# Design\n| Component | Props | AC |\n|---|---|---|\n| BalanceCard | days | AC-1 |\n| LeaveForm | dates | AC-2 |\n"
    approved = "Status: approved\nApproved-by: PM 2026-10-28\n"
    plan = "# plan\n## Sections\nheader · balance · form\n## Notes\n"
    steps = [
        lambda: None,  # no intent.md yet: Analyst starts Q&A
        lambda: w(idir / "intent.md", INTENT.format(q="[NEEDS CLARIFICATION: saldo 0 boleh submit?]")),
        lambda: w(idir / "intent.md", INTENT.format(q="tombol submit nonaktif")),
        lambda: w(idir / "intent.md", INTENT.format(q="tombol submit nonaktif") + approved),
        lambda: w(idir / "design.md", design),  # C1 fails: AC-3 missing
        lambda: w(idir / "design.md", design + "| EmptyBalanceBanner | — | AC-3 |\n"),
        lambda: w(idir / "design.md", design + "| EmptyBalanceBanner | — | AC-3 |\nComponents-approved-by: PM 2026-10-28\n"),
        lambda: w(idir / "design.md", design + "| EmptyBalanceBanner | — | AC-3 |\nComponents-approved-by: PM 2026-10-28\n"
                  "Metadata-hash: 3f9a1c2b7d4e\n"),
        lambda: w(idir / "design.md", design + "| EmptyBalanceBanner | — | AC-3 |\nComponents-approved-by: PM 2026-10-28\n"
                  "Metadata-hash: 3f9a1c2b7d4e\nReviewed-by: Designer 2026-10-28\n"),
        lambda: (w(spec / "spec.md", f"# spec\n**Intent:** intent/{ID}/intent.md@a1b2c3d4e5f6\n"), w(spec / "plan.md", plan)),
        lambda: [score(n, h) for n, h in (("header", [72]), ("balance", [64]), ("form", [55]))],
        lambda: [w(spec / "work/iter" / n / "verify.md", "fresh-context verify\n") for n in ("balance", "form")],
        lambda: [score(n, h) for n, h in (("header", [72, 91]), ("balance", [64, 85]), ("form", [55, 58]))],
        lambda: [score(n, h) for n, h in (("header", [72, 91, 98.6]), ("balance", [64, 85, 93]), ("form", [55, 58, 58.2]))],
        lambda: (score("balance", [64, 85, 93, 98.2]), score("form", [55, 58, 58.2, 58.3], stop=True)),
        lambda: None,  # developer reads diff.png, answers "logo = asset", --continue
        lambda: score("form", [55, 58, 58.2, 58.3, 99.1], resumed=True),
        lambda: w(spec / "plan.md", plan + "- run: FAIL device: A RenderFlex overflowed by 12px\n"),
    ]
    if blocked:
        steps += [
            lambda: w(spec / "plan.md", plan + "- run: FAIL device r1: pod install failed (iOS 12 < DS min)\n"),
            lambda: w(spec / "plan.md", plan + "- run: BLOCKED pod install — update Xcode / CocoaPods\n"),
        ]
    else:
        steps += [
            lambda: w(spec / "plan.md", plan + "- run: PASS iPhone 15\n"),
            lambda: w(idir / "close.md", "# Close\n| AC | flutter |\n|---|---|\n| AC-1 | ✓ |\n| AC-2 | ✓ |\n| AC-3 | ✓ |\n"),
        ]

    (root / ".office").mkdir(exist_ok=True)
    for i, s in enumerate(steps):
        s()
        office_state.update(root)
        if i == 0 and "--no-open" not in argv:
            office_state.main(["", str(root), "--open"])
        time.sleep(step)
    print(root)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
