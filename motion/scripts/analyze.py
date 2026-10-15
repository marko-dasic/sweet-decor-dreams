#!/usr/bin/env python3
"""Measurable part of curation: sharpness, exposure, near-duplicates, palette, saliency, face hints.

Reads motion/data/ingest.json, writes motion/data/metrics.json and motion/sheets/grid_<id>.jpg
(a 1000 px version with a 10 % grid and source-pixel labels, used to read focal boxes by eye).
The human review (quality, roles, focal boxes, privacy) lives in motion/data/catalog.json.
"""
import json
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image, ImageDraw
from sklearn.cluster import KMeans

M = Path.cwd() / "motion"
ING = json.loads((M / "data/ingest.json").read_text())


def frame_of(a):
    if a["type"] == "photo":
        return Image.open(M / f"media/img/{a['id']}.jpg").convert("RGB")
    # middle frame of the clip at native size
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(a["duration"] / 2), "-i", a["src"], "-frames:v", "1", f.name], check=True)
        return Image.open(f.name).convert("RGB").copy()


def palette(im, k=5):
    small = np.asarray(im.resize((120, int(120 * im.height / im.width))))
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    km = KMeans(n_clusters=k, n_init=4, random_state=1).fit(lab)
    counts = np.bincount(km.labels_, minlength=k)
    cols = cv2.cvtColor(km.cluster_centers_.astype(np.uint8)[None], cv2.COLOR_LAB2RGB)[0]
    order = np.argsort(-counts)
    return [{"hex": "#%02x%02x%02x" % tuple(int(c) for c in cols[i]), "share": round(float(counts[i] / counts.sum()), 3)} for i in order]


def saliency_box(im):
    g = np.asarray(im.resize((256, int(256 * im.height / im.width))))
    sal = cv2.saliency.StaticSaliencySpectralResidual_create() if hasattr(cv2, "saliency") else None
    if sal is None:
        return None
    ok, m = sal.computeSaliency(g)
    m = (m * 255).astype(np.uint8)
    _, th = cv2.threshold(m, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ys, xs = np.nonzero(th)
    if len(xs) == 0:
        return None
    sx, sy = im.width / g.shape[1], im.height / g.shape[0]
    x0, x1 = np.percentile(xs, [5, 95]); y0, y1 = np.percentile(ys, [5, 95])
    return [int(x0 * sx), int(y0 * sy), int((x1 - x0) * sx), int((y1 - y0) * sy)]


def faces(im):
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    prof = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    s = 1000 / max(im.size)
    g = cv2.cvtColor(np.asarray(im.resize((int(im.width * s), int(im.height * s)))), cv2.COLOR_RGB2GRAY)
    found = []
    for c in (casc, prof):
        for (x, y, w, h) in c.detectMultiScale(g, 1.1, 6, minSize=(30, 30)):
            found.append([int(x / s), int(y / s), int(w / s), int(h / s)])
    return found


def grid(im, mid):
    s = 1000 / im.height
    g = im.resize((int(im.width * s), 1000)).convert("RGB")
    d = ImageDraw.Draw(g)
    for i in range(1, 10):
        x = g.width * i / 10; y = g.height * i / 10
        d.line([(x, 0), (x, g.height)], fill=(255, 0, 0), width=1)
        d.line([(0, y), (g.width, y)], fill=(255, 0, 0), width=1)
        d.text((x + 2, 2), str(int(im.width * i / 10)), fill=(255, 255, 0))
        d.text((2, y + 2), str(int(im.height * i / 10)), fill=(255, 255, 0))
    g.save(M / f"sheets/grid_{mid}.jpg", quality=88)


def main():
    out = {}
    hashes = {}
    for mid, a in sorted(ING.items()):
        im = frame_of(a)
        s = 1000 / max(im.size)
        g = cv2.cvtColor(np.asarray(im.resize((int(im.width * s), int(im.height * s)))), cv2.COLOR_RGB2GRAY)
        lum = np.asarray(im.convert("L"), dtype=np.float32)
        r = {
            "sharpness": round(float(cv2.Laplacian(g, cv2.CV_64F).var()), 1),
            "mean_luma": round(float(lum.mean()), 1),
            "clipped_pct": round(float((lum > 250).mean() * 100), 2),
            "crushed_pct": round(float((lum < 8).mean() * 100), 2),
            "palette": palette(im),
            "saliency_box": saliency_box(im),
            "faces": faces(im),
        }
        if a["type"] == "video":
            sp = a["sharpness_per_frame"]
            r["video_sharpness_median"] = round(float(np.median(sp)), 1)
            r["video_motion_median"] = round(float(np.median(a["motion_per_frame"])), 2)
        hashes[mid] = imagehash.phash(im)
        grid(im, mid)
        out[mid] = r
        print(mid, {k: v for k, v in r.items() if k not in ("palette",)}, [p["hex"] for p in r["palette"]])
    dupes = []
    ids = sorted(hashes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            d = hashes[a] - hashes[b]
            if d <= 8:
                dupes.append([a, b, int(d)])
    print("near-duplicates (phash <= 8):", dupes)
    (M / "data/metrics.json").write_text(json.dumps({"assets": out, "near_duplicates": dupes,
                                                     "phash_matrix": {a: {b: int(hashes[a] - hashes[b]) for b in ids} for a in ids}}, indent=1))


if __name__ == "__main__":
    main()
