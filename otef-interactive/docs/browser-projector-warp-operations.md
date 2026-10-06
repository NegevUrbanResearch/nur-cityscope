# Browser projector operation

TD remains available until the owner accepts browser alignment by eye and separately approves retiring TD.

## Switch between TD and browser output

Use the workstation's `/otef-interactive/projection-config.html` page. Connected displays appear automatically as **Display 1**, **Display 2**, etc. **Identify displays** shows a large matching number on each screen for five seconds; Escape or Close dismisses a number early. Select the number for each projector and save the assignment. These are app numbers, not Windows display numbers. Edit calibration on the workstation or Galaxy Tab 11; launch output windows from the workstation.

Display numbers follow desktop position and update when displays are connected or disconnected. Saved assignments retain their screen identity. If display access is denied, allow it in the browser's site settings and reload. If identification popups are blocked, allow popups for this site and press Identify displays again. The temporary number windows do not change calibration or switch TD/projector output on or off.

For browser output:

1. Turn off TD's existing `projectorWindows` control.
2. Press **Open Both**. Both assigned displays should enter fullscreen automatically. The browser needs Chrome's existing automatic-fullscreen and popup policies for `http://localhost:80`; a normal two-popup launch does not guarantee fullscreen.

If only one output opens or enters fullscreen, leave that window open and use **Open Left** or **Open Right** for the affected side. These controls focus and retry an owned window, or open only the missing side. If the status asks for display identification or reassignment, press **Identify displays**, confirm the selected projector numbers, save the assignments, then retry that side. **Close Both** closes the owned outputs when returning to TD.

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

Disabling browser warp retains its corrections for re-enabling. **Clear corrections** retains the imported baseline mesh and current grid layout. **Start fresh** replaces the selected output's baseline with a flat 1920×1080 rectangle, clears keystone and grid offsets, and evenly spaces the current grid rows and columns. It enables browser warp so you can calibrate from scratch. Scale, rotation, crop, translation, and the other output stay unchanged. These actions do not switch TD on or off.

The read-only **TD migration baseline** contains the captured TD alignment. Load it as the browser starting point; **Save as new** creates an editable preset. Existing **Original calibration** and **Standard** presets remain available. Display assignments and TD/browser route selection are not stored in presets.

## Adjust keystone and grid warp

Select the left or right **Keystone** or **Grid Warp** node in the existing calibration path, then press **Enlarge selected preview**. Handles overlay that output's current image. The dashed rectangle marks the 1920×1080 output; imported grid points can extend beyond it.

Select a corner, grid point, row, column or edge, then drag or use the arrows. **Fine** moves 0.25 output pixels per tap; **Coarse** moves 1 pixel. The X/Y fields show output pixels. Keystone corners control the output plane; grid points start at the imported TD mesh positions.

With **Live** enabled, accepted edits reach the projectors. Turn Live off to try a local draft, then use **Apply once** when ready. **Undo/Redo** changes the selected output's warp, including **Start fresh** while its prior baseline is available. **Clear corrections** clears browser corrections while retaining the current baseline; **Start fresh** removes the imported TD warp for the selected projector. Use it on each projector to recalibrate both for a new exhibit. Confirm the reset; with Live on it applies immediately. **Revert** restores the loaded preset. Save a new preset to retain an adjustment without replacing the protected baseline.

## Adjust the names wall

Select **Names wall** in the calibration graph. Choose **Wall** or **Model**. The status reports whether names are initializing, stale, rebuilding, failed, or current. Counts appear only after both browser outputs report the same completed names placement. Each included name is assigned wholly to one output in either mode.

**Requested font** is the preferred maximum. The layout can reduce it to fit both outputs, down to a technical 1 px floor. Check the effective size on the actual projectors; a valid result does not establish physical readability. **Name spacing** and **Edge inset** use name-plane units. Edge inset also keeps model names inside the projected model boundary.

