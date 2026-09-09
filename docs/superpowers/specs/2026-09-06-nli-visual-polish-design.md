# NLI exhibit visual polish

**Date:** 2026-09-06 (body); **Owner lab lock:** 2026-09-07; **Owner lab lock (afternoon):** 2026-09-07  
**Status:** owner-locked for implementation  
**Approach:** extend the existing NLI clock + MapLibre investigation pipeline (`NLI_VISUAL_TOKENS`, polygon/line/alarm renderers, `deriveInvestigationFrame`). Do not add a second narrative state machine.  
**Surfaces:** GIS map, projection map, remote (unchanged except archive result honesty + closed-wins). Slideshow is unchanged **except** that an idle investigation clock now paints the complete-story look in §1 (projection already forces `idleNliClock` during presentation). That is the intended NLI slideshow slide, not a separate visual.

This spec supersedes, for the items below, the ghost/orange future paints and the GIS-hidden `projector_base` settlement layers. It also **supersedes both Stop clauses in `otef-interactive/AGENTS.md`**: Stop/`idle` must show the complete investigation story (all polygons at category style, all settlement impact outlines, all routes in completed flow), not reset polygons and outlines to empty. **Alarms keep today’s idle/off behavior** (not a complete-story alarm map) unless a later owner decision says otherwise. Update that AGENTS.md paragraph in the morning lab-follow-up plan (already shipped). Completed-route dash flow itself stays.

**2026-09-07 supersedes** the 2026-09-06 paint for: GIS clock rotation/clamps/layout v1, GIS `שמות_יישובים`/`Locations_Lines` allowlist, polygon gold/purple fills, “no legend”, people_names size 11 / map-alignment / tight radial, highlight empty-FC below zoom 13, and sand Route 232. Unchanged locks from 2026-09-06: Stop complete-story, no future ghosts, alarms idle/off, person glow + GIS zoom 16 with no projection `flyTo`, Tesuga/crop deferred, no `window.open("", name)`.

**2026-09-07 afternoon supersedes** the 2026-09-07 morning lock for: a separate `#nliInvestigationLegend` overlay HUD; `people_names` viewport-only `text-rotate: 0` as the final heading story; treating pack re-prep of `ציר_232` / `people_names` as a leftover “do later.” Keep: Stop complete-story, no future ghosts, alarms idle/off, GIS mute of `שמות_יישובים` + leaders, GIS clock rotate + layout stores `.v2`, Tesuga deferred, no `window.open("", name)`, highlight keep-geometry + 400 ms opacity at zoom 13, category token colors (`#3d9a8c` / `#e8a4b4` / `#d85a1f`), archive `BroadcastChannel("otef-nli-archive")`. Afternoon implementation plan: `docs/superpowers/plans/2026-09-07-nli-afternoon-followup.md`.

## Goal

One narrative look on GIS and projection: upcoming investigation geometry is absent until its beat, settlement **outlines** recede until breached (GIS names/leaders are temporarily muted), polygons read as three authored types with three category rows in the existing `#mapLegend` on GIS and projection, person focus is obvious, clocks hug `fontPx` with no card chrome, victim names share **one operator heading** (default 0°, `text-rotation-alignment: map`) and stay unbunched, Route 232 matches the brown corridor on **live processed** styles, the GIS-viewport highlight fades instead of popping and does not bounce after person search, and archive close cannot be reported `unavailable` by a GIS tab that never held the window.

## Non-goals

- Moving the projection camera to follow a person or GIS pan (table stays Tesuga-registered).
- Remote chrome redesign. Pack-prep may add generated layout fields on `people_names` (`otef_map_text_offset_em`) and restyle `people_names` labels; do not change pid stability or expose NLI URLs in the remote index.
- Guessing Tesuga/`PROJECTION_SPAN` values, or guessing polygon types from `Name`.
- New archive embedding, leases, or iframe work.
- Editing Tesuga / `POST_TY` / `POST_SCALE` / `PROJECTION_SPAN`.

---

## Owner lab lock 2026-09-07

Copy of the owner-locked product decisions. Do not reopen in implementation.

**Global:** GIS and projection share one design (tokens + same paint/motion). Almost no exceptions. Remaining GIS-only extras: named archive window, GIS clock layout debug, and a **temporary** mute of settlement names + leader lines on GIS (outlines stay). Split cameras unchanged. No Tesuga/`POST_TY`/`POST_SCALE`/`PROJECTION_SPAN` edits. Alarms idle/off unchanged. Do not reuse `#c31f4f` for polygon fills. Do not `window.open("", "otef-nli-archive")`.

### 1. Clocks

- Clock-only caption: **transparent background** (no `rgba(12,16,22,0.62)` card) on GIS `#nliGisClockHost` and projection `#nliExplainerHost`. Keep white heavy type + text-shadow.
- Clock font on BOTH surfaces comes from layout **`fontPx`**, not `--nli-projection-clock-size` / `--nli-gis-clock-size` clamps (those clamps ignore parked fontPx and inflate the box).
- GIS clock **must rotate**. `enableRotation: true` on GIS debug. Rotate handle + rotateDeg field. `applyNliExplainerLayout` already applies CSS rotate; do not strip rotateDeg on GIS.
- Layout box must shrink around the clock: `clampNliExplainerLayout` min width/height **2** (not 8). Reduce clock-only caption padding so the box can hug HH:MM. Host still uses % box; no second layout model.
- Commit this exact projection map as `NLI_EXPLAINER_LAYOUT` and bump projection storage key to **`otef.nliExplainerLayout.v2`** so lab v1 parks cannot shadow it. **Afternoon lock:** left park only is replaced (full/right unchanged; keep `.v2`). Do not commit the morning left box below. Authoritative JSON is Owner lab lock 2026-09-07 afternoon §1.

```json
{"full":{"leftPct":31.83,"topPct":48.95,"widthPct":16.7,"heightPct":19.75,"fontPx":12,"rotateDeg":-48.5},"left":{"leftPct":30.810416666666665,"topPct":11.905247659352419,"widthPct":13.572916666666666,"heightPct":11.732162458836443,"fontPx":15,"rotateDeg":91.18739188335852},"right":{"leftPct":58,"topPct":68,"widthPct":42,"heightPct":26,"fontPx":22,"rotateDeg":0}}
```

- GIS layout store bump to **`otef.nliGisClockLayout.v2`**. GIS default stays bottom-center until the operator parks it; `rotateDeg` default 0 is fine. GIS still must not read/write the projection key. GIS still no span/overlap/copy/download.
- Tests to invert: `nli-explainer-debug.test.js` currently asserts GIS `enableRotation: false` and no rotate handle/field.

