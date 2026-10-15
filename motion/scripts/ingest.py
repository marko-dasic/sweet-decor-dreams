#!/usr/bin/env python3
"""Normalize the owner's media into motion/media (originals are never touched).

Photos: EXIF transpose, ICC -> sRGB, long edge <= 3000 px (never upscale), JPEG q92, 400 px thumbs.
Videos: probe (size, fps, rotation, HDR transfer), 2 fps contact sheet, per-frame sharpness/motion profile.
Writes motion/data/ingest.json (id -> source info). Ids: p01.. for photos, v01.. for videos, in the
order listed in ID_ORDER (stable, human-chosen) and then alphabetically for anything new.

Usage: python3 motion/scripts/ingest.py            (from the working directory)
"""
import io, json, subprocess, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageOps

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:  # HEIC support is optional when there are no HEIC files
    pass

ROOT = Path.cwd()
MOTION = ROOT / "motion"
IMG_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}
VID_EXT = {".mp4", ".mov", ".m4v"}
SKIP_DIRS = {"motion", ".git"}

# Stable ids for this project's media (keeps plan.json valid if files are re-ingested).
ID_ORDER = {
    "f145b839-image.jpg": "p01", "f5064a15-image.jpg": "p02", "72d91865-image.jpg": "p03",
    "65a3d89b-image.jpg": "p04", "a38f1676-image.jpg": "p05",
    "b5f54cfc-0251e245-04d6-45db-b55d-37303c8ecfbe.mov": "v01",
    "4bb647cf-160104d7-ce1d-4cbb-a488-6bedd1c00e5a.mov": "v02",
    "6ea5c4f9-fef0badb-25e9-4015-bab4-41bec2de6476.mov": "v03",
    "e04cfa45-5e16ea8d-fd57-48f4-855a-bfe7bd334e34.mov": "v04",
}


def find_media():
    files = []
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file() or any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts):
            continue
        if p.name.lower().startswith("logo") or p.name.startswith("final_reel") or p.name in ("cover.jpg", "contact_sheet_selected.jpg"):
            continue
        ext = p.suffix.lower()
        if ext in IMG_EXT or ext in VID_EXT:
            files.append(p)
    return files


def to_srgb(im):
    icc = im.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            return ImageCms.profileToProfile(im.convert("RGB"), src, dst, outputMode="RGB")
        except Exception as e:  # broken profile: fall back to plain RGB and report it
            print("  ICC conversion failed:", e)
    return im.convert("RGB")


def ffprobe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def video_profile(path):
    """Laplacian-variance sharpness and mean abs frame difference per frame (at 240 px width, 60 fps)."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    sharp, diff, prev = [], [], None
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(cv2.resize(fr, (240, int(240 * fr.shape[0] / fr.shape[1]))), cv2.COLOR_BGR2GRAY)
        sharp.append(float(cv2.Laplacian(g, cv2.CV_64F).var()))
        diff.append(0.0 if prev is None else float(np.abs(g.astype(np.int16) - prev).mean()))
        prev = g.astype(np.int16)
    return sharp, diff


def main():
    (MOTION / "media/img").mkdir(parents=True, exist_ok=True)
    (MOTION / "thumbs").mkdir(parents=True, exist_ok=True)
    (MOTION / "sheets").mkdir(parents=True, exist_ok=True)
    (MOTION / "data").mkdir(parents=True, exist_ok=True)
    media = find_media()
    used = set(ID_ORDER.values())
    np_, nv = 1, 1
    out = {}
    for p in media:
        is_img = p.suffix.lower() in IMG_EXT
        mid = ID_ORDER.get(p.name)
        if not mid:
            while True:
                mid = ("p%02d" % np_) if is_img else ("v%02d" % nv)
                if is_img: np_ += 1
                else: nv += 1
                if mid not in used: break
            used.add(mid)
        rel = str(p.relative_to(ROOT))
        if is_img:
            im = Image.open(p)
            exif_orient = im.getexif().get(274)
            im = ImageOps.exif_transpose(im)
            im = to_srgb(im)
            w, h = im.size
            s = min(1.0, 3000 / max(w, h))
            if s < 1:
                im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
            im.save(MOTION / f"media/img/{mid}.jpg", quality=92, subsampling=0)
            th = im.copy(); th.thumbnail((400, 400), Image.LANCZOS)
            th.save(MOTION / f"thumbs/{mid}.jpg", quality=88)
            out[mid] = {"id": mid, "src": rel, "type": "photo", "w": im.width, "h": im.height,
                        "orig_w": w, "orig_h": h, "exif_orientation": exif_orient,
                        "icc": bool(Image.open(p).info.get("icc_profile"))}
            print(f"{mid}  photo {w}x{h} -> {im.width}x{im.height}  {rel}")
        else:
            info = ffprobe(p)
            vs = next(s for s in info["streams"] if s["codec_type"] == "video")
            rot = 0
            for sd in vs.get("side_data_list", []):
                if "rotation" in sd: rot = int(sd["rotation"])
            num, den = map(int, vs["r_frame_rate"].split("/"))
            hdr = vs.get("color_transfer") in ("arib-std-b67", "smpte2084")
            dur = float(info["format"]["duration"])
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf",
                            "fps=2,scale=240:-1,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,tile=7x3",
                            "-frames:v", "1", str(MOTION / f"sheets/{mid}.jpg")], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(min(1.0, dur / 2)), "-i", str(p), "-frames:v", "1",
                            "-vf", "scale=400:400:force_original_aspect_ratio=decrease", str(MOTION / f"thumbs/{mid}.jpg")], check=True)
            sharp, diff = video_profile(p)
            out[mid] = {"id": mid, "src": rel, "type": "video", "w": vs["width"], "h": vs["height"],
                        "fps": round(num / den, 3), "duration": round(dur, 3), "rotation": rot,
                        "transfer": vs.get("color_transfer"), "hdr": hdr, "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
                        "sharpness_per_frame": [round(x, 1) for x in sharp], "motion_per_frame": [round(x, 2) for x in diff]}
            print(f"{mid}  video {vs['width']}x{vs['height']} {num}/{den} fps {dur:.2f}s rot={rot} hdr={hdr}  {rel}")
    (MOTION / "data/ingest.json").write_text(json.dumps(out, indent=1))
    print("wrote motion/data/ingest.json with", len(out), "assets")


if __name__ == "__main__":
    sys.exit(main())
