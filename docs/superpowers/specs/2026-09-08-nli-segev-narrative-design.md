# NLI Segev Narrative and Satellite Variants Design

**Date:** 2026-09-08

**Status:** Approved for implementation planning

**Scope:** OTEF Interactive remote, GIS, projection, and shared Django state

## Summary

Add a reusable NLI narrative mode and use it for the first narrative, `segev` / `משפחת שגב`. Activating the narrative from the NLI pack creates a synchronized presentation scene: the GIS changes to black-and-white satellite imagery, flies to the Segev family house at zoom 18, the GIS and projection show a dedicated `משפחת שגב` marker, and all settlements except Be'eri are visually dimmed. The remote can then open and close a public Canva presentation embedded edge-to-edge over the GIS.

Closing the Canva presentation does not end the narrative. The narrative scene remains active until the operator toggles `משפחת שגב` off or selects another narrative. Exiting the narrative closes the presentation, removes narrative-only visuals, restores the dark basemap, and flies the GIS to the configured OTEF-bounds center at zoom 10.

This feature also expands the existing Satellite basemap choice into Color and B&W variants. Both variants use the same Esri World Imagery tiles; B&W is a MapLibre raster-paint treatment rather than a second imagery source.

## Goals

- Introduce a small, extensible narrative model without turning narratives into timeline beats or person selections.
- Make `משפחת שגב` a one-tap, repeatable exhibit scene controlled from the NLI pack.
- Keep the GIS and projection synchronized during narrative entry and exit.
- Present the supplied Canva story inside the GIS kiosk surface with deterministic remote open and close controls.
- Preserve the narrative map scene when the Canva overlay closes.
- Add a manually selectable B&W variant beneath the existing Satellite basemap control.

## Non-goals

- Authoring narratives from the remote UI.
- A general-purpose external URL or iframe launcher.
- Automatic sequencing of multiple narratives.
- Reusing or exposing Mila Cohen's victim selection, popup, or NLI archive action.
- Changing NLI investigation timeline semantics, beats, or data.
- Changing the projection camera; the projection continues to visualize the GIS viewport through its existing highlight.
- Restoring an arbitrary pre-narrative viewport or basemap. Narrative exit has one deterministic destination: dark basemap, OTEF center, zoom 10.
- Guaranteeing that cross-origin Canva content loaded successfully; the application can know that the iframe was mounted, but cannot inspect Canva's document.

## Approved Narrative Definition

The first narrative is an authored registry entry, not a lookup by mutable display name:

```js
{
  id: "segev",
  label: "משפחת שגב",
  center: [34.48647925700004, 31.422958191000077],
  zoom: 18,
  basemap: "satellite_bw",
  focusSettlement: "בארי",
  focusSettlementOutlineId: 19,
  presentationUrl:
    "https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed",
}
```

The coordinate is the point currently represented by PID `60` / `כהן מילה`. PID 60 is provenance only. Runtime narrative behavior must use the authored coordinate and must not activate person selection.

The narrative exit scene is:

```js
{
  center: "configured OTEF bounds center",
  zoom: 10,
  basemap: "dark",
}
```

The GIS resolves the exit center from the configured OTEF bounds, falling back to `[34.5, 31.4]` only when no valid bounds exist. Kiosk acceptance must verify that this center at zoom 10 shows the complete required OTEF extent.

## Operator Experience

### Basemap selection

The existing first-level control remains `Regular | Satellite | Dark`. Satellite gains a disclosure indicator and an anchored floating selector:

- Selecting Satellite toggles a `Color | B&W` popover beneath that button without changing the current basemap.
- The popover overlays the panel; it never creates a second layout row or changes the control's height.
- Selecting Color or B&W changes the shared basemap and immediately closes the popover.
- Clicking outside, pressing Escape, leaving the tab, losing connection, or entering a narrative closes it.
- Satellite appears active for both satellite variants, but active state alone never opens the popover.
- The popover is clamped within the basemap control on narrow screens.
- During an active narrative, the basemap selector is disabled because the narrative owns the B&W satellite scene.

The Hebrew variant labels are `צבע` and `שחור־לבן`; English labels are `Color` and `B&W`.

### Narrative controls

When the NLI pack is selected, the timeline remains anchored to the bottom of the panel, as it is today. A compact full-width `נרטיבים` row is added immediately above the timeline inside the same bottom dock, using the open space between the NLI layer tiles and timeline. The rendered order from top to bottom is therefore NLI layer tiles, narrative controls, timeline controls. The narrative row does not push the timeline away from the bottom navigation. Its initial content is one toggle button, `משפחת שגב`. On short screens the layer area scrolls above the enlarged bottom dock; the narrative and timeline controls remain visible and do not introduce horizontal page overflow.