### 2. GIS settlements

- GIS allowlist: keep `Tkuma_Area_LIne` + `ישובים`. **Drop** `שמות_יישובים` and `Locations_Lines` from `PROJECTOR_BASE_GIS_LAYERS`. Outlines only on GIS for now. Projection names/leaders unchanged (`keepSettlementNames`).
- Invert Task 5 tests in `gis-layer-filter.test.js` (and GIS label-emission tests that required שמות on GIS).
- Impact outline is already `#c31f4f` on both; perceived mismatch is width/profile (GIS 1.8 vs projection 2.16) and pack `ישובים` vs overlay. Lock: impact overlay uses `incidentRed` and **the same line-width on GIS and projection** (do not multiply impact outline by `lineWidthMultiplier`). If pack `ישובים` stroke color differs across surfaces because of hatch, make GIS pack outlines use the same color as projection pack outlines (inspect `maplibre-style-bridge` / hatch). Do not join sidecar OBJECTIDs.

### 3. Polygon categories + legend

Lab: no legend; battle `#c4a35a` reads as yellow next to alarms `#f5c542`; kidnap `#6b2d5b` dies on black.

New tokens (exact):

| Notes | Fill | Outline |
|---|---|---|
| מרחב לחימה - קרב | `#3d9a8c` | `#2a6b62` |
| מוקד חטיפה | `#e8a4b4` | `#c47388` |
| שריפה | `#d85a1f` | `#a33d12` | (unchanged)

Keep existing fillOpacity / motion periods. Do not use `#c31f4f` or `#f5c542` for these fills.

**Legend is required** (owner complaint). **Afternoon lock supersedes the separate overlay:** fold the three short Hebrew rows into the existing `#mapLegend` (`updateMapLegend` / `buildLegendModel`) on GIS **and** projection. Do **not** keep `#nliInvestigationLegend` as a second HUD. Do **not** uniqueValue the hidden orange host pack. Do **not** collapse via `ui.legendLabel` to one English “Investigation polygons” row. Remote layer sheet stays one glossary row.

### 4. Archive close / two GIS windows

Root cause: each GIS page has its own controller/handle; remote broadcasts close to all `otef_channel` clients; first WS result wins; a GIS with `handle === null` reports `unavailable` while another GIS still has the window. Two GIS documents (two tabs, `:80` vs Vite, localhost vs 127.0.0.1) can mean two real named windows.

Required:

- Same-origin GIS instances: `BroadcastChannel("otef-nli-archive")` so a close request closes **every live handle** in that origin.
- GIS with no handle must **not** emit a close result that can beat a sibling’s `closed` (stay silent, or only emit after a short wait if nobody closed).
- Remote: if multiple results for the same requestId, **`closed` wins** over `unavailable`.
- Keep Task 11 honesty: `{ ok: true }` only if that handle’s `closed === true`. Never `window.open("", name)`.
- Tests for BroadcastChannel fan-out + remote closed-wins. Do not invent leases/iframes.

### 5. Victim names

Owner: not east-west readable from the **bottom of the projection**, not thinner/smaller, not spread in dense clusters. GIS and projection must match.

Lock (type + radial; heading superseded afternoon):

- Size **8**, Regular, halo **0.12**, white. Radial groups on `round(source_lon,6)` / `round(source_lat,6)`. Formula `r = 1.8 + 0.45 * (n - 2)` capped at **4.5**. pid-sorted. `offsetArrayProperty: "otef_map_text_offset_em"`. No `offsetEmFromProperties`. `forceVisible` on.
- **Afternoon lock supersedes** viewport-only `text-rotate: 0` as the final heading story, and supersedes 15° per-settlement rotate. One shared integer heading, `text-rotation-alignment: map`, default **0**, snap **1°**. See afternoon lock §5.
- **Pack re-prep is blocking** (afternoon lock §3), not a residual “re-prep later.” Do not hand-edit gitignored geojson. Invert tests that lock size 11 / r=1.15 cap 2.4.

### 6. Route 232

This is pack `nli.ציר_232`, NOT investigation `nli.lines` (those stay `#c31f4f`).

Revert sand `(232,196,120)` / 1.5pt / alpha 50 to **brown** matching `future_development.ציר_232`:

- `ROUTE_232_STROKE_COLOR = (135, 62, 35)` (`#873e23`)
- `ROUTE_232_STROKE_WIDTH_PT = 2.0` (a bit bolder than original ~1.33, not huge)
- `ROUTE_232_STROKE_ALPHA = 100`
- Label fill: brown-family, not sand `(255,232,196)` — lock `(255, 224, 210)` with the existing dark halo `(20, 16, 12)` alpha 80; keep readable on black.

Projection hatch `PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE = 0.3` currently makes 232 a hairline on the table. **Exempt `nli.ציר_232` from that scale** so GIS and projection stroke widths match. Invert `test_nli_pack_prep.py` sand assertions.

### 7. Highlight fade

Do **not** empty the FeatureCollection when GIS zoom < 13 (that pops). Keep last viewport geometry; lerp fill-opacity and line-opacity with MapLibre `*-opacity-transition` (~400 ms). Below minzoom → 0; at/above 13 and not full-extent → fill 0.05 / current line color. Slideshow hide may stay layout `visibility: none`. Do not change Tesuga. **Afternoon lock:** person GIS `flyTo` must set `navigationTravelActive` until `idle` so the highlight does not bounce (do not lerp geometry; do not wire `PROJECTION_LERP_FACTOR` during flyTo). See afternoon lock §4.

---

## Owner lab lock 2026-09-07 afternoon

Copy of the owner-locked product decisions. Do not reopen in implementation. This afternoon lock **supersedes** morning: separate `#nliInvestigationLegend` overlay; people_names viewport-only rotate 0 as the final heading story; “re-prep later” residual for 232/names.

Keep from morning / 2026-09-06: Stop complete-story, no future ghosts, alarms idle/off, GIS mute of `שמות_יישובים` + leaders, GIS clock rotate + stores `.v2`, Tesuga deferred, no `window.open("", name)`, highlight keep-geometry + 400 ms opacity at zoom 13, category token colors, archive `BroadcastChannel("otef-nli-archive")`.

### 1. Clock

Commit this exact `NLI_EXPLAINER_LAYOUT` (left park changed; full/right unchanged). Keep storage keys `.v2`.

