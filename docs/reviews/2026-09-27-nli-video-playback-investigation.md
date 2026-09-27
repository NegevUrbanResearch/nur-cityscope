# NLI video playback investigation — 27 September 2026

## Finding

The reproduced trigger is sustained writes to the **visible left browser-projection canvas**, at approximately 50 final draw calls per second, while Shura or Mor plays in GIS. The same video recovers when that output is held, hidden, or limited to a measured 30 final draw calls per second, and stalls again when unrestricted output resumes.

Counters measure JavaScript/WebGL call rates, not frames confirmed presented by Chrome or the monitor. Hidden-canvas tests do not establish that downstream GPU/compositor execution remains identical.

This identifies the application-side trigger. It does **not** establish the internal Chromium, D3D, or NVIDIA defect. The rate limit is a tested mitigation, not a permanent fix adopted by this investigation.

## Why Segev and Sderot differ in this reproduction

Both projection outputs settle to **zero map, texture-upload, composition, and final-output calls per second** in Segev and Sderot. Shura and Mor keep their projection rendering active. Thus the narratives do not impose the same display activity even though they use the same presentation viewer.

## Controlled comparisons

Unless noted, tests changed one diagnostic control during an existing stalled video, without changing its scene, restarting playback, or navigating GIS. The right output and underlying map rendering stayed active during left-only tests.

| Change | Result |
| --- | --- |
| Return projection layer membership to Home | Same stalled video resumes; restoring Shura membership stalls it again. |
| Reload outputs into windowed state | Videos play. This earlier result was confounded by fullscreen/viewport changes and is not evidence that a reload fixes the fault. |
| Restore normal full-display setup | Fresh Shura video stalls near 3.25 seconds. |
| Pause both projection compositors | Video resumes while the source maps continue rendering. |
| Pause right compositor only | Video remains stalled. |
| Pause left compositor only | Video resumes; restoring that compositor stalls it again. |
| Hold map texture uploads on both outputs | Video remains stalled despite zero map uploads and ongoing composition. |
| Hold left offscreen composition, keep final output live | Video remains stalled. |
| Hold only left final output | Video resumes with map rendering, uploads and offscreen composition still active. |
| Replace left final warp draw with changing gray clears | Video remains stalled. Warp shader and mesh complexity are not required. |
| Inset left output by one CSS pixel | No recovery. Backing canvas and map dimensions were unchanged. |
| Set left output opacity to 99% | No recovery. |
| Hide only left output canvas | Video resumes while map, uploads, composition and final GL calls continue at about 60/s. Showing it again stalls playback. |
| Limit left final output to measured 30/s | Shura and Mor recover while output remains visible and animated. |

Representative same-player crossovers:

- Shura: unrestricted output stalls at **3.228 s**; compositor pause advances to **8.805 s**; restoring composition stalls at **12.207 s**.
- Shura: hidden output advances from **2.926 s** to **17.626 s**; showing it again stalls at **21.049 s**. The instrumented GL draw calls continued while hidden; downstream GPU execution was not measured.
- Shura: measured 30/s final-output cap advances from **3.219 s** to **17.300 s** with `readyState=4`.
- Mor: at measured 30/s it reaches **20.747 s**; unrestricted output stalls at **29.458 s** across two reads; restoring 30/s lets it finish at **46.240 s**.

The first temporary limiter targeted 25/s but actually delivered about 20/s because of callback quantization. It was replaced with a phase-preserving deadline; the later 30/s result is measured, not inferred from a setting. One diagnostic HUD suffix still read “25fps”; its actual final-call counter read 30/s.

## Hardware and media checks

- Left Optoma: Windows DISPLAY2, position (-1024, -1175), 1920×1080 at 50 Hz.
- Right Optoma: Windows DISPLAY3, position (896, -1080), 1920×1080 at 50 Hz.
- ViewSonic and NEC displays: 1920×1080 at 60 Hz.
- All four active display paths use NVIDIA adapter LUID **0:92709**, matching the supplied `D3D11VideoDecoder` log. A cross-adapter Intel/NVIDIA handoff is not supported by this topology.
- Chrome reports video `DECODER_UNDERFLOW` while audio has buffered data. This explains the observed stalled media pipeline, but not its internal cause.
- Original media decode checks and HTTP range checks passed in the earlier investigation. No originals were modified. Segev, Mor and Sderot are 25 fps; Shura's first video is approximately 23.98 fps. Media frame rate alone does not distinguish working and failing narratives.
- The calibration UI reports fullscreen output launch success. Browser automation's document-fullscreen field was not reliable enough to use alone; viewport sizes and actual launch status were also recorded. Some observed projection viewports were 1920×1024 on 1920×1080 displays.

## Recommended next change

Follow-up: the approved playback-only scheduler is now implemented. See [implementation and laboratory acceptance](2026-09-27-nli-video-playback-acceptance.md) and the [projector-change checklist](../../otef-interactive/docs/nli-video-playback-commissioning.md). The comparisons below describe the investigation before that implementation.

Use a small, reviewed browser-projection draw scheduler with a verified maximum of 30 browser-output draw calls per second. Coalesce repeated draw requests, sample the latest scene, and schedule a trailing draw so the last update is never lost. Initial readiness and calibration completion must still draw immediately. Cancel pending work on disposal/context loss and redraw after restoration.

Keep shared timeline clocks, scene definitions, map state, media files, presentation loading and calibration unchanged. Apply scheduling consistently to the browser-output route rather than hard-coding a particular projector identity.

Before adoption, test scheduler lifecycle and final-state delivery, then verify complete Shura and Mor playback and projection animation/transition quality in the actual display setup. This remains a compatibility mitigation unless further graphics tracing establishes the underlying platform defect.

## Review and cleanup

Luna implemented the temporary diagnostic controls. Sol reviewed the isolation tests and interpreted the results independently. The parent agent performed the live browser comparisons.

Temporary instrumentation has been removed from application source; the four affected files match their original revisions and pass syntax checks. Its patch and detailed chronological notes are retained in `.superpowers/sdd/nli-runtime-followup/`. Existing remote spacing, archive-status and presentation-status fixes are separate and retained.
