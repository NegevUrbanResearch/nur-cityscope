# NLI presentation image preparation

The GIS presentation uses 34 approved PDF slides, three added video slides,
and the separate מאגר הזהויות screen. All slide PNGs and the shared background
are 3840 × 2160. Reveal's 960 × 540 layout coordinates preserve the original
composition; GIS scales this layout to the display. Videos retain their original
resolution, rectangles and playback behavior. The six audible clips use separate
copies in `public/local/presentations/nli/normalized-audio/`, targeting -20 LUFS
integrated loudness with encoded true peaks at or below -2 dBTP. Original video
streams are copied without re-encoding; original media files and the three silent
clips are preserved. `normalization-report.json` in that directory records source
and output hashes, measured levels and verification results.

Use the October 6 PDF and PPTX whose SHA-256 values are pinned in
`scripts/nli_presentation_assets.py` and the runtime manifest. A PDF-only export
retains sharp text, but several photos are downsampled. The photo restoration
option uses larger RGB JPEG originals from the same PPTX slide only when their
aspect ratio and pixels identify a unique match. It substitutes image resources
in a temporary PDF and verifies that page content and dimensions are unchanged.
It never prints, uses a printer driver, or changes the source PDF/PPTX.

The three supplemental videos credit רשות העתיקות beside the video, using
right-aligned Narkiss Block text with the organization in bold. Be'eri (runtime
slide 9) credits צילם ברק ברינקר and has October 17, 2023 in its title. Nova
(slide 13) credits the organization alone and retains October 10, 2023. Re'im
(slide 31) credits צילם יוסי סודרי and has February 1, 2024 in its title.
These titles and credits are live text in the same 960 × 540 Reveal layout,
scaling with the 3840 × 2160 slide background at 4K.

## Rebuild

Requires Poppler's `pdfinfo` and `pdftoppm`; the photo restoration option also
requires Python packages `pypdf` and `Pillow`. From `otef-interactive`, use the
approved source files (pass `--pdf` and `--pptx` when they are in Downloads):

```powershell
python scripts/nli_presentation_assets.py --restore-pptx-photos --manifest public/presentation/nli-presentation-manifest.json
```

The default source directory is `public/local/presentations/nli/source`.
`--pdfinfo` and `--pdftoppm` can specify executable paths. Use `--output` for a
staged review directory and omit `--manifest` until publishing that directory.
Do not omit `--restore-pptx-photos` when rebuilding this release: a PDF-only
rebuild cannot retain the restored original photo detail.

The script validates both sources, renders and checks all 34 PNG dimensions,
extracts the original six PPTX videos, and publishes only after staging completes.
With photo restoration enabled it also renders the shared background for the
three supplemental video slides and מאגר הזהויות. Publication rolls back on
failure. Existing supplemental videos are preserved. The local
`photo-restoration.json` lists replacements, and `asset-version.txt` identifies
the rendered PNG bytes. `--manifest` updates `deck.assetVersion` so cached images
from the previous release are bypassed. Segment order and video definitions do
not change.

These licensed assets remain gitignored. Moving code/manifest changes to another
workstation also requires copying the prepared local assets, including all six
normalized MP4s, or rebuilding and normalizing them there. The image rebuild does
not regenerate normalized audio copies. Reload GIS and then refresh the staff
remote before starting a presentation with the new assets. Verify all nine videos
and the names screen on the exhibit hardware. Browser projector output resolution is selected separately in the
calibration Displays menu.