```json
{"full":{"leftPct":31.83,"topPct":48.95,"widthPct":16.7,"heightPct":19.75,"fontPx":12,"rotateDeg":-48.5},"left":{"leftPct":47.16458333333333,"topPct":14.320176309187765,"widthPct":13.572916666666666,"heightPct":11.732162458836443,"fontPx":15,"rotateDeg":91.18739188335852},"right":{"leftPct":58,"topPct":68,"widthPct":42,"heightPct":26,"fontPx":22,"rotateDeg":0}}
```

GIS still uses `otef.nliGisClockLayout.v2`. GIS must not read/write the projection key. GIS still no span/overlap/copy/download.

### 2. Legend — fold into existing `#mapLegend`, delete overlay

Owner: polygon legend must not be a second HUD. Existing GIS legend is `updateMapLegend` / `buildLegendModel` / `#mapLegend` (`map-legend.js`, `legend-model-builder.js`).

- When `nli.investigation_polygons` is enabled, the existing legend emits **three polygon items** from `NLI_VISUAL_TOKENS.polygonCategories` + `NLI_LEGEND_SHORT_LABELS` (קרב / חטיפה / שריפה, fills `#3d9a8c` `#e8a4b4` `#d85a1f`). Do **not** uniqueValue the hidden orange host pack. Do **not** keep `ui.legendLabel` collapse to one English “Investigation polygons” row for this layer.
- **Delete** `mountNliInvestigationLegend` from map-main and projection-main. Remove or stop using `#nliInvestigationLegend` CSS as a second overlay.
- **Projection must mount the same map-legend** (`#mapLegend` + `updateMapLegend`). GIS-filter in `buildLegendModel` (`shouldShowLayerOnGisMap`) must not strip projector-only layers from the **projection** legend. Add a surface argument (`gis` | `projection`). Investigation polygons three-row expansion happens on both.
- Remote layer sheet stays one glossary row. Not MapLibre uniqueValue.

### 3. Pack re-prep is BLOCKING (not residual)

Owner called out skipping re-prep. Implementer MUST run, from `otef-interactive/scripts` with `.venv`:

```
.\.venv\Scripts\python.exe .\nli_pack_prep.py
.\.venv\Scripts\python.exe .\process_layers.py --pack nli --layer ציר_232
.\.venv\Scripts\python.exe .\process_layers.py --pack nli --layer people_names
```

Verify live `public/processed/layers/nli/styles.json`: 232 stroke `#873e23` (or rgb 135,62,35), opacity 1, width ~2.667px (2.0pt); people_names size 8, halo 0.12, `offsetArrayProperty`, `textRotationAlignment` as this afternoon lock (`map`). Do not `fetch_data --force`. Do not `--no-cache` other packs. Do not commit gitignored geojson/lyrx. Record in the task report that processed files on disk match.

### 4. Highlight elastic after person search

Root cause (do not lerp geometry): GIS person `flyTo` is NOT `navigationTravelActive`. After fly, GIS `_setViewport` → `applyViewportToMap` (`fitBounds`+`setZoom`) → another moveend → bouncing bbox. Projection `setData` every snapshot.

Lock: treat person `flyTo` like place travel — set `navigationTravelActive` until map `idle`, report on `move` during travel (highlight follows GIS 1:1 = the table-side fly), skip self-`applyAcceptedViewport` while traveling. Do **not** wire `PROJECTION_LERP_FACTOR` during flyTo. Keep 400ms opacity fade only for zoom-13 gate. Do not empty FC below 13.

### 5. One shared text heading for ALL names

Replace per-settlement `angleFromProperties` / `otef_label_rotate_deg` as the live rotate. The projection **L** / `window.ShemotLabelDebug` tool sets **one integer degree** applied to:

- whole `nli.people_names` symbol layer
- ALL `שמות_יישובים` labels (projection; GIS names stay muted)

Snap **1°** (not 15°). Per-feature **offsets/locations stay**. Persist one heading (localStorage, bump key if needed). Export JSON is a single heading, not per-citycode rotate. Default heading **0**. `text-rotation-alignment: map` so the existing tool’s rotation space still matches (operator parks on the table). GIS `people_names` use the same heading (shared look). Do not lift GIS שמות mute.

Keep people_names radial offsets / size 8 / halo 0.12 from morning lock.

---

## Global constraints

1. **Shared look, split cameras.** Paint, motion, and timeline membership are identical on GIS and projection (theme tokens + display profiles for scale only). GIS camera may fly. Projection camera stays fitted to the table. The thing that “flies” on the table is the GIS-viewport highlight.
2. **GIS-only extras.** Named NLI archive window; the clock layout debug handle on GIS; **temporary** mute of `שמות_יישובים` + `Locations_Lines` on GIS (pack `ישובים` outlines stay). No other GIS-only narrative language. Shared clock chrome, category tokens, `#mapLegend` category rows, people_names heading, Route 232, and highlight fade are not GIS-only. The deleted `#nliInvestigationLegend` overlay is not a required HUD.
3. **No guessed data.** Polygon categories are the three exact `Notes` strings counted in the pack. Crop/Tesuga edits require a written UV measurement. Unmatched `Notes` is a fallback plus a console warning, not a heuristic.
4. **Binary geometry for membership.** A feature whose beat has not arrived is **absent** from the investigation source/layers (layout `filter` or source partition). Do not hide it with opacity 0 (that still hits `queryRenderedFeatures` / GIS popups). No orange 0.16 fills, no `FUTURE_OPACITY = 0.24` future lines. The **current-beat line draw-on** (existing 3200 ms gradient + head) is an explicit exception: that beat *has* arrived; the reveal is how the line appears, not a ghost of a future beat. Polygons still snap to full category style at beat start. The GIS-viewport **highlight** is not investigation membership: it may keep geometry and fade opacity (Owner lab lock §7).
5. **Reduced motion.** Category motion and person glow become static; line completed-flow already has a reduced-motion dash. Honor the existing `motionMode` path.
6. **Memorial tone.** Category motion is slow and low-contrast, not a game overlay.

---

## 1. Timeline visibility (ghosts)

### Current

- Future polygons: `#f79009` fill 0.16 / stroke 0.3 (`maplibre-investigation-polygons.js`).
- Future lines: red at opacity 0.24 (`maplibre-investigation-lines.js` `FUTURE_OPACITY`).
- Polygon beat membership starts at beat start; line reveal still waits for the 3200 ms reveal.

### Required

Clock phases already in `nli-investigation-clock.js`: `idle`, `playing`, `paused`, `ended`. **Stop is `idle`** (`stopNliClock` → `idleNliClock`). Do not invent a fourth “has-run” flag.

