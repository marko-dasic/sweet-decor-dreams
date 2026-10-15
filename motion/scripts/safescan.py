#!/usr/bin/env python3
"""Error scan + safe-zone scan + resolution scan over the whole timeline.

Steps t every --step seconds (default 0.25) at DSF 0.25 and:
  * collects page errors / console warnings / failed requests (accept zero),
  * projects each visible shot's focal and must_keep boxes through its current window and checks them
    against the safe area (outside transitions); a violation counts if it lasts more than 0.3 s,
  * checks every visible end-card element with M.inSafe(el, 16),
  * prints the maximum effective zoom per shot (output px per native source px), flagging > 1.15.
Exit code 1 if there are errors or violations.
"""
import argparse, asyncio, json, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import serve  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

SAFE = dict(l=54, r=1026, t=192, b=1536)


def sides(b):
    x, y, w, h = b
    out = {}
    if x < SAFE["l"]: out["left"] = SAFE["l"] - x
    if x + w > SAFE["r"]: out["right"] = x + w - SAFE["r"]
    if y < SAFE["t"]: out["top"] = SAFE["t"] - y
    if y + h > SAFE["b"]: out["bottom"] = y + h - SAFE["b"]
    return out


async def scan(step, port):
    msgs, rows = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--disable-background-timer-throttling", "--disable-renderer-backgrounding"])
        ctx = await b.new_context(viewport={"width": 1080, "height": 1920}, device_scale_factor=0.25)
        page = await ctx.new_page()
        page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))
        page.on("requestfailed", lambda r: msgs.append(f"[requestfailed] {r.url}"))
        await page.goto(f"http://127.0.0.1:{port}/index.html")
        await page.wait_for_function("window.M && M.ready === true", timeout=120000)
        total = await page.evaluate("M.total")
        n = int(round(total / step))
        for i in range(n + 1):
            t = min(i * step, total - 1 / 60)
            await page.evaluate(f"renderFrame({t:.6f})")
            if i % 2 == 0:  # the error scan also captures pixels (decode/paint problems surface here)
                await page.screenshot(type="jpeg", quality=50)
            st = json.loads(await page.evaluate("JSON.stringify(M.state)"))
            rows.append((t, st))
        await b.close()
    return msgs, rows, total


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--step", type=float, default=0.25); ap.add_argument("--port", type=int, default=8778)
    a = ap.parse_args()
    srv = serve.start(a.port)
    msgs, rows, total = asyncio.run(scan(a.step, a.port))
    srv.shutdown()

    # safe zone: group consecutive violating samples per (shot, box, side)
    runs = defaultdict(list)
    maxk = defaultdict(float)
    for t, st in rows:
        for s in st.get("shots", []):
            maxk[(s["id"], s.get("asset"))] = max(maxk[(s["id"], s.get("asset"))], s["srcK"])
            if s["inTrans"]:
                continue
            boxes = ([("focal", s["focal"])] if s.get("focal") else []) + [(f"must_keep{j}", b) for j, b in enumerate(s.get("must_keep", []))]
            for name, bx in boxes:
                for side, px in sides(bx).items():
                    runs[(s["id"], name, side)].append((t, px, [round(v) for v in bx]))
        for u in st.get("ui", []):
            if u["vis"] and not u["inSafe"]:
                runs[("endcard", u["k"], "outside")].append((t, 0, u["r"]))
    violations = []
    for key, samples in runs.items():
        # split into contiguous runs (consecutive samples)
        cur = [samples[0]]
        for smp in samples[1:]:
            if smp[0] - cur[-1][0] <= a.step + 1e-6:
                cur.append(smp)
            else:
                violations.append((key, cur)); cur = [smp]
        violations.append((key, cur))
    bad = [(k, r) for k, r in violations if (r[-1][0] - r[0][0] + a.step) > 0.3]
    print(f"scanned {len(rows)} samples over {total:.2f} s (step {a.step} s)")
    print("console errors/warnings:", len(msgs))
    for m in msgs:
        print("  ", m)
    print("safe-zone violations (> 0.3 s):", len(bad))
    for (sid, box, side), r in bad:
        print(f"   {sid} {box} {side}: t {r[0][0]:.2f}-{r[-1][0]:.2f}s, up to {max(x[1] for x in r):.0f}px, box {r[0][2]}")
    short = [(k, r) for k, r in violations if (k, r) not in bad]
    if short:
        print("brief excursions (<= 0.3 s, accepted):", ", ".join(f"{k[0]} {k[1]} {k[2]} @{r[0][0]:.2f}s" for k, r in short))
    print("max effective zoom (output px per native source px):")
    for (sid, asset), k in maxk.items():
        print(f"   {sid} {asset}: {k:.3f}" + ("   <-- above 1.15" if k > 1.15 else ""))
    sys.exit(1 if (msgs or bad) else 0)


if __name__ == "__main__":
    main()