- Inactive: pressing `משפחת שגב` activates the narrative.
- Active: the button remains visibly selected and exposes a presentation button.
- Presentation closed: the secondary button reads `פתח מצגת`.
- Presentation open: it reads `סגור מצגת`.
- Pressing the selected `משפחת שגב` button again exits the narrative.
- Selecting another narrative in the future replaces the active narrative directly; it does not pass through the default exit camera between narratives.

Narrative activation is unavailable while the projection slideshow is active, matching the existing NLI timeline ownership guard. While a narrative is active, person selection stays disabled; timeline playback remains available and does not move the GIS camera. Layer visibility remains unchanged.

### Narrative activation

Activation is one authoritative transition, not a sequence of unrelated optimistic patches:

1. Stop the NLI clock at `idle`.
2. Clear any person selection and close any NLI archive presentation.
3. Set the shared basemap to `satellite_bw`.
4. Set narrative state to active with the `segev` identifier and a new scene revision.
5. On the GIS, fly to the authored center at zoom 18.
6. Publish normal GIS viewport snapshots during the camera move so the projection highlight follows the house.
7. Add the narrative marker and label on GIS and projection.
8. Dim non-Be'eri settlement context while keeping Be'eri emphasized.

The map scene becomes active before the operator opens Canva.

### Canva presentation

Opening the presentation is an ephemeral, correlated command accepted only while the Segev narrative is active. It does not mutate durable narrative state. The GIS mounts an iframe over its map container using the allowlisted URL from the local narrative registry, then reports `opened`, `closed`, or `unavailable` for the matching request. The URL is never accepted from a remote payload or server state.

The overlay:

- Covers the complete GIS viewport and therefore appears edge-to-edge in kiosk mode.
- Uses an iframe with a descriptive title, `allow="fullscreen"`, and `allowfullscreen`.
- Does not reproduce the generic Canva embed wrapper's margins, rounded corners, shadow, or attribution link.
- Sits above all GIS controls and narrative markers while open.
- Is absent from the projection surface.
- Uses `referrerpolicy="no-referrer"`; it is not sandboxed because Canva's supported embed requires its own scripts and fullscreen behavior.
- Can be closed from the remote or with Escape on the GIS as an emergency local control.

The remote is the normal close control. Closing the presentation removes the iframe and returns the remote button to `פתח מצגת`; it does not change camera, basemap, marker, projection focus, or settlement emphasis. Presentation-open status and Canva slide progress do not survive a GIS reload: the iframe starts closed after reload and reopening starts Canva from its own default view.

If the narrative is exited or replaced while its presentation is open, the presentation closes as part of that transition.

### Narrative exit

Toggling `משפחת שגב` off performs one authoritative exit transition:

1. Close any presentation and set the narrative inactive with a new scene revision.
2. Remove the narrative marker and focused-settlement paint override on GIS and projection.
3. Restore all settlement context to its normal non-narrative paint.
4. Set the shared basemap to `dark`.
5. Fly the GIS to the configured OTEF-bounds center at zoom 10, using `[34.5, 31.4]` only as a fallback.
6. Publish the exit camera movement through normal viewport synchronization.

The investigation clock is left where the operator left it. No prior victim selection, archive, basemap, or viewport is restored.

## State Model

Narrative mode is persisted alongside the other shared OTEF state so reconnecting remote, GIS, or projection clients converge on the same scene:

```js
{
  id: null | "segev",
  transition: "initial" | "enter" | "exit" | "replace",
  revision: 0,
}
```

Rules:

- Revision zero normalizes to `{ id: null, transition: "initial", revision: 0 }`.
- Only identifiers in the local narrative registry are accepted.
- Every accepted state transition increments `revision` once.
- A stale expected revision is rejected instead of overwriting a newer operator action.
- Canva URLs, coordinates, labels, zoom values, and settlement identifiers never travel in writable state. Clients resolve the trusted definition by `id`.
- `expectedRevision` is required on every narrative transition command.
- Narrative activation, clock stop, person clear, basemap change, and narrative state update occur under one row lock in one backend transaction.
- Narrative exit and dark-basemap restoration occur in one backend transaction.
- Presentation open/close is ephemeral and does not increment the narrative revision.