| Clock `phase` | Polygons | Lines |
|---|---|---|
| `playing` or `paused` | Only features whose `timeline_minutes` is in the achieved set, at full category style | Completed + **current-beat** active reveal only. **No future overlay.** Active keep the existing 3200 ms gradient + head (approved exception in constraint 4). Completed keep carrier + flow. |
| `idle` or `ended` | **All** investigation polygons at full category style + motion | **All** investigation lines as completed (full opacity + flow), matching today’s idle/ended route flow |

That makes first load, Stop, and natural end the same complete-story map (routes already do this). Play/pause hides anything not yet achieved.

“Achieved” during play/pause stays the existing `achievedPolygonBeats` rule (polygon-only beats at beat start; shared route beats wait for line reveal completion). Do not change that timing.

**Coordinator change (today this would fail):** `syncInvestigationTimelineToMap` currently forces `polygonOn = false` on `idle`, skips polygon/settlement loads, calls `polygonRenderer.reset()` → `restoreBasePaints()`, and only runs `applyIdleFinalRouteVisuals`. Idle **must not** call `restoreBasePaints`. Gate complete-story polygon/settlement rendering on **layer-group visibility** (`nli.investigation_polygons` enabled in effective groups), **not** on `clock.membership` (`idleNliClock` clears membership and beats). If the polygons row is off, stay off. **Idle beat source:** the coordinator collects `timeline_minutes` from the **loaded** polygon (and line) features and passes that list into `deriveInvestigationFrame` as `options.storyBeats` (name as implemented). Do not invent a second clock object; do not use empty `clock.beats`. `deriveInvestigationFrame` treats `idle`/`ended` as every `storyBeats` value achieved when those layers are on. Do not feed `futureFeatures` into the line renderer. Unachieved play/pause polygons are omitted from the category source (constraint 4), not opacity-0.

---

## 2. Settlement outlines and names

### Current (after 2026-09-06 Task 5)

- `gis-layer-filter.js` `PROJECTOR_BASE_GIS_LAYERS`: `Tkuma_Area_LIne`, `ישובים`, `שמות_יישובים`, `Locations_Lines`.
- GIS emits `שמות_יישובים` labels via `shouldRenderMapLabelsFromStyle`.
- Breach is a separate overlay `nli-investigation-settlement-impact-outline` (`incidentRed`, width `1.8 × lineWidthMultiplier` → GIS 1.8 / projection 2.16).

### Required (2026-09-07)

**GIS visibility.** Allow these `projector_base` layers on GIS: `Tkuma_Area_LIne` and `ישובים` only. **Drop** `שמות_יישובים` and `Locations_Lines` from `PROJECTOR_BASE_GIS_LAYERS` (temporary mute: names + leader lines off GIS; outlines stay). Keep hiding WMTS/raster, `model_base`, and other projector-only layers (`SEA` stays projection-only unless already GIS-visible). Allowlist ≠ force-on: a disabled remote row for `ישובים` stays off.

**GIS label emission.** Invert the 2026-09-06 GIS label-emission tests that required `projector_base.שמות_יישובים` labels without `applyProjectionHatchPresentation`. GIS must not emit those labels. Projection names/leaders stay on (`keepSettlementNames` unchanged). `*.people_names` still emit on GIS.

**Dim while `playing` or `paused` (surfaces that have the layers):**

- `projector_base.ישובים` (and projection `Locations_Lines` if present): whole-layer opacity **0.28**. The red NLI impact overlay (`nli-investigation-settlement-impact-outline`) is the breach “light up” for outlines. Do not try to join pack `ישובים` OBJECTIDs to the sidecar; they are different datasets.
- Projection `שמות_יישובים`: data-driven `text-opacity` **1** when `cityname` is in the achieved location set, else **0.35**. GIS has no שמות layer, so this paint is a no-op there.

**Name join (authoritative, projection):** `deriveAchievedSettlementOutlineIds` → sidecar `investigation_settlements.geojson` features (`outlineObjectId` + `locations[]`) → each location string matched to `שמות_יישובים` `cityname`. Matching: exact string, or the location with a leading `קיבוץ ` stripped (`קיבוץ ארז` → `ארז`, `קיבוץ זיקים` → `זיקים`). No other fuzzy match. Counted 2026-09-06: 26/29 locations exact; 2 more after prefix strip; **`עין הבשור` has no `cityname`** — stays dim, `console.warn` once. Collision: two outlines mapping to the same `cityname` light that name if **either** is achieved.

**`idle` or `ended`:** orientation layers that exist at opacity 1 (no dim expression). Impact overlays show the complete-story achieved set. The idle coordinator branch in section 1 must keep this overlay mounted.

**Impact outline parity.** Overlay paint uses `NLI_VISUAL_TOKENS.incidentRed`. Line-width is **1.8 on GIS and projection** — do **not** multiply the impact outline by `displayProfile.lineWidthMultiplier`. Category polygon strokes may still use the profile; this lock is the settlement **impact overlay only**.

**Pack `ישובים` outline color.** If hatch presentation makes GIS pack outline `line-color` differ from projection for the same IR stroke, align GIS to the projection pack outline color. Do not join sidecar OBJECTIDs.

---

## 3. Polygon categories, motion, and legend

### Data (counted, not guessed)

File: `otef-interactive/public/processed/layers/nli/investigation_polygons.geojson` (223 features; source GIS copy matches).

| `Notes` (exact string) | Count |
|---|---|
| `מרחב לחימה - קרב` | 109 |
| `מוקד חטיפה` | 97 |
| `שריפה` | 17 |

`NoteType` is `0` on all features. `Name` is the event title (222 unique) and stays explainer chips only.

### Paint

Data-driven from `["get", "Notes"]`. Tokens live in `NLI_VISUAL_TOKENS.polygonCategories` only:

| `Notes` | Fill | Outline | Motion (`motionMode === "full"`) |
|---|---|---|---|
| `מרחב לחימה - קרב` | `#3d9a8c` at 0.55 | `#2a6b62` at 0.95 | Fill opacity 0.45–0.62 over ~4 s; outline uses the same **line-gradient phase step** pattern as completed-route flow (not `line-dashoffset` — MapLibre pack animation dropped that API). Period ~4 s |
| `מוקד חטיפה` | `#e8a4b4` at 0.55 | `#c47388` at 0.95 | Outline width 1.4–2.2 × profile over ~2.8 s; fill 0.50–0.62 |
| `שריפה` | `#d85a1f` at 0.55 | `#a33d12` at 0.95 | Fill opacity 0.42–0.70 over ~1.8 s (no strobe) |

Do **not** reuse `#c31f4f` or `#f5c542` for these fills. `#c31f4f` stays routes, breached settlement overlay, person halo, and alarms’ family. `#f5c542` stays alarms.

