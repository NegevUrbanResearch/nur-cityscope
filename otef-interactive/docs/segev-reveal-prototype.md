# Segev Reveal.js vertical slice: findings and update procedure

Status: findings retained from an eight-slide prototype verified in a browser
on 24 September 2026. The standalone page and its demo-only code were removed
during the clean rebuild. It was never connected to the GIS, projection, or
remote, and its Vite URL was not a production nginx route. The revised 34-slide
mapping is now approved in the presentation design and run of show; this
document retains findings from the eight-slide prototype only.

## What the test established

- The visual source must be the PowerPoint Online PDF export. The original
  headless Impress render ran under `CodexSandboxOffline`, which did not see the
  per-user fonts, and its Segev title was wrong. The PDF exported online shows
  the intended serif title. Poppler rasterization of that PDF uses no
  LibreOffice process or printer.
- The latest PDF has 34 pages. The latest PPTX has 34 slides and five embedded
  MP4 files. The old manifest still describes a 33-slide PPTX and must not be
  silently promoted to the latest version.
- The PDF contains static slide visuals, including a black placeholder on
  video slides. Playable videos must be extracted separately from the PPTX.
- In the tested PPTX, video relationships map slides 2, 10, 18, 23, and 24 to
  five MP4 files. `segev_video_extract.py` follows slide 2's relationship
  rather than assuming a `media1.mp4` filename in future PPTX revisions.
- The slide 2 video is a 166,919,463-byte, 64.8-second H.264 High 1920×1080
  25 fps MP4 with AAC LC 48 kHz stereo audio. Chromium loaded it with
  `readyState=4`, 1920×1080 dimensions, `muted=false`, and advancing playback
  time. The user also tested the visible prototype successfully.
- In the prototype's browser configuration, playback began only after a click.
  Production behavior is defined by the current presentation design: exhibit
  Chrome permits unmuted autoplay, which is verified using only the remote and
  the exhibit speakers. The video pauses and rewinds when leaving slide 2 or
  closing the deck.
- Reveal is configured for a 2001×1125 16:9 canvas. The slide image uses
  99% width and height with `object-fit: contain`. The slide 2 video covers the
  PDF's black region at left 16%, top 28.9%, width 68%, height 68.2%.
  Recheck those measurements if NLI changes that slide's layout.
- The prototype clamps navigation to slides 1–8 and resets to slide 1 when
  reopened. These eight pages are hard-coded for the test, not a final
  narrative mapping.

## Updating the local test assets

Both source files and generated media under `public/processed/` are ignored by
Git. Keep PDF and PPTX revisions paired and record their hashes when updating;
replacing the PDF alone does not refresh video. The source files used for this
test had these SHA-256 values:

```text
PDF:  1ce060dd9bb53d155c95f70f95b86e9ae36d013d3b4535fbb27c5fa8e4054b8c
PPTX: 6ed3d98badcaf8d48dc17334a599783349e008dfd04ea1c59e4b420e33a86837
```

Place the PDF at `public/processed/presentations/nli/nur-model.pdf` and run,
from `otef-interactive`:

```powershell
python scripts/segev_web_export.py
```

That script checks for a PDF, calls only Poppler `pdftoppm` at 150 DPI, and
requires exactly eight PNG outputs at
`public/processed/presentations/nli/segev-web/slide-01.png` through
`slide-08.png`. If Poppler is not on `PATH`, pass `--pdftoppm` with its path.

Extract the real slide 2 video from the matching PPTX:

```powershell
python scripts/segev_video_extract.py --source 'C:\path\to\latest-nli-deck.pptx'
```

The extractor writes
`public/processed/presentations/nli/segev-web/segev-slide-02.mp4`. It never
invokes LibreOffice. The old synthetic `sample-video.webm` is not used.

## Integration notes for the forthcoming viewer

The retired prototype relied on Vite to bundle the `reveal.js` import and to
rewrite `/otef-interactive/public/` asset URLs during development. The normal
nginx app could not serve that source page as a working production viewer.
Production routing, the presentation overlay, remote controls, and approved
segment ranges belong in the forthcoming Reveal.js spec. The retained
renderer-neutral open/next/previous/close command transport and manifest
segment IDs can be used there. Confirm audible sound on the actual exhibit
output device: browser state and file metadata do not prove that speakers are
connected or set to the right volume.

Focused checks:

```powershell
python -m unittest scripts.tests.test_segev_web_export scripts.tests.test_segev_video_extract
npm run build:frontend
```