The backend captures one post-transition scene snapshot while holding the lock and broadcasts it after commit as one `otef_narrative_scene_changed` event containing a shared `sceneRevision`, normalized narrative state, basemap, investigation clock, and person selection. OTEFDataContext installs all values before notifying any subscribers, so clients cannot render a half-entered scene. The initiating command response contains the same snapshot because same-source WebSocket events may be ignored.

Initial REST state includes `narrative_state`. Each GIS applies an `enter`, `replace`, or `exit` camera directive once per narrative revision and records the handled revision in session storage. Revision-zero inactive hydration never moves the camera; repeated snapshots and presentation commands never refly. An active late joiner enters the authored scene, and an inactive late joiner applies the last exit directive once for that browser session. Ordinary manual pan/zoom after that directive remains allowed.

## Component Boundaries

### Shared narrative model

A focused shared module owns:

- The immutable narrative registry.
- Empty-state and normalization helpers.
- Active-state predicates.
- Trusted lookup of `segev` presentation and scene properties.

It has no DOM, MapLibre, network, or OTEFDataContext dependencies.

### Remote narrative controls

A focused remote module renders the NLI narrative row, interprets delegated button clicks, and derives disabled/selected labels from shared state plus ephemeral presentation command results. `LayerSheetController` supplies the current narrative state and existing slideshow/clock guards but does not absorb the narrative state machine.

### GIS narrative scene controller

A GIS controller consumes normalized narrative state and owns:

- Entry and exit camera travel.
- Narrative marker lifecycle across MapLibre style reloads.
- GIS settlement-focus paint.
- Canva overlay lifecycle.
- Suppression and cleanup of person visuals while active.
- Idempotent closure of the existing NLI archive window on narrative entry, replacement, and exit.

It delegates camera reporting to the existing viewport synchronization seam and delegates basemap style reload recovery to the existing GIS style lifecycle.

### Projection narrative controller

A projection controller consumes the same state and owns only narrative marker/label and settlement-focus paint. Projection focus continues to follow GIS viewport state through the existing projection highlight path. The projection-only marker profile is intentionally compact (`haloRadius: 6`, `haloStrokeWidth: 1.5`, `textSize: 11`, `textHaloWidth: 1.1`); the GIS profile remains unchanged.

### Canva overlay

A small GIS-only presentation component mounts and removes the allowlisted iframe. It accepts a trusted narrative definition, not an arbitrary URL. It is idempotent across repeated commands and provides a disposer for GIS teardown. MapLibre style reloads must leave an already-mounted iframe node untouched so presentation progress is not reset.

### Backend transition service

A focused backend module normalizes narrative state and applies required-revision transitions to a locked `OTEFViewportState`. The backend owns only the accepted narrative ID allowlist and transition rules; the frontend registry owns display text, coordinates, zoom, basemap scene, settlement keys, and Canva URL. A contract test ensures both sides accept the same ID set. The view layer handles request parsing, captured scene broadcast scheduling, and response serialization.

## Rendering Details

The narrative marker uses dedicated MapLibre source and layer IDs, separate from `otef-person-selection`. It consists of a visible point/halo and a Hebrew symbol label. It is non-interactive: clicking it does not show a popup or change person selection.

Both GIS and projection display `משפחת שגב`. Display-specific sizes may differ through named profile values, but source coordinate and label text are identical.

Narrative settlement focus extends the existing settlement-orientation paint helper with an explicit focus mode. In that mode:

- Be'eri geometry remains at normal emphasis by matching `OBJECTID === 19`; Be'eri labels remain at normal emphasis by matching `cityname === "בארי"`.
- Other settlement geometry and labels use the existing timeline dimmed-opacity tokens.
- `Locations_Lines` has no reliable settlement key and remains unchanged in narrative mode.
- Exiting or replacing the narrative restores the host layers' prior/normal paint expressions.
- Narrative focus wins over idle timeline paint while active.

Hidden settlement layers remain hidden. The narrative does not mutate persisted layer visibility. The narrative-specific Be'eri outline is rendered from accepted investigation-settlement outline ID 19 so the focus remains visible even if an ordinary settlement layer is hidden; all mounted non-Be'eri settlement context is dimmed.

## Interaction Ownership and Conflicts

