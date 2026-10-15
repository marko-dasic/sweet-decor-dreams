# Sweet Decor Dreams: reel engine

A silent, 9:16 Instagram Reel (1080×1920, 60 fps, H.264) built from the owner's own photos and clips with a
deterministic HTML engine, Playwright (headless Chromium) and ffmpeg. No Remotion, no generated imagery,
no text except the end card.

Current edit: `iskra_damir_stitch`, 17.0 s, 34 beats on a 120 BPM grid (1 beat = 0.5 s).

## Requirements

- ffmpeg / ffprobe (with libx264)
- Python 3 with `playwright pillow numpy opencv-contrib-python-headless<5 imagehash scikit-learn fonttools`
  (`pillow-heif` for HEIC sources)
- Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH` or `python3 -m playwright install chromium` on a new machine)

## Re-render from scratch

Run everything from the repository root (the working directory that holds `originals/`):

```bash
python3 motion/scripts/ingest.py        # originals -> motion/media/img, thumbs, video probes (data/ingest.json)
python3 motion/scripts/analyze.py       # sharpness, exposure, duplicates, palette, face hints (data/metrics.json)
python3 motion/scripts/plan_build.py    # data/plan.json -> data/plan.js, extracts the clip windows as frames
python3 motion/scripts/safescan.py      # error scan + safe-zone scan + resolution scan (must report 0 / 0)
python3 motion/scripts/render.py        # 4 Chromium workers -> CRF 10 intermediate -> 2-pass final
```

`render.py` writes `final_reel_1080x1920.mp4` (about 4–5 minutes on 4 cores). Temp files go to the system temp
folder and are deleted afterwards (`--keep` keeps them, `--tmp DIR` chooses the folder).

Clip frames in `media/clips/` are not committed (about 46 MB); `plan_build.py` recreates them from `originals/`.

## Preview and QA

```bash
python3 motion/scripts/serve.py                     # open http://127.0.0.1:8777/index.html?guides=1, then
                                                    # call renderFrame(3.2) in the console
python3 motion/scripts/snap.py OUT 0 1.4 9.0        # stills with safe-zone guides (add --noguides --dsf 1)
python3 motion/scripts/snap.py OUT --every 0.5      # stills across the timeline
python3 motion/scripts/sheet.py OUT sheet.jpg       # labelled contact sheet of a folder of stills
```

Guides (`?guides=1`): red = unsafe margins (top 192 px, bottom 384 px, sides 54 px), blue dashed = Instagram's
like/comment/share column, green dashed = the 3:4 profile-grid crop, cross = safe-area centre (540, 864).

## How to change the edit

Everything lives in `data/plan.json`; the engine code does not need to change.

- **Swap a shot:** change `asset` and `src` (photos: `media/img/<id>.jpg`, with that image's `w`/`h`), then set
  its crop `keys`. Ids are listed in `data/catalog.json` (p01–p05 photos, v01–v04 videos).
- **Crop and camera move:** `keys` is a list of `[t, x, y, w, ease]`: at `t` seconds after the shot starts, show
  the 9:16 window whose top-left corner is (`x`, `y`) and width is `w` in source pixels (height = w × 16/9).
  The engine interpolates between keys (push, pull, pan). Smaller `w` = tighter crop; keep `1080 / w` at or below
  about 1.15 for sharp photos.
- **Length:** `beats` per shot (1 beat = 0.5 s). Cuts always land on the beat grid.
- **Transitions:** `in` = `cut`, `zoom_through`, `light_leak`, `arch_reveal` or `soft_dissolve`; `punch: true`
  adds a small on-beat zoom accent after a cut.
- **Video:** `clipIn` (source second where the shot starts), `speed` (1.0 or 2.0 keep the 60 fps cadence even),
  `vf` (ffmpeg colour correction applied at extraction). Run `plan_build.py` after changing any of these.
- **Safe zone:** `focal` (and optional `focal_end`) / `must_keep` boxes in source pixels; `safescan.py` checks
  that they stay inside the safe area outside transitions.
- **Grade:** `grade` (global or per shot) is a CSS filter chain; keep it light so the decor keeps its real colours.
- **End card text:** `js/endcard.js` (`TEXT`). Brand colours are the CSS tokens in `css/style.css`.

After any change: `plan_build.py` → `safescan.py` → `snap.py` (look at the stills) → `render.py`.

## Files

```
index.html            stage 1080x1920 and layer stack
css/style.css         fonts (Cormorant Garamond + Inter, latin + latin-ext for č ć š ž đ), tokens, end card
js/engine.js          time, easing, springs, noise, crop windows, scenes, grain, flashes, renderFrame(t)
js/fx.js              bokeh, sparkles, light leaks, arch shape
js/transitions.js     cut, zoom_through, light_leak, arch_reveal, soft_dissolve
js/shots.js           photo / clip shots generated from the plan
js/endcard.js         wordmark, gold line, Instagram handle, CTA
data/plan.json        the edit (source of truth); plan.js is generated
data/catalog.json     visual review of every asset (quality, role, focal boxes, privacy, use / reason)
data/ingest.json, metrics.json   measured data
assets/               fonts and the Instagram glyph (Simple Icons)
scripts/              ingest, analyze, plan_build, serve, snap, sheet, safescan, render
```
