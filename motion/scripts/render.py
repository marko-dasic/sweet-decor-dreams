#!/usr/bin/env python3
"""Render the reel: 4 Chromium workers -> JPEG q98 frames -> CRF 10 segments -> concat -> 2-pass final encode.

Usage (from the working directory):
  python3 motion/scripts/render.py [--out final_reel_1080x1920.mp4] [--workers 4] [--tmp DIR] [--keep]
Temp files go to --tmp (default: a folder in the system temp dir), never into the working directory.
"""
import argparse, asyncio, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import serve  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ARGS = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
if sys.platform == "darwin":
    ARGS += ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync"]
FPS = 60
# JPEG frames are full-range BT.601: convert to limited-range BT.709 and tag it.
SEG_VF = "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p"
TAGS = ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]


async def worker(idx, frames, seg_path, port, progress):
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
                           "-vf", SEG_VF, "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p",
                           *TAGS, "-r", str(FPS), str(seg_path)], stdin=subprocess.PIPE)
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
        await page.goto(f"http://127.0.0.1:{port}/index.html")
        await page.wait_for_function("window.M && M.ready === true", timeout=180000)
        first = True
        for f in frames:
            await page.evaluate(f"renderFrame({f / FPS:.6f})")
            jpg = await page.screenshot(type="jpeg", quality=98)
            if first:
                from PIL import Image
                import io
                size = Image.open(io.BytesIO(jpg)).size
                assert size == (1080, 1920), f"screenshot is {size}, expected 1080x1920"
                first = False
            ff.stdin.write(jpg)
            progress[idx] += 1
        await b.close()
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError(f"segment {idx} ffmpeg failed")
    return errors


async def render_all(n_frames, workers, tmp, port):
    chunks = [range(i * n_frames // workers, (i + 1) * n_frames // workers) for i in range(workers)]
    segs = [tmp / f"seg{i}.mp4" for i in range(workers)]
    progress = [0] * workers
    t0 = time.time()

    async def report():
        while True:
            await asyncio.sleep(10)
            done = sum(progress)
            el = time.time() - t0
            print(f"  {done}/{n_frames} frames  {el:.0f}s  ~{el / max(done, 1) * (n_frames - done):.0f}s left", flush=True)

    rep = asyncio.create_task(report())
    errs = await asyncio.gather(*[worker(i, list(c), segs[i], port, progress) for i, c in enumerate(chunks)])
    rep.cancel()
    print(f"rendered {n_frames} frames in {time.time() - t0:.0f}s")
    return segs, [e for es in errs for e in es]


def final_encode(src, out, tmp):
    common = ["-vf", "setsar=1,format=yuv420p", "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
              "-r", str(FPS), "-g", "120", "-keyint_min", "120", "-sc_threshold", "0", "-bf", "2", "-flags", "+cgop",
              "-preset", "slow", "-tune", "film", "-b:v", "16M", "-maxrate", "24M", "-bufsize", "24M",
              "-x264-params", "aq-mode=3:aq-strength=0.8", *TAGS, "-passlogfile", str(tmp / "x264pass")]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), *common, "-pass", "1", "-an", "-f", "mp4", os.devnull], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), *common, "-pass", "2", "-an",
                    "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
                    "-movflags", "+faststart", str(out)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="final_reel_1080x1920.mp4"); ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--tmp"); ap.add_argument("--port", type=int, default=8779); ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    plan = json.loads((serve.ROOT / "data/plan.js").read_text().split("=", 1)[1].rstrip(";\n"))
    n_frames = round(plan["total"] * FPS)
    tmp = Path(a.tmp) if a.tmp else Path(tempfile.mkdtemp(prefix="sdd_render_"))
    tmp.mkdir(parents=True, exist_ok=True)
    print(f"{n_frames} frames ({plan['total']} s @ {FPS} fps), {a.workers} workers, temp {tmp}")
    srv = serve.start(a.port)
    segs, errs = asyncio.run(render_all(n_frames, a.workers, tmp, a.port))
    srv.shutdown()
    if errs:
        print("page errors/warnings during render:", *errs, sep="\n  ")
        sys.exit(1)
    lst = tmp / "segs.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs))
    inter = tmp / "video_intermediate.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(inter)], check=True)
    t0 = time.time()
    final_encode(inter, Path(a.out), tmp)
    print(f"final 2-pass encode in {time.time() - t0:.0f}s -> {a.out}")
    if not a.keep:
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        print("kept temp files in", tmp)


if __name__ == "__main__":
    main()