This **supersedes** 2026-09-06 battle `#c4a35a` / `#8a7030` and kidnap `#6b2d5b` / `#4a1d3f`.

**Host pack layers:** while the category overlay is mounted, set the layer-manager **host** `nli.investigation_polygons` fill/line layers to `visibility: none` (or an always-false filter). Their lyrx default is orange `(247, 144, 9)` alpha 40 — the ghost this spec deletes. Do not leave them visible under the overlay (play would show every polygon in pack orange; Stop would double-paint). When the overlay is torn down (polygons row off), restore host visibility. Do not `restoreBasePaints` to orange.

`deriveInvestigationFrame().needsNextFrame` must be true while category motion **or** person-glow pulse is running (`motionMode === "full"`), **including `idle`/`ended` and when lines are off**. Today idle RAF is only owned by completed-route flow.

Reduced motion: the table colors above, static, `needsNextFrame` false for polygons.

Appear-at-beat: when a polygon joins the achieved set, snap onto its category layers (no orange intermediate). Lines keep the existing 3200 ms draw-on.

### Legend (required)

**Afternoon lock:** fold into existing `#mapLegend`. Do **not** keep a separate overlay HUD (`#nliInvestigationLegend` / `mountNliInvestigationLegend`). A second legend overlay is **not** required.

- When `nli.investigation_polygons` is enabled, `buildLegendModel` / `legendLayerFromConfig` emit **three polygon items** from `NLI_VISUAL_TOKENS.polygonCategories` + `NLI_LEGEND_SHORT_LABELS` (`קרב` / `חטיפה` / `שריפה`, fills `#3d9a8c` `#e8a4b4` `#d85a1f`).
- Do **not** uniqueValue the hidden orange host pack. Do **not** collapse this layer via `ui.legendLabel` to one English “Investigation polygons” row.
- GIS and projection both render `#mapLegend` via `updateMapLegend`. `buildLegendModel` takes surface `gis` | `projection`. `shouldShowLayerOnGisMap` must **not** strip projector-only layers from the **projection** legend. Three-row expansion happens on both surfaces.
- Remote layer sheet stays one glossary row (`getLayerDisplayLabel` / `nli.investigation_polygons`). Not MapLibre uniqueValue.
- Visible when the polygons row is on (disabled layers are already omitted from `buildLegendModel`); hidden when that row is off.
- Do not invent a fourth category. Unmatched `Notes` stays the gray fallback on the map and is omitted from the legend.

---

## 4. Person search focus

### Current

- GIS `createGisPersonSelection.show`: `flyTo({ zoom: 15, duration: 1600 })`, halo radius 12 fill 0 + 2 px `#c31f4f` stroke, HTML bubble name+location.
- Projection: no person-selection subscriber; table camera never follows GIS.

### Required

Do **not** mount `createGisPersonSelection` on projection. Split as follows:

- **Shared:** `loadPeopleRuntime` / `resolve(pid)` on both maps; a **paint helper** that adds/updates/removes the halo source+layer: circle fill `#c31f4f` opacity 0.25, radius 14 × profile, stroke 2.5, plus a 2.4 s opacity pulse when `motionMode === "full"` (static when reduced). No Popup, no `flyTo` in the helper.
- **GIS:** keep `createGisPersonSelection` + `createGisPersonController` — bubble, `flyTo` zoom **16** (duration unchanged; 0 if reduced motion), pan-off-viewport clear, style.reload remount. **Afternoon lock:** GIS person `flyTo` must set `navigationTravelActive` until map `idle` (same as place travel): report on `move` during travel so the table highlight follows GIS 1:1; skip self-`applyAcceptedViewport` while traveling. Do **not** wire `PROJECTION_LERP_FACTOR` during flyTo. Do not lerp highlight geometry.
- **Projection:** subscribe to person-selection in `projection-main.js`; resolve pid; call the paint helper only. **No** Popup, **no** GIS controller, **no** `flyTo` / camera change.
- Person-glow pulse uses `needsNextFrame` (section 3) even when investigation lines are off.
- Person search to zoom 16 implies GIS `viewport.zoom >= 13`, so the table highlight (section 7) is visible and shrinks around that person. That highlight motion **is** the table-side fly. Keep 400 ms opacity fade only for the zoom-13 gate. Do not empty FC below 13.

---

## 5. Victim names (`nli.people_names`)

### Current (after 2026-09-07 morning)

- Size 8, Regular, halo 0.12, white, `forceVisible`, `text-rotation-alignment: viewport`, `text-rotate: 0`.
- Radial `r = 1.8 + 0.45 * (n - 2)` capped at 4.5, grouped on `round(source_lon, 6)` / `round(source_lat, 6)`.
- Projection **L** tool still uses 15° snap and per-feature `otef_label_rotate_deg` / `angleFromProperties` on שמות. Pack re-prep of 232/names was treated as residual — **afternoon makes it blocking**.

### Required (2026-09-07 afternoon — supersedes viewport-only rotate 0 and 15° per settlement)

- **Type:** size **8**, Regular, halo **0.12**, white. Keep morning radial offsets.
- **Heading:** one shared integer degree for the whole `nli.people_names` symbol layer **and** all projection `שמות_יישובים` labels. GIS `שמות_יישובים` stay muted. Default heading **0**. Snap **1°** (not 15°). `text-rotation-alignment: map` so the projection **L** / `window.ShemotLabelDebug` rotation space still matches the table. Persist one heading in localStorage (bump the key if a per-feature store would shadow it). Export JSON is a **single heading**, not per-citycode `otef_label_rotate_deg`. Per-feature **offsets/locations stay**. GIS `people_names` use the same heading (shared look).
- Do **not** use live per-feature `angleFromProperties` / `otef_label_rotate_deg` as the rotate. This **supersedes** morning viewport-only `text-rotate: 0` as the final heading story.
- **Spread:** keep marker jitter. Radial groups **must** use `round(source_lon, 6)` / `round(source_lat, 6)`, **not** jittered `geometry.coordinates`. For index `i` in a group sorted by `pid`: angle `2π i / n`, offset em `[r * cos(angle), r * sin(angle)]` with `r = 1.8 + 0.45 * (n - 2)` capped at **4.5**. Store `otef_map_text_offset_em` (length-2 numeric array). Style labels set **`offsetArrayProperty: "otef_map_text_offset_em"`**. Do **not** set `offsetEmFromProperties`. Singletons stay `[0, 0]`. `forceVisible` stays **on**.
- Apply IR in `scripts/otef_layer_processing/styles.py` `_apply_people_names_label_ir` (`textRotationAlignment: map`, size 8, halo 0.12, `offsetArrayProperty`). **Pack re-prep is blocking** (afternoon lock §3). Do not hand-edit gitignored geojson.

