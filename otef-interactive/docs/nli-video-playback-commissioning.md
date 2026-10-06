# NLI video playback: projector change and opening-day check

This check is for the technician after moving the exhibit PC or changing displays. It does not require changing narrative definitions, video files, or calibration to enable video protection.

## Launch consistently

1. Use the normal local launcher: `http://localhost/otef-interactive/launcher.html`. Keep GIS in its dedicated OTEF Chrome profile for archive control. Projector windows can use another Chrome profile connected to the same local backend and table.
2. Open GIS and projection calibration from that launcher. On the PC, keep both on **the same scheme, host and port**: `http://localhost`. A hostname or LAN IP is a different origin. The phone/tablet remote can use its normal network address.
3. In projection calibration, identify the physical displays and update the left/right display assignments for the new projectors. Do not copy the laboratory's display numbers or coordinates. Save the assignments, then use **Open Both** and confirm both outputs are fullscreen on the intended displays.
4. Follow the existing TouchDesigner/browser-output handoff instructions. Avoid leaving duplicate output windows running. Keep GIS visible on its intended display.
5. Confirm the existing Chrome autoplay/popup policy status using the setup procedure in [NLI exhibit verification](nli-exhibit-verification.md). Moving this same PC does not itself require reinstalling those policies.
6. Avoid restarting GIS during a presentation or Home transition. If GIS is restarted and the remote reports a presentation failure, use **Open presentation again** or **Return Home**. These recovery controls discard the failed session; ordinary Close still requires acknowledgment from the viewer that opened it.

For NLI's 4K projectors, select **4K · 3840 × 2160** for both outputs in calibration's **Displays** menu before opening them. Use **1080p · 1920 × 1080** on laboratory workstations. Confirm Windows' active signal resolution, both fullscreen outputs, scene framing and text readability, and repeat all nine video checks with GIS and both outputs running together. Retain 1080p as the fallback if 4K performance is insufficient. See [browser projector operation](browser-projector-warp-operations.md) for resolution selection and unchanged calibration units.

Playback activity uses same-profile BroadcastChannel and an ephemeral relay through the existing local WebSocket backend. The relay reaches separate Chrome profiles on the same table. No database state or external service is involved. Heartbeats and the six-second lease handle source disappearance; a reconnect queries the publisher's current state.

Check Windows' active refresh rate for every display as well as its resolution. The October 6 exhibit check found GIS at 4K 30 Hz and the projectors at 4K 60 Hz; GIS was then set to its supported 4K 60 Hz. Matching rates does not replace the playback-only 20/s projection limit or certify graphics-driver behavior.

## What should happen

- Each presentation video activates a maximum of 20 ordinary browser-projection draw calls per second on both browser outputs. The video, narrative clocks and animation duration do not slow down. Projection motion has fewer visual updates during videos; its normal cadence returns afterward.
- Startup and buffering retain protection. Pause, video end, leaving its slide, closing the presentation and leaving its scene restore normal output cadence.
- An output opened during playback learns the current state. A closed/crashed GIS source stops retaining the limit after the short stale-source timeout (approximately six seconds).
- Static image slides and other scenes retain their normal projection cadence. The presenter has no additional controls to operate.
- Only the selected video loads. Leaving its slide removes its source and resets the media element, releasing the previous resource without seeking back through an active decoder. Returning to it loads the original file from the beginning. Open and slide changes each have a 4.5-second local readiness deadline; the remote retains a six-second command deadline and aborts unsettled HTTP requests.

## Nine-video acceptance — do this before opening day

Use the staff remote and the actual fullscreen displays. Let **each** video finish. Confirm picture advances continuously, audio is audible from the exhibit speakers, controls remain available, and no idle timeline flashes or unexpected layer changes occur.

| Narrative | Video slide | Approximate duration | NLI onsite result |
|---|---:|---:|---|
| Segev | 2 | 65 s | pending |
| Segev, Gelem | 9 | 10 s | pending |
| Nova / Mor Levi | 11 | 46 s | pending |
| Nova memorial | 13 | 13 s | pending |
| Sderot, testimony | 20 | 78 s | pending |
| Sderot, Yad Ben Zvi | 23 | 18 s | pending |
| Shura, first video | 25 | 40 s | pending |
| Shura, second video | 26 | 16 s | pending |
| Shura, Re'im | 31 | 11 s | pending |

Slide numbers are positions in the 37-slide runtime deck. Confirm the critical Shura transition from slide 26 to the photo on slide 27, then Previous back to the video and Next to the photo again.

Then replay Shura or Mor and check:

1. Leave the scene while the video is playing. Sound stops; Home restores its original appearance and normal animation cadence.
2. Open the video again, then reopen the projection outputs through calibration. Playback protection should be restored automatically in the new outputs.
3. Close and reopen the presentation. Play again. Confirm neither controls nor protection remain stuck from the previous session.

Record Chrome version, GPU driver version, projector models, resolution/refresh rates, date and operator alongside the results. Laboratory results cannot certify a different display topology.

## Technician diagnostics if a video stalls

The output canvas exposes its current protection state without adding presenter UI. In each projection tab's developer tools, inspect `.projection-browser-surface` and its `data-video-playback-protection` attribute: expect `active` while a video is starting/playing/buffering and `inactive` after it ends or closes.

- If it never becomes active, first check GIS/output table, local backend WebSocket connectivity, current application revision, and console warnings about unavailable playback communication. A missing signal is a launch/integration issue; do not compensate by changing video encodings.
- If it remains active and playback still stalls, capture the affected video's `chrome://media-internals` record and the hardware/browser information above. The known laboratory mitigation is not a guarantee against every driver/display combination.
- If it stays active after a GIS window is closed, wait six seconds and check whether another GIS tab still has a video running. Multiple live sources intentionally keep protection active until all stop.

Do not change calibration, disable graphics acceleration, or replace media as an untested last-minute workaround. Retain the validated software revision and run this acceptance when the PC is installed, rather than immediately before the first presentation.
