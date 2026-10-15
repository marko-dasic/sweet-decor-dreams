#!/usr/bin/env python3
"""QA stills: render chosen timestamps to JPEGs and print console errors/warnings.

Usage: python3 motion/scripts/snap.py OUTDIR t1 t2 ... [--dsf 0.5] [--noguides] [--state]
       python3 motion/scripts/snap.py OUTDIR --every 0.5 [--dsf 0.25]
"""
import argparse, asyncio, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import serve  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ARGS = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]


async def run(out, times, dsf, guides, show_state, port):
    out.mkdir(parents=True, exist_ok=True)
    msgs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={"width": 1080, "height": 1920}, device_scale_factor=dsf)
        page = await ctx.new_page()
        page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))
        page.on("requestfailed", lambda r: msgs.append(f"[requestfailed] {r.url}"))
        await page.goto(f"http://127.0.0.1:{port}/index.html" + ("?guides=1" if guides else ""))
        await page.wait_for_function("window.M && M.ready === true", timeout=120000)
        total = await page.evaluate("M.total")
        for t in times:
            if t >= total:
                t = total - 1 / 60
            await page.evaluate(f"renderFrame({t:.6f})")
            await page.screenshot(path=str(out / f"t{t:07.3f}.jpg"), type="jpeg", quality=88)
            if show_state:
                st = await page.evaluate("JSON.stringify(M.state)")
                print(f"{t:7.3f}", st[:600])
        await b.close()
    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out"); ap.add_argument("times", nargs="*", type=float)
    ap.add_argument("--every", type=float); ap.add_argument("--total", type=float, default=None)
    ap.add_argument("--dsf", type=float, default=0.5); ap.add_argument("--noguides", action="store_true")
    ap.add_argument("--state", action="store_true"); ap.add_argument("--port", type=int, default=8777)
    a = ap.parse_args()
    times = list(a.times)
    if a.every:
        total = a.total or json.loads((serve.ROOT / "data/plan.js").read_text().split("=", 1)[1].rstrip(";\n"))["total"]
        n = int(total / a.every) + 1
        times = [round(i * a.every, 4) for i in range(n)]
    srv = serve.start(a.port)
    msgs = asyncio.run(run(Path(a.out), times, a.dsf, not a.noguides, a.state, a.port))
    srv.shutdown()
    print(f"{len(times)} stills -> {a.out}")
    print("console errors/warnings:", len(msgs))
    for m in msgs:
        print("  ", m)
    sys.exit(1 if msgs else 0)


if __name__ == "__main__":
    main()