---

## 6. GIS / projection timeline clocks

### Current

- Both surfaces use clock-only caption hosts (`#nliGisClockHost`, `#nliExplainerHost`).
- CSS clamps `--nli-projection-clock-size` / `--nli-gis-clock-size` override parked `fontPx`.
- Shared caption class uses `background: rgba(12, 16, 22, 0.62)`.
- `clampNliExplainerLayout` min width/height **8**.
- GIS debug: `enableRotation: false`, storage `otef.nliGisClockLayout.v1`.
- Projection storage `otef.nliExplainerLayout.v1`; committed left park is the 2026-09-01 unrotated box.

### Required (2026-09-07; left park afternoon)

- Clock-only caption on **both** hosts: **transparent** background (no `rgba(12,16,22,0.62)` card). Keep white heavy type + text-shadow. Reduce clock-only caption padding so the % box can hug `HH:MM`. Host still uses the existing % layout model; no second layout model.
- Clock font on **both** surfaces is layout **`fontPx`** via `applyNliExplainerLayout` (`host.style.fontSize = ${fontPx}px`; clock rule `font-size: inherit`). Do **not** size the live clock with `--nli-projection-clock-size` or `--nli-gis-clock-size` clamps.
- GIS clock **must rotate**. `installNliExplainerDebug({ enableRotation: true })` on GIS. Rotate handle + `rotateDeg` field. `applyNliExplainerLayout` already writes CSS `rotate`; do **not** strip `rotateDeg` on GIS.
- `clampNliExplainerLayout` min width/height **2** (not 8). `fontPx` clamp 8–64 and `rotateDeg` −180–180 stay.
- Commit `MapProjectionConfig.NLI_EXPLAINER_LAYOUT` to the exact JSON in **Owner lab lock 2026-09-07 afternoon §1** (left park changed; full/right unchanged). Keep projection storage key **`otef.nliExplainerLayout.v2`** (`NLI_EXPLAINER_LAYOUT_STORAGE_KEY`) so lab v1 parks cannot shadow it.
- GIS storage key **`otef.nliGisClockLayout.v2`**. Default stays bottom-center (`NLI_GIS_CLOCK_DEFAULT_LAYOUT`); `rotateDeg: 0` default is fine until the operator parks it. GIS must not read or write the projection key. GIS still has **no** span key, dual-span overlap guards, projection layout merge, or copy/download.
- Activation unchanged: `?nliExplainerDebug=1` / `?ned=1` or **E**. Not a remote-presenter control. Remote timeline transport clock is unchanged.

---

## 7. Projection GIS-viewport highlight

### Current

- White fill 0.05 + line `rgba(255,255,255,0.35)` width 1.
- `viewportToHighlightGeoJSON` returns an **empty** FeatureCollection when `zoom < 13` or full-extent — that **pops**.
- Slideshow uses `setProjectionHighlightVisibility` → layout `visibility: none`.

### Required (2026-09-07)

- Do **not** empty the FeatureCollection when GIS zoom < 13. If bbox/corners are valid, keep writing viewport polygon geometry (current viewport, not a frozen first frame). If inputs are invalid, leave the previous source data (do not `setData` an empty FC).
- Fade with MapLibre `fill-opacity-transition` and `line-opacity-transition` duration **400** ms.
  - Below `highlightMinZoom` (13), or non-finite zoom, or full-extent: fill-opacity **0** and line-opacity **0**.
  - At/above 13 and not full-extent: fill-opacity **0.05**, line-color `rgba(255,255,255,0.35)`, line-opacity **1**.
- Slideshow hide may stay layout `visibility: none`. Do not change Tesuga.
- Person fly-to 16 therefore shows this rectangle (after the fade) and is the table-side “fly.”
- **Afternoon lock:** GIS person `flyTo` is not place `navigationCommand` today, so it never sets `navigationTravelActive`. After fly, GIS `_setViewport` → `applyViewportToMap` (`fitBounds`+`setZoom`) → another moveend → bouncing bbox; projection `setData` every snapshot. Treat person `flyTo` like place travel: `navigationTravelActive` until map `idle`, report on `move` during travel, skip self-`applyAcceptedViewport` while traveling. Do **not** lerp highlight geometry. Do **not** wire `PROJECTION_LERP_FACTOR` during flyTo. 400 ms opacity fade stays only for the zoom-13 gate. Do not empty FC below 13.

---

## 8. Zikim / sea crop (measurement gate)

**Deferred.** No Tesuga / `POST_TY` / `POST_SCALE` / `PROJECTION_SPAN` edits in this follow-up.

### Observed (lab + code, not a number change)

- Zikim is **only on the right eye**.
- `?span=right` in the **browser** already clips Zikim and the sea beside it.
- Older TD **full-span** file still shows that coast.
- `projector_base.SEA` is on in the lab; this is not “layer off.”
- Zikim catalog: ITM `(154669.92, 613156.77)`, WGS84 `(34.5218, 31.6090)`, inside `bounds_polygon`.
- Dual-span config: `PROJECTION_SPAN` in `map-projection-config.js` (right crop `RIGHT_X0=0.4`, `RIGHT_X1=1`, `PRE_SCALE=1.41`, `PRE_ROTATE_DEG=-50`, `POST_TY=-0.049`).

### Required process (when a later owner decision reopens crop)

1. **Measure before any `PROJECTION_SPAN` or `model-bounds` edit.** Use the existing Tesuga helpers in `projection-span-view.js` (`computeTesugaPreT3JumpTo`, `spanVisibleCenterInT3`, `getProjectionSpanRect`) plus `model-bounds.json` — do not invent a second crop space. On `projection.html?span=right`, project Zikim and a sea point ~2–3 km **west** of Zikim into post-Tesuga canvas UV. Record whether each is inside the visible crop rectangle. Repeat `span=left`.
2. Write the UV numbers and screenshots/notes into the implementation record (plan task output). Compare to the older full-span TD file as control.
3. Only then change the **single** implicated parameter (crop fraction, `PRE_TX`/`PRE_TY`, `POST_TY`, or AABB west/north) that the UV evidence supports.
4. Re-measure both eyes. Do not “tune until it looks right” without recording UV.

If UV shows Zikim **already inside** the right visible rect, do not edit Tesuga numbers. Remaining table black is then a **TD exhibit blocker** (not accepted as done). If UV shows a miss, after the gated number change **both** must hold: Zikim and the sea immediately west of it are visible in `span=right` **and** left-eye coverage is unchanged vs the pre-change UV. App-correct / TD-still-black is still an exhibit blocker until TD matches; record it rather than shipping a silent miss.

