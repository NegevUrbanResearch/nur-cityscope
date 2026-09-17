# Hostage Investigation Polygon Falloff Design

Date: 2026-09-16
Status: Approved visual direction; awaiting written-spec review

## Purpose

Soften the edge of the `מוקד חטיפה` investigation polygons on the black TouchDesigner projection background while preserving their approved bright-yellow identity. The treatment must also remain legible over the GIS basemap and must be represented by processed CIM style data rather than a projection-only blur, glow, or hard-coded MapLibre exception.

## Approved visual direction

Use the selected balanced inward falloff:

- Preserve the source polygon boundary exactly.
- Preserve `#ffff73` at the center.
- Use five discrete inward bands, ordered from the polygon edge to the center, with target opacities `0.14`, `0.27`, `0.46`, `0.68`, and `1.00`.
- Use the same `#ffff73` RGB color for every band; opacity, not a blend toward black, creates the falloff.
- Add no visible polygon outline.
- Add no outward halo or geometry outside the source polygon.
- Render the legend swatch from the processed five-band metadata as centered,
  hard-edged nested bands using the same `#ffff73` RGB and opacities. The
  innermost band remains fully opaque; there is no border. This keeps the
  legend faithful to the rendered falloff without introducing blur or a
  projection-only approximation.

The initial authored CIM parameters are:

- `gradientMethod`: `Buffered`
- `gradientType`: `Discrete`
- `gradientSize`: `75`
- `gradientSizeUnits`: `Relative`
- `interval`: `5`
- color space: `Default RGB`

These parameters intentionally stay within the already supported buffered-gradient subset.

## Architecture

### Authored style

Change only the `מוקד חטיפה` unique-value class in the NLI investigation polygon `.lyrx` from `CIMSolidFill` to a supported `CIMGradientFill`. The multipart ramp keeps RGB fixed at `[255, 255, 115]` and varies the CIM alpha channel from the soft outer edge to the fully opaque center.

The battle/massacre and fire classes remain unchanged. The exact class names and legend order remain:

1. `מוקד קרב/טבח`
2. `מוקד שריפה`
3. `מוקד חטיפה`

### Parser contract

Extend the existing supported `CIMGradientFill` intermediate representation with `resolvedOpacities`, parallel to `resolvedColors`. Each entry is a normalized value from `0` to `1` for the corresponding discrete interval.

Alpha interpolation follows the same weighted multipart-ramp interval midpoint used for RGB. It reads the fourth channel of each `CIMRGBColor`; a missing alpha channel means fully opaque. Existing `opacity` remains available for compatibility and represents the first resolved band opacity.

No new gradient methods, gradient types, units, color spaces, or arbitrary CIM symbol support are introduced.

### Geometry and publication

The existing buffered-gradient sidecar generator continues to create five non-overlapping inward bands for the hostage polygons. It does not alter source polygon geometry or create exterior buffers.

The existing transactional publication and rollback behavior applies without modification in scope: malformed or unsupported style data must fail before replacing the current processed pack, sidecar, manifest, styles, boundary data, or images.

### Runtime rendering

The buffered-gradient render plan pairs every resolved color with its corresponding resolved opacity. Each MapLibre band layer receives its authored `fill-color` and `fill-opacity`.

Existing narrative dimming remains multiplicative: when the projection dims a parallel Nova impact, it scales the authored band opacity rather than replacing it. GIS and projection therefore consume the same processed bands and differ only through their existing display-profile behavior.

If the processed sidecar is not ready, existing fail-closed behavior remains in effect. The renderer must not expose the old solid hostage overlay beneath a partially loaded gradient.

### Raw host-layer lifecycle

The original MapLibre fill and line layers loaded for `nli.investigation_polygons` are data hosts, not a second visual renderer. Whenever the processed investigation-polygon overlay owns polygon presentation, those raw host layers must remain hidden on GIS and projection.

Remove the obsolete cached `hostHidden` state and the renderer-owned path that restores raw host layers to `visible`. A layer-group transition may make a retained host layer visible again before the investigation timeline resynchronizes; the processed renderer must therefore reassert `visibility: none` for every captured raw fill and line on every active render, including an otherwise unchanged frame. The generic retained-layer manager remains unchanged because other layer packs still use it.

Reset and dispose remove renderer-owned overlay layers and sources but do not restore the raw investigation polygon fill or line. User-facing row enablement remains owned by the layer manager and timeline; the removed API is only the stale, competing visibility ownership inside the polygon renderer.

## Error handling

- Reject nonnumeric or out-of-range CIM alpha values during parsing.
- Treat missing alpha as `100%` opacity for compatibility with existing RGB-only ramps.
- Reject a resolved opacity count that differs from the gradient interval or resolved color count.
- Preserve the last valid published output if generation or publication fails.
- Do not silently substitute visual-token colors or a projection-only fallback for a malformed processed hostage gradient.

## Testing

### Python

- Parse fixed-RGB, varying-alpha multipart ramps into five expected normalized opacities.
- Verify weighted midpoint interpolation for alpha uses the same segment selection as RGB.
- Verify missing alpha defaults to `1.0`.
- Reject invalid alpha values and malformed band counts.
- Generate five valid, non-overlapping hostage bands whose union matches the source polygon within the existing metric tolerance.
- Confirm battle/massacre and fire output remains unchanged.
- Confirm transactional rollback preserves every prior artifact on failure.

### Frontend

- Build a render plan containing one opacity per hostage band.
- Apply the correct color and opacity to each MapLibre band layer.
- Verify narrative dimming scales every authored opacity.
- Verify the legend shows a five-band bright-yellow hostage swatch with the
  processed opacities and exact Hebrew label; the swatch has no border.
- Verify the renderer remains fail-closed while the sidecar is unavailable.
- Simulate the retained-layer manager making the raw polygon fill and line visible after an initial render, then render the same unchanged frame and verify both raw layers are hidden again.
- Verify reset, disable, and dispose paths never restore raw investigation polygon layers to `visible` and no longer accept a `restoreHostVisibility` option.
- Verify the Nova-to-general transition and polygon-row off/on transition leave only processed category layers visible.

### Visual acceptance

After regenerating the real NLI pack and rebuilding the frontend:

- Refresh both TouchDesigner projection browser sources on screens 2 and 3.
- Refresh GIS on screen 4.
- Inspect small and large hostage polygons against the black projection background and GIS basemap.
- Confirm the edge is visibly softer than the current solid fill, the center remains `#ffff73`, the source footprint does not expand, and small polygons remain identifiable.
- Confirm battle/massacre and fire gradients, routes, layer ordering, and the
  three legend entries are unchanged apart from the hostage swatch now showing
  its five processed falloff bands.
- Toggle the polygon row off and on, then switch from the Nova narrative to general view; confirm the old cyan/pink raw polygon bands never appear beneath the processed polygons.

The balanced treatment is accepted when it reads like the selected C comparison on the projection without producing a dark opaque ring on GIS.

The user owns final visual acceptance. Automated acceptance must still verify
that the legend is derived from processed colors/opacities, preserves the exact
labels and order, encodes all five discrete bands, and keeps the stroke
transparent.

## Scope exclusions

- No outward glow, blur filter, shader, or CSS effect.
- No projection-only hostage styling.
- No change to polygon coordinates, timeline timing, user-facing row enablement, z-order, or category names. Internal suppression of obsolete raw host-layer visuals is explicitly corrected as described above.
- No general reverse engineering of ArcGIS Pro gradient rendering.
- No expansion of the parser beyond per-band alpha for the already supported buffered/discrete/relative CIM gradient subset.
