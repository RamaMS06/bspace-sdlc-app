#!/usr/bin/env python3
"""Agent Office state: turns intent/ + specs/ artifacts into .office/state.js for docs/agent-office-3d.html.

Hook mode (stdin JSON with `cwd`): no-op unless <cwd>/.office exists — it is created only when the user
answers yes to "lihat proses di Agent Office 3D?". `office_state.py <root> --open` creates .office, writes
the first state and opens the page. Reads what the using-bspace-sdlc routing table reads; writes only .office/.

Inside the BSpace SDLC desktop app (`BSPACE_SDLC_APP=1`) the office is always on and never opens a browser:
every update is sent straight to the app (POST $BUMA_AI_URL/office with the session's $BUMA_AI_TOKEN), which
shows it in Workflow, and is also written to .office/office.json for the app to read after a restart.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import quote

IN_APP = os.environ.get("BSPACE_SDLC_APP") == "1"

PAGE = Path(__file__).resolve().parents[1] / "docs" / "agent-office-3d.html"
PHASES = ["brainstorm", "design", "slice", "verify", "close"]
TITLE = {"brainstorm": "1 Brainstorm", "design": "2 Design", "slice": "3 Slice", "verify": "4 Run-verify", "close": "5 Close"}
ROOM = {"analyst": "brainstorm", "designer": "design", "dev": "slice", "verifier": "slice", "qa": "verify", "lead": "close"}


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def has(text: str, pat: str) -> bool:
    return re.search(pat, text, re.M) is not None


def derive(root: Path) -> dict:
    dirs = sorted(root.glob("intent/*/intent.md"), key=lambda p: p.stat().st_mtime)
    idir = dirs[-1].parent if dirs else None
    intent = read(idir / "intent.md") if idir else ""
    specs = [p.parent for p in sorted({*root.glob("specs/*/spec.md"), *root.glob("*/specs/*/spec.md")})
             if idir and f"intent/{idir.name}/" in read(p)]
    s = {"intent": idir.name if idir else "—", "units": [], "agents": [], "chips": {}, "blocked": False}

    def unit(id, who, role, status, mode="type", note="", metric=None, ask="", err=""):
        s["units"].append({"id": id, "who": who, "status": status, "note": note, "metric": metric, "ask": ask})
        if status != "done":
            s["agents"].append({"id": id, "role": role, "room": ROOM[role], "unit": id, "mode": mode, "err": err})

    def chip(u, text, kind):
        s["chips"].setdefault(u, []).append([text, kind])

    def brainstorm():
        if not intent:
            unit("intent", "Analyst", "analyst", "running", note="Q&A"); chip("intent", "Q&A", "run"); return False
        open_ = re.findall(r"\[NEEDS CLARIFICATION[^\]]*\]|^- Q-\d+.*$", intent, re.M)
        if open_:
            unit("intent", "Analyst", "analyst", "awaiting-human", "ask", f"{len(open_)} open", ask=open_[0].strip("[]- "))
            chip("intent", f"G1 ✗ {len(open_)} open", "bad"); return False
        if not (has(intent, r"^Status: approved") and has(intent, r"^Approved-by: .+ \d{4}-")):
            unit("intent", "Analyst", "analyst", "awaiting-human", "ask", ask="approve intent.md (G1)")
            chip("intent", "ask approve", "info"); return False
        unit("intent", "Analyst", "analyst", "done", note="G1 pass"); chip("intent", "G1 ✓", "ok"); return True

    def design():
        d = read(idir / "design.md")
        if not d:
            unit("design", "Designer", "designer", "running", note="discovery"); chip("design", "discovery", "run"); return False
        missing = sorted(set(re.findall(r"AC-\d+", intent)) - set(re.findall(r"AC-\d+", d)))
        if missing:
            unit("design", "Designer", "designer", "running", "err", ", ".join(missing) + " missing", err="C1")
            chip("design", "C1 ✗ " + ",".join(missing), "bad"); return False
        if not has(d, r"^Components-approved-by: .+ \d{4}-"):
            unit("design", "Designer", "designer", "awaiting-human", "ask", ask="approve component plan (C1)")
            chip("design", "ask C1", "info"); return False
        if not has(d, r"^Metadata-hash: [0-9a-f]{12}"):
            unit("design", "Designer", "designer", "running", note="build + prototype"); chip("design", "C1 ✓", "ok"); return False
        if not has(d, r"^Reviewed-by: .+ \d{4}-"):
            unit("design", "Designer", "designer", "awaiting-human", "ask", ask="designer review (G2)")
            chip("design", "review", "info"); return False
        unit("design", "Designer", "designer", "done", note="G2 pass"); chip("design", "G2 ✓", "ok"); return True

    def slice_():
        if not specs:
            unit("spec", "Dev", "dev", "running", note="spec.md"); return False
        ok = True
        for sp in specs:
            scores = sorted(sp.glob("work/iter/*/score.json"))
            if not scores:
                unit(sp.name, "Dev", "dev", "running", note="plan.md"); ok = False; continue
            for sc in scores:
                try:
                    r = json.loads(read(sc))
                except json.JSONDecodeError:
                    continue
                name, fid, at = r.get("name") or sc.parent.name, r.get("fidelity"), r.get("pass_at", {}).get("section", 98)
                prev = None
                for h in r.get("history", []):  # progress = fidelity up >= 0.5 point (diff_renders rule)
                    stuck = prev is not None and h["fidelity"] - prev < 0.5 and h["fidelity"] < at
                    chip(name, f"r{h['round']} {h['fidelity']}%" + (" no progress" if stuck else ""),
                         "ok" if h["fidelity"] >= at else "bad" if stuck else "run")
                    prev = h["fidelity"]
                if r.get("pass"):
                    unit(name, "Dev", "dev", "done", metric=fid); continue
                ok = False
                if r.get("stop"):
                    chip(name, "exit 4 STOP", "bad")
                    unit(name, "Dev", "dev", "needs-context", "alert", metric=fid,
                         ask=f"{name} stuck {fid}% — lihat work/iter/{sc.parent.name}/diff.png")
                    continue
                unit(name, "Dev", "dev", "running", metric=fid)
                v = sc.parent / "verify.md"
                if v.exists() and v.stat().st_mtime > sc.stat().st_mtime:  # verifier works on the failed round
                    s["agents"].append({"id": "vf-" + name, "role": "verifier", "room": "slice", "beside": name})
        return ok

    def verify():
        runs = [m for sp in specs for m in re.findall(r"^- run: (PASS|FAIL|BLOCKED)\s*(.*)$", read(sp / "plan.md"), re.M)]
        for k, txt in runs:
            chip("run", f"{k} {txt[:28]}", "ok" if k == "PASS" else "bad")
        if not runs:
            unit("run", "QA", "qa", "running", note="headless + device"); return False
        k, txt = runs[-1]
        if k == "PASS":
            unit("run", "QA", "qa", "done", note="run: PASS " + txt); return True
        if k == "BLOCKED":
            unit("run", "QA", "qa", "blocked", "blocked", "run: BLOCKED", ask="run BLOCKED: " + txt)
            s["blocked"] = True; return False
        unit("run", "QA", "qa", "running", "err", txt[:40], err="run"); return False

    def close():
        c = read(idir / "close.md")
        if not c:
            unit("close", "Lead", "lead", "running", note="AC × platform"); return False
        if re.search(r"\|[ \t]*\|", c):
            unit("close", "Lead", "lead", "awaiting-human", "ask", ask="close.md: AC cell kosong"); return False
        unit("close", "Lead", "lead", "done", note="close.md ✓"); return True

    phases, active = {}, None
    for k, fn in zip(PHASES, (brainstorm, design, slice_, verify, close)):
        if active:
            phases[k] = "todo"
        elif fn():
            phases[k] = "done"
        else:
            active, phases[k] = k, "blocked" if s["blocked"] else "active"
    say = "stop: run BLOCKED" if s["blocked"] else f"next: {TITLE[active]}" if active else "DONE"
    s["agents"].append({"id": "mgr", "role": "manager", "say": say})
    s["phases"], s["say"] = phases, say
    return s


def update(root: Path) -> Path:
    off = root / ".office"
    try:
        prev = json.loads(read(off / "state.json") or "{}")
    except json.JSONDecodeError:
        prev = {}
    cur = derive(root)
    t0 = prev.get("t0", time.time())
    sec = int(time.time() - t0)
    stamp = f"{sec // 60:02d}:{sec % 60:02d}"
    log, iters = prev.get("log", []), prev.get("iters", {})
    if cur["say"] != prev.get("say"):
        log.append([stamp, "Manager", cur["say"], cur["blocked"]])
    who = {u["id"]: u["who"] for u in cur["units"]}
    for u, chips in cur["chips"].items():  # chips only accumulate, so the log is exactly the new ones
        seen = iters.setdefault(u, [])
        for c in chips:
            if c not in seen:
                seen.append(c)
                log.append([stamp, who.get(u, "Dev"), f"{u} {c[0]}", c[1] == "bad"])
    log = log[-80:]
    state = {"intent": cur["intent"], "t": time.time(), "phases": cur["phases"], "units": cur["units"],
             "iters": iters, "agents": cur["agents"], "log": log}
    full = json.dumps(state, ensure_ascii=False)
    for name, body in (("state.json", json.dumps({"t0": t0, "say": cur["say"], "iters": iters, "log": log})),
                       ("state.js", "window.OFFICE_STATE=" + full + ";"),
                       ("office.json", full)):
        tmp = off / (name + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(off / name)  # atomic: the page never reads half a file
    if IN_APP:
        send_to_app(full)
    return off / "state.js"


def send_to_app(body: str) -> None:
    """Sends the office state to the BSpace SDLC app's local endpoint. Best effort: never fails the hook."""
    url, token = os.environ.get("BUMA_AI_URL"), os.environ.get("BUMA_AI_TOKEN")
    if not url or not token:
        return
    req = urllib.request.Request(
        url.rstrip("/") + "/office",
        data=body.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(req, timeout=3).read()
    except OSError:
        pass


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        root = Path(argv[1]).resolve()
        if "--open" in argv and IN_APP:
            # The app shows the office in Workflow: no browser page.
            (root / ".office").mkdir(exist_ok=True)
            update(root)
            print("Agent Office is live in BSpace SDLC › Workflow.")
        elif "--open" in argv:
            (root / ".office").mkdir(exist_ok=True)
            state = update(root)
            # launcher page: macOS `open` drops the query string of file:// URLs
            url = PAGE.as_uri() + "?state=" + quote(state.as_uri(), safe="")
            launcher = root / ".office" / "index.html"
            launcher.write_text(f'<meta http-equiv="refresh" content="0;url={url}">', encoding="utf-8")
            webbrowser.open(launcher.as_uri())
            print(launcher)
        elif (root / ".office").is_dir():
            update(root)
        return 0
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}
    root = Path(data.get("cwd") or ".")
    if IN_APP:
        (root / ".office").mkdir(exist_ok=True)  # always on inside the app
    if (root / ".office").is_dir():
        update(root)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