---

## 9. Archive window close

### Current bug (2026-09-06 Task 11 honesty is necessary but not sufficient)

Lab: remote UI shows closed; Chrome named window `otef-nli-archive` stays open. Cross-origin `close()` often no-ops without throwing — Task 11 reports `unavailable` unless `handle.closed === true`. **Two GIS documents** (two tabs, `:80` vs Vite, localhost vs `127.0.0.1`) each have their own controller/handle. Remote broadcasts close to all `otef_channel` clients; the GIS with `handle === null` emits `unavailable` first; that result wins; a sibling GIS still has the live window.

### Required (2026-09-07)

- Report outcome `closed` **only** when the **same Window handle returned from the successful `navigate()` `window.open`** has `handle.closed === true`. `{ ok: true }` only in that case.
- Close sequence on that handle: `handle.close()`; if still open, try `handle.location.replace("about:blank")` then `close()` again. If still open, report `unavailable` **from that GIS only if it had a handle**.
- **Do not** `window.open("", "otef-nli-archive")` to hunt a lost window.
- Do not null a live handle before `closed` is true. If `navigate()` hits a cross-origin `location.href` throw, keep the handle when it is still a Window and `closed === false`.
- Same-origin GIS instances share `BroadcastChannel("otef-nli-archive")`. A close request fans out so **every live handle in that origin** runs the honesty close sequence. Origin split (localhost vs 127.0.0.1, `:80` vs Vite) can still mean two real named windows — do not invent leases/iframes to merge origins.
- GIS with **no handle** must **not** emit a close result that can beat a sibling’s `closed`. Stay silent, or only emit `unavailable` after a short wait if no sibling reported a close on the channel. A GIS that closed a live handle emits `closed` (honesty).
- Remote: if multiple `archiveWindowResult` payloads share a `requestId`, **`closed` wins over `unavailable`**. A later `closed` must still apply if `unavailable` arrived first for that id.
- Person-selection change still attempts close; same honesty + fan-out rules.
- No iframe, lease, or embedding. Chrome popup allowlist for `http://localhost:80` stays technician setup.

---

## 10. Route 232 (`nli.ציר_232`)

Pack overlay copied from `future_development.ציר_232`. **Not** investigation `nli.lines` (those stay `incidentRed`).

### Required (2026-09-07)

Revert sand `(232,196,120)` / 1.5 pt / alpha 50:

| Constant | Value |
|---|---|
| `ROUTE_232_STROKE_COLOR` | `(135, 62, 35)` (`#873e23`) |
| `ROUTE_232_STROKE_WIDTH_PT` | `2.0` |
| `ROUTE_232_STROKE_ALPHA` | `100` |
| `ROUTE_232_LABEL_FILL` | `(255, 224, 210)` |
| Label halo | keep `(20, 16, 12)` alpha 80 |

Exempt `nli.ציר_232` from `PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE` (`0.3`) so GIS and projection stroke widths match. Invert `test_nli_pack_prep.py` sand assertions and the style-bridge test that currently scales highway 232 on projection.

**Afternoon lock:** pack re-prep is **blocking**, not residual. From `otef-interactive/scripts` with `.venv`, run `nli_pack_prep.py` then `process_layers.py --pack nli --layer ציר_232` and `--layer people_names`. Verify live `public/processed/layers/nli/styles.json` (232 `#873e23` / rgb 135,62,35, opacity 1, width ~2.667px from 2.0pt; people_names size 8, halo 0.12, `offsetArrayProperty`, `textRotationAlignment: map`). Do not `fetch_data --force`. Do not `--no-cache` other packs. Do not commit gitignored geojson/lyrx. Record hashes/values in the task report.

---

## Architecture

| Concern | Where |
|---|---|
| Tokens (colors, opacities, motion periods, person zoom 16, highlight minzoom 13, highlight fade 400 ms) | `nli-investigation-theme.js` |
| Achieved membership | `deriveInvestigationFrame`: `idle`/`ended` ⇒ all polygon beats + all settlement outline ids; play/pause unchanged. Idle coordinator in `maplibre-investigation-timeline.js` must load and render polygons/settlements |
| Polygon category paint/motion | `maplibre-investigation-polygons.js`: one source, three filtered layer pairs; `needsNextFrame` includes polygon motion |
| Category legend | `legend-model-builder.js` three-row expansion into `#mapLegend`; `updateMapLegend` on GIS **and** projection with surface `gis` \| `projection`; delete `mountNliInvestigationLegend` / `#nliInvestigationLegend` overlay |
| Line future overlay removed | `maplibre-investigation-lines.js` + timeline coordinator |
| Settlement dim + GIS allowlist | `gis-layer-filter.js` (`Tkuma_Area_LIne` + `ישובים` only); projection `maplibre-style-bridge.js` label gate for שמות; name opacity via `cityname` ∈ achieved locations on projection |
| Impact outline width | `maplibre-investigation-polygons.js` settlement overlay: 1.8, no `lineWidthMultiplier` |
| Person halo + fly travel | Paint helper in `maplibre-person-selection.js`; GIS keeps `createGisPersonSelection`; projection-main subscribes + helper only (no Popup/`flyTo`). Person `flyTo` sets `navigationTravelActive` until `idle` (`maplibre-viewport-sync.js`). `needsNextFrame` includes glow |
| Name layout + heading | `nli_pack_prep.py` + `styles.py` people_names IR: size 8, halo 0.12, `textRotationAlignment: map`, `offsetArrayProperty`; live one-integer heading via `ShemotLabelDebug` / shared apply (`nli__people_names__labels` + projection `projector_base__שמות_יישובים__labels`); snap 1°; default 0 |
| Clock chrome + GIS rotate + layout v2 | `nli-explainer-overlay.js`, `nli-explainer-debug.js`, `map-projection-config.js` afternoon `NLI_EXPLAINER_LAYOUT` left park, `styles.css` |
| Highlight fade | `viewportToHighlightGeoJSON` keeps geometry; `updateHighlightFromViewport` / `ensureProjectionHighlightLayers` set opacity + 400 ms transition; no bounce after person search |
| Archive close honesty + fan-out | `nli-archive-window.js` `BroadcastChannel("otef-nli-archive")`; remote `handleArchiveResult` closed-wins |
| Route 232 | `nli_pack_prep.py` brown constants; **blocking** re-prep + `process_layers.py` for `ציר_232`; `maplibre-style-bridge.js` hatch-scale exemption |

