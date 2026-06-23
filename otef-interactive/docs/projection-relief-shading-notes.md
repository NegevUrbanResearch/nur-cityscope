# OTEF Projection Relief Shading Notes

## Context

The OTEF projection page is projected down onto a 3D printed landscape model. Because the projector lights the model from above, projected content can reduce the physical model's perceived depth. The current projection runtime is favorable for relief shading experiments because it does not project an opaque basemap by default:

- `projection.html` uses a black page background.
- `#displayedImage` starts hidden and is only shown when `projector_base.model_base` is enabled.
- `maplibre-projection.js` creates a transparent MapLibre map with no basemap.
- Most projection output is therefore dark/transparent background plus selected GIS layers.

This means a subtle terrain-matched illumination layer has room to improve perceived relief without fighting a bright raster base.

## Main Finding

An in-app relief layer can help, especially because the projection background is already dark/transparent. It cannot replace real side lighting, but it can add visual contrast that the eye reads as terrain form.

The important distinction:

- A generic CSS gradient gives the whole table a lighting mood.
- A DEM-derived hillshade gives the landscape shape.

Since the DEM/DRM used for 3D printing is available, the useful direction is DEM-derived hillshade aligned to `model-bounds.json`, not a hand-authored gradient.

## Expected Effect

Relief shading should:

- Restore some slope contrast lost under top-down projection.
- Make ridges, valleys, and drainage structure easier to read.
- Work best when projected layers leave meaningful dark/transparent space.
- Be subtle enough not to compete with GIS data or distort thematic colors.

Relief shading will not:

- Create true physical shadows from the model geometry.
- Look perfectly correct from every viewing position.
- Fix over-bright or fully opaque thematic layers by itself.
- Replace the depth cues from a real soft side light.

The likely best result is a hybrid: subtle in-app hillshade plus weak, soft side lighting if the physical installation allows it.

## Recommended Product Model

Expose relief shading in the remote like a layer, but treat it internally as a projection effect.

Suggested remote behavior:

- Add a toggle such as `Relief`, `Terrain shading`, or `תאורת תבליט`.
- Place it in a projection/model group, near `projector_base`, not mixed into ordinary GIS datasets.
- Make it projection-only by default.
- Persist its enabled state through the same layer or viewport state system used by the remote.
- Start with one live control: intensity.
- Add light-direction presets later if useful.

Suggested render order:

1. Black page / transparent base.
2. Optional model base image.
3. Relief hillshade.
4. Filled polygons and raster thematic layers.
5. Lines.
6. Points and labels.
7. Viewport highlight and debug overlays.

For the first version, render the hillshade below most GIS layers. A top overlay can be tested, but blend modes such as `multiply`, `overlay`, or `soft-light` may distort layer colors.

## Implementation Options

### Option 1: Baked Hillshade Raster

Generate one hillshade image from the DEM/DRM and serve it as a projection-only image/raster layer.

Pros:

- Fast and stable at runtime.
- Simple to tune with opacity.
- Good first experiment.
- Works well with the current projection architecture.

Cons:

- Sun angle is baked in.
- Requires regenerating the asset to change lighting direction.

Recommended as the first implementation.

### Option 2: Baked Direction Presets

Generate several hillshade rasters from the same DEM using different virtual sun angles.

Possible presets:

- Northwest light.
- Northeast light.
- West / low side light.
- Soft overhead-ish fallback.

Pros:

- Feels adjustable from the remote without runtime terrain processing.
- Still cheap and predictable.
- Easy to compare during installation.

Cons:

- Discrete choices only.
- More assets to manage.

Recommended after the single-raster test, if sun direction matters in practice.

### Option 3: Runtime Hillshade

Load DEM data in the browser or server and compute hillshade dynamically from sun azimuth/elevation.

Pros:

- Continuous sun-angle control.
- Could support live tuning from the remote.

Cons:

- More engineering complexity.
- More runtime risk in the projection environment.
- Needs careful performance testing at projection resolution.

Not recommended for the first pass unless baked presets prove insufficient.

## Blend And Styling Notes

Useful variants to test:

- Neutral grayscale hillshade at about `0.10` to `0.25` opacity.
- Shadow-only relief that mainly darkens terrain-facing-away slopes.
- Very subtle warm/cool relief: warm highlights, cool/dark shadows.

Blend modes to evaluate:

- Normal alpha: safest for color fidelity.
- Multiply: shadow-like, but can make the projection muddy.
- Overlay / soft-light: more dimensional, but can shift thematic colors.

Start conservative. The purpose is to help the physical model read as terrain, not to make the projected map look like a shaded relief map on a screen.

## Open Questions

- Which DEM/DRM file is the canonical source used for the 3D print?
- Does its coordinate extent exactly match `frontend/data/model-bounds.json`?
- Should the relief layer appear on the interactive GIS map as a preview, or only on projection?
- Should intensity be global, per slideshow pack, or per projection session?
- Which audience/viewer direction should define the default virtual sun angle?

## Recommendation

Build a small proof of concept with one baked DEM-derived hillshade raster aligned to the model bounds and controlled from the remote as a projection-only layer with live opacity/intensity. If it visibly improves depth, add a few baked sun-angle presets before considering runtime sun-angle computation.
