## Advanced Style IR & Renderer Contract

This document defines the **canonical style intermediate representation (IR)** for OTEF layers and the **responsibilities of the renderers** (GIS and Projection) that consume it. It is the contract between:

- ArcGIS/CIM `.lyrx` styles → Python style parser
- Processed `styles` JSON → JS style engine
- JS style engine → concrete renderers (Projection canvas, GIS tile-aware renderer)

The goal is:

- **Full-fidelity support** for “advanced” ArcGIS styles (hatched fills, multi-stroke lines, marker-along-line).
- **Shared semantics** between Projection and GIS.
- **High performance** using PMTiles for geometry where appropriate.

---

## 1. Scope & Layer Classes

Every layer is classified by **styling complexity** and **data source**.

- **`complexity`**
  - `simple`: single solid fill/stroke, no hatches, no multi-stroke, no marker-along-line.
  - `advanced`: any use of hatches, multiple strokes, marker-along-line, or other non-trivial symbol stacks.

- **`source`**
  - `pmtiles`: data is primarily served via PMTiles/MVT.
  - `geojson`: data is primarily served via GeoJSON files.
  - `both`: both representations exist (e.g. PMTiles for base map, GeoJSON for inspection or fallback).

**Simple layers**:

- Can continue to use the existing style model and renderers (Protomaps/Leaflet defaults + current Projection canvas path).

**Advanced layers**:

- Must use the **canonical style IR** and the **unified style engine** described below.
- For these layers, PMTiles is a **geometry/attribute backend**, not the styling source of truth.

---

## 2. Canonical Style IR

The IR is emitted by the Python style parser from ArcGIS/CIM `.lyrx` files and is consumed by JS renderers. It is **renderer-agnostic** and expresses what the map _should_ look like, not how a particular library draws it.

### 2.1 Layer-Level Structure

Per-layer IR (high level):

```json
{
  "id": "landuse_zoning",
  "name": "Land Use Zoning",
  "geometryType": "polygon",
  "complexity": "advanced",
  "source": "pmtiles",
  "renderer": {
    "type": "uniqueValue",
    "field": "zone_code",
    "defaultStyle": {
      /* StyleSymbol */
    },
    "classes": [
      {
        "value": "R1",
        "label": "Residential 1",
        "style": {
          /* StyleSymbol */
        }
      }
    ]
  }
}
```

Fields:

- **`id`**: stable internal layer id.
- **`name`**: human-readable layer name.
- **`geometryType`**: `polygon | line | point | mixed`.
- **`complexity`**: `simple | advanced`.
- **`source`**: `pmtiles | geojson | both`.
- **`renderer`**:
  - `type`: `simple | uniqueValue | graduated | custom`.
  - `field` / `fields`: used for style class selection.
  - `defaultStyle`: `StyleSymbol` applied when no class matches.
  - `classes[]`: array of `{ value | min/max, label, style: StyleSymbol }`.

### 2.2 StyleSymbol

`StyleSymbol` is the core IR unit that describes how a single feature should be drawn. It consists of a stack of symbol layers.

```json
{
  "symbolLayers": [
    {
      /* SymbolLayer */
    },
    {
      /* SymbolLayer */
    }
  ]
}
```

The **order of `symbolLayers` matters** (bottom-to-top).

### 2.3 SymbolLayer

Each `SymbolLayer` has a `type` and type-specific fields.

Common fields:

- `type`: `fill | stroke | markerLine | markerPoint`
- `visible`: boolean
- `zIndexOffset`: optional fine control when needed

#### 2.3.1 Fill (`type: "fill"`)

Used for polygon interiors.

- `fillType`: `solid | hatch | gradient | pattern`
  - Initial focus is `solid` and `hatch`.
- `color`: RGBA or hex.
- `opacity`: 0–1.
- `outline`: optional `StrokeStyle` (polygon outline).

**Hatch-specific fields** (when `fillType: "hatch"`):

- `hatch.pattern`: `diagonal | cross | horizontal | vertical | custom`
- `hatch.spacing`: number (with `hatch.units`: `"map" | "screen"`)
- `hatch.lineWidth`: number
- `hatch.color`: RGBA
- `hatch.angle`: degrees (rotation of hatch lines)

#### 2.3.2 Stroke (`type: "stroke"`)

Used for polygon outlines or line geometries. Multi-stroke lines are represented by multiple `stroke` layers.

- `color`: RGBA
- `width`: number (with `units`: `"map" | "screen"`)
- `opacity`: 0–1
- `lineJoin`: `miter | round | bevel`
- `lineCap`: `butt | round | square`
- `dash`: optional `DashStyle`

**DashStyle**

- `array`: number[] (e.g. `[4, 2]`)
- `offset`: number
- `units`: `"map" | "screen"`

#### 2.3.3 MarkerLine (`type: "markerLine"`)

Markers repeated along a line (e.g. train ticks, arrows).

- `marker`: `MarkerSymbol`
- `placement`:
  - `mode`: `interval | vertices | start | end | custom`
  - `interval`: number (with `units`: `"map" | "screen"`)
  - `offsetAlong`: optional start offset
- `orientation`:
  - `alignToLine`: boolean
  - `angleOffset`: degrees relative to line tangent
- `collision`:
  - `minScreenSpacing`: px (minimum distance between markers on screen)

#### 2.3.4 MarkerPoint (`type: "markerPoint"`)

Single point markers.

- `marker`: `MarkerSymbol`
- `size`: number or `[w, h]` (with units)
- `anchor`: `[x, y]` relative anchor

### 2.4 MarkerSymbol

Represents the visual appearance of a marker.