**Left projector: right-edge inset** and **Right projector: left-edge inset** use final 1920×1080 output pixels. Increase each independently to move names away from that screen's inner edge. Inspect the physical seam on the installed projectors when adjusting these values. Browser previews verify the calculated safe placement, but cannot establish projector overlap or legibility on the surface.

Live, Apply, Save, Save New, Load, Revert, and import keep their existing settings behavior. Their preflight checks both calibration meshes and matching captured baselines; they do not place names. After applying geometry, press **Run names** on the page or in the Keystone/Grid Warp modal. Live may remain off. Run names uses the applied calibration and does not apply or save a draft. It stays disabled until the draft is applied, while either output has not applied the geometry, and while names are rebuilding.

Changing geometry or names settings can leave the previous names visible while status is stale. Finish geometry, apply it, then press **Run names**. Current requires matching completed output reports from both browser windows. If placement fails or only one side completes, the latest geometry and previous names remain in place; correct the issue and press **Run names** again. A browser preview showing the latest draft does not confirm physical names placement.

Settlement-name styling and positions save through their own editor. Clock and legend layouts save through their own editors. These settings remain independent of calibration Live and Run names. Showing or hiding prepared names fades the layer without repacking it. A saved V3 configuration with a nonzero seam gap reports that the gap needs readjustment after conversion to V4; the new inner insets start at zero.

## Workstation setup and recovery

This exhibit uses Chrome's `AutomaticFullscreenAllowedForUrls` and `PopupsAllowedForUrls` policies for exactly `http://localhost:80`. Verify the permissions on a replacement workstation before relying on dual fullscreen launch. Do not use wildcard host or port rules.

If one output fails to launch or render, keep the working output open and retry the affected side with **Open Left** or **Open Right**. If both outputs are unusable, choose whether to retry browser output or return to TD; press **Close Both** only when choosing TD. If an unavailable mesh asset is repaired, reload the affected browser output to retry loading it. After WebGL context recovery, inspect the image before relying on it.

## Captured TD baseline recapture and recovery

The captured baseline is a bundle. It contains the left and right evaluated TD meshes, the source framing configuration, and `manifest.json`, which records each asset path, side identity, logical grid dimensions, and SHA-256 digest. Keep these files together. The browser verifies the fetched bytes against the manifest before it prepares a mesh, and configuration preview/save checks the selected side against the trusted manifest on the API server.

### Recapture procedure

1. Save a copy of the current TD project before changing or exporting anything. Keep the existing source framing and camera setup: 1920×1080 output, top-left origin, and the current camera-matrix checks. Use the existing TouchDesigner exporter at `scripts/td-warp/export-stoner.py`. In the TD Textport, run `exec(open(r'<repo>\otef-interactive\scripts\td-warp\export-stoner.py', encoding='utf-8').read()); export_active_baselines(r'<new staging directory>')`. It reads the left `/project1/split_view/stoner` and right `/project1/split_view/stoner1` networks. Each side uses its existing `ui/controls/positions`, `project/uvOffset`, `ui/controls/mainPoints`, `project/pointOffset`, `project/keyOffset`, `ui/controls/finalGeo`, `render`, `ui/controls/camTransform`, `render/cam1`, `render/offset`, and `settingsUI` nodes. The exporter checks that table fingerprints match before and after capture. It records the evaluated mesh, UVs, source topology, logical grid, and camera snapshot for each side.
2. Export both outputs into a new staging directory. Do not write over the active `public/projection-calibration/td-baselines` directory during capture. Convert the left and right raw exports with the existing `scripts/td-warp/convert-td-stoner-export.mjs` converter, and review the reported side, camera, dimensions, logical counts, mesh topology, and UVs.
3. Build a candidate manifest from those staged outputs and compute SHA-256 from the exact serialized mesh and framing bytes that will be installed. Confirm that each manifest side, asset ID, path, digest, logical grid, mesh side, and dimensions agree. Validate both outputs together. A successful conversion of only one side is not a complete baseline.
4. Review the changed TD logical counts and the resulting evaluated mesh vertex and triangle counts. A logical grid can have at least 2 columns and 2 rows, with at most 65,536 logical points. The evaluated mesh must also fit the 65,536-vertex unsigned-short index limit. The browser correction grid is independent of the TD logical grid and remains limited to 2–16 points per axis.
5. Retain the prior complete bundle as a separate backup. The existing Django management command is `python manage.py install_otef_td_baseline` (from `nur-io/django_api`; `--asset-root <directory>` selects a candidate root). It installs the immutable TD migration preset from its input bundle. If that preset already exists unchanged it returns without modifying it; an ID or name collision is an error that refuses overwrite. This command does not replace the active bundle or activate a recapture. Use only the project's separately authorized controlled installation procedure for any replacement or activation; this document does not define a new one, and the feature provides no automatic activation.
6. Verify both output configs load their matching side assets, confirm the expected framing and camera, and inspect the image on the exhibit projectors before accepting the recapture.

