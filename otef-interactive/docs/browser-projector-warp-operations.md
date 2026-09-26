# Browser projector operation

TD remains available until the owner accepts browser alignment by eye and separately approves retiring TD.

## Switch between TD and browser output

Use the workstation's `/otef-interactive/projection-config.html` page. Connected displays appear automatically as **Display 1**, **Display 2**, etc. **Identify displays** shows a large matching number on each screen for five seconds; Escape or Close dismisses a number early. Select the number for each projector and save the assignment. These are app numbers, not Windows display numbers. Phones and tablets edit calibration; launch output windows from the workstation.

Display numbers follow desktop position and update when displays are connected or disconnected. Saved assignments retain their screen identity. If display access is denied, allow it in the browser's site settings and reload. If identification popups are blocked, allow popups for this site and press Identify displays again. The temporary number windows do not change calibration or switch TD/projector output on or off.

For browser output:

1. Turn off TD's existing `projectorWindows` control.
2. Press **Open Both**. Both assigned displays should enter fullscreen automatically.

For TD output:

1. Press **Close Both** and verify the browser pair closed.
2. Turn TD's `projectorWindows` control back on.

Keep the calibration page open while it owns the outputs. After reloading that page, close any old browser output windows manually before opening another pair. Leave the GIS window on `/otef-interactive/`.

## Which alignment is applied?

| Output | Alignment |
| --- | --- |
| TD source (span-only projection URL) | Captured scale/crop/transform, then TD applies its own warp. |
| Browser, warp enabled | Saved scale/crop/transform, imported baseline mesh, and browser keystone/grid corrections. |
| Browser, warp disabled | Saved scale/crop/transform; imported mesh and browser corrections are bypassed. |

Disabling browser warp retains its corrections for re-enabling. Resetting corrections retains the imported baseline mesh. Neither action switches TD on or off.

The read-only **TD migration baseline** contains the captured TD alignment. Load it as the browser starting point; **Save as new** creates an editable preset. Existing **Original calibration** and **Standard** presets remain available. Display assignments and TD/browser route selection are not stored in presets.

## Adjust keystone and grid warp

Select the left or right **Keystone** or **Grid Warp** node in the existing calibration path (the node selector on phones/tablets), then press **Enlarge selected preview**. Handles overlay that output's current image. The dashed rectangle marks the 1920×1080 output; imported grid points can extend beyond it.

Select a corner, grid point, row, column or edge, then drag or use the arrows. **Fine** moves 0.25 output pixels per tap; **Coarse** moves 1 pixel. The X/Y fields show output pixels. Keystone corners control the output plane; grid points start at the imported TD mesh positions.

With **Live** enabled, accepted edits reach the projectors. Turn Live off to try a local draft, then use **Apply once** when ready. **Undo/Redo** changes the selected output's warp. **Reset to imported TD baseline** clears browser corrections while retaining the imported mesh; **Revert** restores the loaded preset. Save a new preset to retain an adjustment without replacing the protected baseline.

## Workstation setup and recovery

This exhibit uses Chrome's `AutomaticFullscreenAllowedForUrls` and `PopupsAllowedForUrls` policies for exactly `http://localhost:80`. Verify the permissions on a replacement workstation before relying on dual fullscreen launch. Do not use wildcard host or port rules.

If launch or rendering fails, read the visible error, close the browser pair, and return to TD. If an unavailable mesh asset is repaired, reload the browser output to retry loading it. After WebGL context recovery, inspect the image before relying on it.

The pre-migration calibration backup is kept locally under `.superpowers/sdd/browser-warp/pre-v2-calibration-rows-live.json`. Database restoration is a technician recovery operation, not the normal TD fallback sequence. Keep the local TD project and captures until retirement is approved.