- `shape`: `circle | square | triangle | image | customPath`
- `size`: number or `[w, h]` (with units)
- `fillColor`: RGBA
- `strokeColor`: RGBA
- `strokeWidth`: number
- `imageUrl` or `svgPath`: for image / vector markers

---

## 3. Component Responsibilities

### 3.1 Python Style Parser

**Inputs**: ArcGIS `.lyrx` / CIM.
**Outputs**: Per-layer IR JSON (merged into or alongside existing `styles.json`).

Responsibilities:

- Extract:
  - Fills (solid + hatch parameters).
  - Strokes (including multiple strokes, dash patterns).
  - Marker-along-line constructs (vector markers, placement, orientation).
- Decide:
  - `complexity: simple | advanced` per layer (and possibly per class).
  - `source: pmtiles | geojson | both` (based on available data and orchestration).
- For **advanced** symbols:
  - Populate full `StyleSymbol` and `SymbolLayers[]`.
- For **simple** symbols:
  - Emit a minimal equivalent that existing simple renderers can consume.

The parser is **not aware of** GIS vs Projection. It only encodes style semantics.

### 3.2 Shared JS Style Engine

This is a **renderer-agnostic core** used by both GIS and Projection for advanced layers.

**Inputs**:

- `features`: iterable of `{ geometry, properties }` (from PMTiles/MVT or GeoJSON).
- `styleIR`: per-layer IR (as above).
- `viewContext`:
  - Map scale / resolution.
  - Device pixel ratio.
  - Tile extent / bounds.
  - Coordinate transform utilities (data → screen).

**Responsibilities**:

- For each feature:
  - Resolve the appropriate `StyleSymbol` from `renderer` (default vs class).
  - Normalize styles to `viewContext`:
    - Convert `"map"` units to screen units when required.
    - Enforce `minScreenSpacing` for marker lines.
    - Avoid pathological hatch densities (e.g. clamp effective spacing).
  - Emit abstract **drawing commands**, such as:
    - `drawPolygon({ path, fill, hatch, outline })`
    - `drawLine({ path, strokes[] })`
    - `drawMarker({ point, markerSymbol })`
    - `drawMarkerLine({ path, markerSymbol, placement })`
- Batch commands where possible (per tile, per symbol type).

**Does NOT**:

- Know about Leaflet/Protomaps or Projection directly.
- Draw on any canvas; that is delegated to frontend adapters.

### 3.3 Projection Renderer (Canvas Frontend)

**Inputs**:

- Drawing commands from the shared style engine.
- Projection-specific coordinate transform.

**Responsibilities**:

- Implement for all relevant geometry types:
  - Hatch fills via cached canvas patterns.
  - Multi-stroke lines via layered `stroke` ops and `setLineDash`.
  - Marker lines with correct placement and orientation.
  - Point markers via `MarkerSymbol`.
- Manage:
  - Pattern + marker symbol caching.
  - Memory / frame time (chunked renders if needed).

**Constraints**:

- No zoom; single fixed scale.
- Can tolerate more per-frame work than GIS but must avoid long-blocking full re-renders.

### 3.4 GIS Advanced Renderer (Tile-Aware Frontend)

For layers with `complexity: "advanced"`.

**On GIS, advanced layers use PMTiles only.** There is no advanced GeoJSON renderer. When an advanced layer has no PMTiles (e.g. tiling failed or misconfiguration), the frontend falls back to loading GeoJSON and rendering it with the **simple style path** (same as `complexity: "simple"` layers). The pipeline should always produce PMTiles for advanced layers so that advanced styling (hatches, multi-stroke, etc.) is used.

**Inputs**:

- Features from **PMTiles/MVT** (the only path that uses the advanced tile-aware renderer).
- Drawing commands generated by the shared style engine.
- Map library context (Leaflet/OpenLayers) for transforms.

**Responsibilities**:

- For advanced layers:
  - Use PMTiles primarily as **geometry + attribute backend**.
  - Bypass or disable Protomaps’ built-in styling for those layers.
  - Use a dedicated **canvas (or WebGL) overlay** to render drawing commands tile-by-tile.
- Ensure:
  - Stable styling semantics across zoom levels (no “simplified style” mode).
  - Reasonable performance via:
    - Tile-based rendering and invalidation.
    - Density control (marker spacing, hatch density caps).
    - Caching or reusing rendered tiles where appropriate.

**Constraints**:

- Must coexist with:
  - Existing PMTiles + simple styling for `complexity: "simple"` layers.
  - GeoJSON layers (including advanced layers without PMTiles) using the standard Leaflet/GeoJSON path with simple styling only.

### 3.5 GIS Simple Path (Existing)

For layers with `complexity: "simple"`:

- Keep using:
  - Current Protomaps/Leaflet style logic on PMTiles.
  - Current Leaflet styling for simple GeoJSON layers.
- Over time, we may migrate more of this into the shared engine, but it is **not required** to get advanced styles working.

---

## 4. Invariants & Guarantees

Given this contract, we aim to guarantee:

- **Semantic Consistency**
  - A given layer’s style (colors, hatch pattern, marker symbol, multi-stroke structure) is defined **once** by the IR and is interpreted the same way by both GIS and Projection.

- **Renderer-Specific Performance Tuning**
  - GIS and Projection can each apply their own performance strategies (e.g. tile reuse, marker thinning, hatch spacing clamps) without changing the **style language**.

- **PMTiles as Infrastructure for Advanced Layers**
  - For advanced layers, PMTiles is a data/tiling service; the unified style engine and its frontends are responsible for visual output.

- **Extensibility**
  - New ArcGIS constructs (e.g. additional hatch patterns, more marker types) can be added to the IR and then implemented in the shared engine/frontends without redesigning the data pipeline.