Display profiles remain scale-only (`lineWidthMultiplier`, `radiusMultiplier`, `textScaleMultiplier`) except the **explicit** impact-outline and `nli.ציר_232` exemptions above.

---

## Error handling

- Unmatched polygon `Notes`: gray fallback, one warn per distinct string; omitted from the legend.
- Person halo: if projection style reloads, remount like GIS `style.load`.
- Archive: `unavailable` if a GIS that **had** a handle cannot close it; a GIS with no handle stays silent so it cannot beat a sibling `closed`. Remote prefers `closed` for the same `requestId`. Lost handle → no `window.open("", name)`.
- Crop: deferred; if a later measurement says “already in rect,” file the note and skip number edits.

---

## Testing

Automated (extend existing suites; TDD in `docs/superpowers/plans/2026-09-07-nli-afternoon-followup.md` for afternoon deltas; morning suites stay):

- Polygons: future not painted during play; `idle` and `ended` paint all; paused current-beat polygons present; `Notes` filters for the three strings; unmatched fallback; `needsNextFrame` true for category motion on idle when `motionMode` is full, false when reduced; host pack fill/line layers `visibility: none` while overlay is mounted; tokens `#3d9a8c` / `#e8a4b4` / `#d85a1f`.
- Lines: no future layer data during play; paused current-beat uses the progress gradient; completed flow on `idle`/`ended` unchanged.
- Settlements: GIS filter allows `Tkuma_Area_LIne` + `ישובים` and **rejects** `שמות_יישובים` + `Locations_Lines`; GIS does not emit שמות labels; projection still emits names/leaders; play dim on layers that exist; impact overlay width 1.8 on GIS and projection profiles; idle keeps impact overlays.
- Person: GIS flyTo zoom 16; person flyTo sets `navigationTravelActive` until `idle` (highlight no bounce); projection paint helper only (no Popup, no flyTo); `needsNextFrame` true for glow when lines off; reduced-motion glow is static; clear selection removes halo on both maps; projection `style.load` remounts halo; dispose removes source/layer.
- Names: style-bridge `text-size` 8, halo 0.12, `text-rotation-alignment` **map**; pack-prep groups on `source_lon`/`source_lat`; `r = 1.8 + 0.45*(n-2)` cap 4.5; one integer heading default 0, snap 1°, applied to `nli.people_names` and projection שמות; live rotate is not per-feature `otef_label_rotate_deg`.
- Clock: transparent clock-only caption; font from `fontPx`; clamp min 2%; GIS `enableRotation: true` + rotate handle/field; committed afternoon `NLI_EXPLAINER_LAYOUT` JSON (left park); storage keys `.v2`; GIS does not read/write projection layout store.
- Legend: three short Hebrew rows inside `#mapLegend` on GIS **and** projection; hidden when polygons row off; no `#nliInvestigationLegend` overlay mount; projection surface does not GIS-filter projector-only layers out of the legend; remote sheet stays one glossary row.
- Highlight: zoom 12 **keeps polygon features**; opacities 0 with 400 ms transition; zoom 13 + not full extent → fill 0.05; slideshow still `visibility: none`; person search does not bounce the bbox.
- Route 232: brown `#873e23`, width 2.0 pt (~2.667px), alpha 100 on **live processed** `styles.json`; projection width not scaled by 0.3.
- Archive: `close()` that no-ops does not emit `closed`; `handle.closed === true` does; lost handle reports `unavailable` (no `window.open("", name)`); BroadcastChannel fan-out closes sibling handles; no-handle GIS does not emit a beating `unavailable`; remote `closed` wins over `unavailable` for the same `requestId`.

Exhibit (required; tests cannot replace). Afternoon plan Task 6 records these gates in the spec/plan (and may add rows to `otef-interactive/docs/nli-exhibit-verification.md`). Do not treat a unit-test pass as exhibit done:

- Clock left park matches afternoon JSON (`leftPct` 47.16458333333333, `topPct` 14.320176309187765); full/right unchanged; `.v2` keys; transparent, `fontPx`, GIS rotate.
- Legend in `#mapLegend` on GIS **and** projection: three rows קרב / חטיפה / שריפה; no second overlay HUD; hides when polygons row is off; remote sheet still one glossary row.
- Route 232 brown `#873e23` on **LIVE** processed `styles.json` (re-prep ran; not residual).
- Highlight: no bounce after person search; keep-geometry + 400 ms fade across zoom 13.
- One shared integer heading (default 0, snap 1°) on people_names + projection שמות; GIS שמות stay muted; dense clusters still readable.
- GIS outlines without settlement names/leaders; projection names/leaders still on.
- Archive close with **two GIS windows** (same origin via BroadcastChannel; note origin split localhost vs 127.0.0.1).
- Crop: still the UV record / TD blocker from §8 (no number edits in this follow-up).

---

## Acceptance checklist

1. During play, no faded future polygons or lines; only achieved/active geometry.
2. Stop shows all polygons at category style and all routes in completed flow. Alarms stay idle/off.
3. GIS shows pack `ישובים` outlines (and Tkuma) without `שמות_יישובים` / `Locations_Lines`; projection keeps names/leaders; dim during play on layers that exist; breached red impact outline is the same width on both maps.
4. Three `Notes` colors (`#3d9a8c` / `#e8a4b4` / `#d85a1f`) + restrained motion, matched on GIS and projection, with three `קרב` / `חטיפה` / `שריפה` rows in `#mapLegend` on both surfaces (no `#nliInvestigationLegend` overlay).
5. Person search: GIS zoom 16, shared glow, GIS bubble only; table highlight moves/shrinks with no bounce after fly; table map does not pan/zoom.
6. Victim names size 8, halo 0.12, one shared integer heading (default 0, snap 1°, `text-rotation-alignment: map`), wider radial offsets, all still visible, matched on GIS and projection. GIS שמות stay muted.
7. GIS and projection clocks are clock-only, transparent, sized from `fontPx`; GIS E-key rotates/moves/resizes; afternoon left park JSON + `.v2` keys (full/right unchanged).
8. Table GIS highlight keeps geometry below zoom 13 and fades opacity (~400 ms); gentler paint at ≥ 13; person flyTo uses `navigationTravelActive` until idle.
9. Crop: no Tesuga edits in this pass; prior UV record / TD blocker still stands.
10. Remote never shows closed while `otef-nli-archive` is still open **because a second GIS reported unavailable first**. Lost handle → `unavailable` or silent, not a false `closed`. Never `window.open("", name)`.
11. `nli.ציר_232` is brown `#873e23` on **live processed** styles, not sand, same stroke width on GIS and projection. Pack re-prep of 232 and people_names is blocking, not residual.
