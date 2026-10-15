#!/usr/bin/env python3
"""plan.json -> data/plan.js (window.PLAN) with derived timing, and extract the clip windows as frames.

For every shot it adds t0/t1 (nominal cut points, seconds), tin/tout (transition durations) and the
visible range [vis0, vis1] including transition overlaps. For video shots it extracts exactly the source
range that is visible (+2 frames margin) as 60 fps JPEGs, upscaled with Lanczos to 1152x2048, into
media/clips/<id>/0001.jpg..., and records clip.start (source seconds of frame 1) and clip.frames.

Usage: python3 motion/scripts/plan_build.py [--force]   (--force re-extracts clip frames)
"""
import json, shutil, subprocess, sys
from pathlib import Path

M = Path.cwd() / "motion"
ING = json.loads((M / "data/ingest.json").read_text())
TRANS = {"cut": 0.0, "zoom_through": 0.4, "light_leak": 0.6, "arch_reveal": 0.7, "soft_dissolve": 0.5, "whip": 0.3}
CLIP_W, CLIP_H, FPS = 1152, 2048, 60
# Clips are upscaled from 478x850: Lanczos + a light unsharp mask, no generative detail.
# BT.709 limited-range video -> RGB (per-shot colour correction runs here) -> full-range BT.601 JPEG,
# which is what the browser assumes when it decodes a JPEG.
CLIP_PRE = f"fps={FPS},scale=in_color_matrix=bt709:in_range=tv,format=gbrp"
CLIP_POST = f"scale={CLIP_W}:{CLIP_H}:flags=lanczos:out_color_matrix=bt601:out_range=pc,format=yuvj420p,unsharp=5:5:0.45:5:5:0.0"


def main():
    force = "--force" in sys.argv
    plan = json.loads((M / "data/plan.json").read_text())
    beat = plan["beat"]
    t = 0.0
    shots = plan["shots"]
    for i, sh in enumerate(shots):
        sh["t0"] = round(t, 6)
        t += sh["beats"] * beat
        sh["t1"] = round(t, 6)
        sh["tin"] = TRANS[sh.get("in", "cut")] if i > 0 else 0.0
        nxt = shots[i + 1] if i + 1 < len(shots) else None
        sh["tout"] = TRANS[nxt.get("in", "cut")] if nxt else 0.0
        sh["vis0"] = round(sh["t0"] - sh["tin"] / 2, 6)
        sh["vis1"] = round(sh["t1"] + sh["tout"] / 2, 6)
    plan["totalBeats"] = sum(s["beats"] for s in shots)
    plan["total"] = plan["totalBeats"] * beat
    plan["transitions"] = TRANS

    for sh in shots:
        if sh["type"] != "video":
            continue
        a = ING[sh["asset"]]
        sp = sh.get("speed", 1.0)
        start = max(0.0, sh["clipIn"] + (sh["vis0"] - sh["t0"]) * sp - 2 / FPS)
        end = min(a["duration"] - 1 / FPS, sh["clipIn"] + (sh["vis1"] - sh["t0"]) * sp + 2 / FPS)
        d = M / "media/clips" / sh["asset"]
        meta = d / "meta.json"
        vf = CLIP_PRE + ("," + sh["vf"] if sh.get("vf") else "") + "," + CLIP_POST
        want = {"src": a["src"], "start": round(start, 4), "end": round(end, 4), "vf": vf}
        if force or not meta.exists() or json.loads(meta.read_text()).get("want") != want:
            shutil.rmtree(d, ignore_errors=True); d.mkdir(parents=True)
            cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.4f}", "-i", a["src"], "-t", f"{end - start:.4f}",
                   "-an", "-vf", vf, "-q:v", "2", str(d / "%04d.jpg")]
            if a.get("hdr"):  # HDR -> SDR tone map before scaling (not needed for this project's clips)
                cmd[cmd.index("-vf") + 1] = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,"
                                             "zscale=t=bt709:m=bt709:r=tv,format=yuv420p," + vf)
            subprocess.run(cmd, check=True)
            n = len(list(d.glob("*.jpg")))
            meta.write_text(json.dumps({"want": want, "frames": n}))
            print(f"{sh['id']} {sh['asset']}: extracted {n} frames  {start:.3f}-{end:.3f}s")
        n = json.loads(meta.read_text())["frames"]
        sh["clip"] = {"id": sh["asset"], "fps": FPS, "frames": n, "start": round(start, 4)}
        sh["nativeW"] = a["w"]
        sh["src"] = f"media/clips/{sh['asset']}/0001.jpg"

    (M / "data/plan.js").write_text("window.PLAN = " + json.dumps(plan, indent=1) + ";\n")
    print(f"plan.js: {len(shots)} shots, {plan['totalBeats']} beats = {plan['total']:.2f} s")
    for s in shots:
        print(f"  {s['id']:>4} {s.get('asset', '-'):>4} beats={s['beats']} {s['t0']:6.2f}-{s['t1']:6.2f}  in={s.get('in', 'cut')}")


if __name__ == "__main__":
    main()