### Backup and restore

Before installation, copy the complete current `td-baselines` directory and its matching `td-source-config.json` into a dated backup location, and record the associated projection config/preset. Restoring means restoring the entire mesh pair, manifest, framing file, and matching projection config as one controlled bundle. A saved preset alone cannot restore mesh bytes or the manifest. Verify restored hashes and both side identities before opening browser output. Keep the prior TD project copy as a separate source recovery point.

### Grid and rendering behavior

TD logical grid metadata describes the source capture topology. The browser correction grid stores independent user controls, including column and row positions, offsets, and keystone corners. Changing TD logical counts does not resize or replace the correction grid. Uniform 5×5 and 16×16 grids, rectangular grids, and nonuniform knot positions are supported within the existing per-axis 2–16 correction-grid bounds. Numeric point targets and topology add/remove plus undo/redo use the existing editor behavior. Identity and disabled/bypass modes keep their existing behavior.

For an unchanged historical aligned v7 layout, the existing fast path keeps its previous prepared output. Other v7 grids are sampled against the trusted source mesh and prepared with the existing refinement algorithm. Refinement checks projected geometry to a 0.45 px tolerance and stops at depth 12; it also enforces a 0.5 px sampled-error ceiling. This sampled check is not a continuous-error guarantee between samples. The prepared mesh retains source coordinates and UVs. It is rejected when source coverage or precision checks fail, when the warp folds or collapses triangles, or when refinement would exceed the 65,536-vertex unsigned-short renderer budget. The renderer accepts unprofiled captured source meshes and `relative-source-v1` prepared meshes; the final indexed draw count follows the active mesh topology.

### Failure messages and response

- `browser projection ... hash mismatch`: the fetched bytes do not match the manifest. Restore the exact staged files or regenerate the digest from the bytes intended for installation.
- `baseline ... side mismatch` or `logical grid mismatch`: the manifest and mesh metadata refer to different captures. Re-export/convert the mismatched side and validate the pair again.
- `baseline rejected` / `trusted manifest`: the selected config identity, digest, side, or metadata does not match the trusted bundle. Do not save that config; review the manifest and selected side.
- `source point ... covered` or a coverage/refinement rejection: the TD mesh does not cover the requested correction-grid sample within the accepted precision. Check the capture topology and knot positions.
- `grid warp folds or collapses a triangle` or `render precision collapses or inverts`: the candidate correction is invalid at runtime precision. Undo or revise that correction before previewing or saving.
- `unsigned-short vertex capacity` / vertex capacity rejection: the prepared geometry exceeds the renderer budget. Reduce the correction-grid density or deformation and retry.

The physical comparison gate remains required after automated verification: inspect both actual projectors, compare the recaptured image and framing with the retained reference, and check visual seams, brightness, and performance on the exhibit hardware. Automated fixture tests do not replace that hardware check.

The pre-migration calibration backup (`pre-v2-calibration-rows-live.json`) is kept locally on the exhibition PC, not in the repository. Database restoration is a technician recovery operation, not the normal TD fallback sequence. Keep the local TD project and captures until retirement is approved.