- Projection slideshow owns presentation mode globally; narrative activation is disabled/rejected while it runs, and slideshow Start is disabled/rejected while a narrative is active.
- Narrative mode owns GIS camera target, basemap, person-selection suppression, narrative marker, and settlement focus.
- Person-selection commands stay disabled/rejected while a narrative is active; timeline Play/Pause/Stop/Loop/step/scrub remain available; clock changes do not fly the GIS camera.
- Generic basemap changes are disabled in the remote and rejected by the backend while a narrative is active.
- Narrative mode does not own ordinary NLI layer toggles.
- Manual pan and zoom are allowed after the entry flight. They update the projection highlight normally and do not end the narrative.
- Style reloads caused by basemap changes use a generation-aware coordinator: base style, host/curated layers, timeline idle visuals with narrative focus input, then narrative marker/outline brought forward. Stale generations do no work. The DOM-based Canva overlay is not part of style reload and remains mounted unchanged.

## Failure Handling

- Unsupported basemap or narrative identifiers receive a 400 response and do not mutate state.
- Stale narrative revisions receive a 409 response containing the current normalized state.
- A presentation-open request with no active narrative receives a 409 response.
- A narrative activation request during projection slideshow receives a 409 response.
- A slideshow Start, generic basemap change, or person selection while narrative is active receives a 409 response from a row-locked check. Clock PATCH is allowed.
- Remote controls remain tied to acknowledged/shared state; failed transitions clear optimistic UI and render the latest server state.
- The GIS treats repeated narrative snapshots and style-load events idempotently.
- If the Canva frame cannot display its content, a loading/failure shell remains locally closable with Escape and the remote can retry or close it. Cross-origin Canva load success is a manual exhibit-browser acceptance item.

## Accessibility and Localization

- All new remote strings exist in Hebrew and English.
- Narrative and presentation controls are native buttons with `aria-pressed` for the narrative toggle and state-specific accessible labels for the presentation toggle.
- Disabled ownership states use both the `disabled` property and explanatory localized text already used by NLI presentation guards.
- The iframe has the title `סיפורה של משפחת שגב – קיבוץ בארי`.
- Focus-visible styles match existing remote controls.

## Testing Strategy

Automated coverage must include:

- Basemap normalization and backend validation for `satellite_bw`.
- B&W MapLibre style reuse of the Esri source with `raster-saturation: -1`.
- Parent/variant basemap UI expansion, selected state, localization, accessibility, and narrative-disabled behavior.
- Narrative registry normalization and rejection of untrusted identifiers.
- Backend migration, serialization, atomic enter/exit transitions, required revision conflict handling, reciprocal ownership guards, captured scene responses, and WebSocket broadcasts.
- OTEFDataContext bootstrap, subscription, action, and reconnect behavior for narrative state.
- Remote narrative rendering and delegated actions.
- GIS entry/exit camera calls at the exact centers and zooms, viewport travel reporting, marker idempotence, style-reload recovery, and person-popup suppression.
- Projection narrative label rendering and cleanup.
- Be'eri-only settlement emphasis and paint restoration.
- Ephemeral Canva command/result correlation, iframe URL allowlisting, edge-to-edge mount, Escape/remote close, style-reload survival, reload-closed behavior, and teardown.
- End-to-end contract checks that the NLI sheet owns the controls and the projection does not mount the Canva iframe.

Manual kiosk acceptance must confirm:

- Esri imagery is available at the house through zoom 18 and no zoom-19 request is needed.
- B&W imagery gives sufficient contrast with NLI layers on the GIS display.
- `משפחת שגב` is legible on GIS and physical projection.
- Be'eri is clearly distinguished from dimmed settlements on both surfaces.
- Canva loads in presentation view without login, fills the GIS screen, advances correctly, and closes from the remote.
- Closing Canva leaves the active narrative scene unchanged.
- Toggling the narrative off returns to dark, configured OTEF-bounds center at zoom 10 and fits the required extent on the kiosk aspect ratio.

## Acceptance Criteria

- The remote exposes Color and B&W under Satellite and both synchronize with GIS.
- Activating `משפחת שגב` always reaches the exact authored point at zoom 18 on B&W satellite imagery.
- No Mila Cohen victim popup, victim label, selected-person state, or archive affordance appears because of narrative activation.
- GIS and projection both show `משפחת שגב` at the narrative coordinate.
- Projection highlight follows the GIS house viewport through existing viewport synchronization.
- Be'eri remains emphasized while all other settlement context is dimmed.
- Canva opens only from the active narrative, uses the supplied `?embed` URL, and appears only on GIS.
- Closing Canva preserves every narrative map visual and state.
- Toggling the narrative off closes Canva, removes narrative visuals, restores normal settlement paint, selects Dark, and flies to zoom 10 centered on the whole OTEF.
- Refreshing or reconnecting any surface converges on durable narrative scene state; Canva presentation state intentionally resets closed.
