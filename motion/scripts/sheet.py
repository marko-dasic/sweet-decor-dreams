#!/usr/bin/env python3
"""Combine stills into a labeled contact sheet.  Usage: sheet.py INDIR OUT.jpg [--cols 6] [--w 270]"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("indir"); ap.add_argument("out"); ap.add_argument("--cols", type=int, default=6); ap.add_argument("--w", type=int, default=270)
a = ap.parse_args()
files = sorted(Path(a.indir).glob("*.jpg"))
w = a.w; h = int(w * 16 / 9); lab = 26
rows = (len(files) + a.cols - 1) // a.cols
sheet = Image.new("RGB", (a.cols * (w + 6) + 6, rows * (h + lab + 6) + 6), (30, 30, 30))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except OSError:
    font = ImageFont.load_default()
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((w, h), Image.LANCZOS)
    x = 6 + (i % a.cols) * (w + 6); y = 6 + (i // a.cols) * (h + lab + 6)
    sheet.paste(im, (x, y + lab))
    d.text((x + 4, y + 3), f.stem.lstrip("t").lstrip("0") or "0", fill=(255, 230, 120), font=font)
sheet.save(a.out, quality=88)
print(a.out, sheet.size)
