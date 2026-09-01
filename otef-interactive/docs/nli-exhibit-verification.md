# NLI exhibit verification

Use this checklist on the normal exhibit browser and physical display. Unit
tests cannot prove popup permission, window placement, foreground focus,
cross-origin page load, route-dash visibility, or label readability. No
programmatic check can claim that the cross-origin NLI document loaded.

Automated checks establish local handle acquisition and navigation assignment.
They do not replace the runtime and exhibit gates below.

## Recorded automated evidence

The following results are automated evidence. The R4 report records the fresh
commands and outcomes:

- Promoted NLI release validation passed.
- Root's final focused and full frontend test counts, build result, and Django
  result are pending. Record them only after the final verification run.
- The running nginx deployment returned `200` for the GIS, projection, remote,
  and six NLI runtime artifact endpoints.
- Local tests cover People search, selection recovery, on-demand named-window
  navigation, result-driven remote state, timeout cancellation, **Back to map**,
  unavailable reporting, and selection clearing.
- No current normal-browser result proves popup permission, named-window
  placement, cross-origin load, or the remote return flow. Keep those outcomes
  as manual gates.
- Automated GIS popup observation was inconclusive because the isolated Edge
  session did not complete MapLibre/WebGL initialization.

## Required integration and visual checks

Run these checks against the current Docker/nginx deployment. Record the
browser, display arrangement, console result, and outcome in the result record.

- [ ] Confirm `http://localhost/otef-interactive/`,
  `http://localhost/otef-interactive/projection.html`, and
  `http://localhost/otef-interactive/remote-controller.html` return `200`.
- [ ] Confirm the GIS dark basemap uses the keyless OpenFreeMap Dark style and
  Hebrew labels shape and remain legible. Record any console error.
- [ ] With the timeline off, during playback, or after **Stop**, confirm every
  visible route remains red. Future and revealing routes use the solid red
  route family, and the active reveal follows its reviewed direction.
- [ ] After completion, confirm every route keeps a solid red carrier and adds
  a black, line-based dashed overlay over the carrier that flows across its full
  geometry in the reviewed direction.
- [ ] Confirm completed route motion remains visible through **Pause** and
  **End**, and that timeline-off and post-**Stop** idle states animate every
  visible route as completed. Confirm reduced-motion mode uses static
  directional dashes.
- [ ] Confirm a polygon-only beat activates at its authored beat, while a
  polygon sharing a route beat waits until that route reveal completes. Confirm
  route geometry alone never activates an investigation polygon.
- [ ] Confirm settlement outlines activate through both paths: a revealing
  route reaches or crosses the boundary, and an associated investigation
  polygon turns red.
- [ ] In remote **Navigation**, select a person and confirm the GIS animates
  to zoom `15` over `1600 ms`, shows one halo and name/location bubble, and
  keeps the suggestions closed after acknowledgement.
- [ ] In the Hebrew remote, confirm the archive action reads
  `פתיחת ארכיון הספרייה`.
- [ ] In projection, confirm the NLI timeline caption shows only the readable
  `HH:MM` story clock. Confirm the remote **Presentation** tab, slideshow, and
  `presentationActive` behavior remain unchanged.
- [ ] Confirm the projection `left` span uses the 2026-09-01 lab clock park
  `48.88333333333333, 26.175280590197644, 13.572916666666666, 11.732162458836443, 15, 0`
  for `leftPct, topPct, widthPct, heightPct, fontPx, rotateDeg`.

## Technician browser setup

Before the exhibit session, run the following command from the repository root
in Windows PowerShell as administrator. It installs a machine-wide Chrome popup
allowlist for exactly `http://localhost:80`:

```powershell
& '.\otef-interactive\scripts\configure-chrome-popup-policy.ps1' -Mode Install
```

Running the script without `-Mode Install` only reports policy status. This
one-time allowlist is technician setup. The presenter uses only the remote
controller and never activates the archive from the GIS.

## Required manual window check

Record the browser, operating mode, display arrangement, and result.

- [ ] Open the GIS and remote against the running CityScope deployment.
- [ ] In remote **Navigation**, switch to **People** and select a person with an
  NLI record.
- [ ] Confirm the GIS shows one halo and a name/location bubble.
- [ ] Press **Open NLI record**.
- [ ] Confirm GIS opens or reuses one named top-level `otef-nli-archive` window
  with the validated record URL.
- [ ] Confirm the remote remains pending until GIS emits the matching
  `navigation_attempted` result. Treat that result as local handle acquisition
  and navigation assignment only, not as proof of cross-origin page load.
- [ ] Confirm the NLI record becomes visible on the intended display in the
  normal exhibit browser.
- [ ] Confirm the remote shows **Back to map** only after that matching result.
- [ ] Press **Back to map** and confirm the archive closes and the GIS regains
  focus or is immediately available.
- [ ] Exercise an unavailable or closed context, or let an open request reach
  its timeout. Confirm the pending request is cancelled, the remote returns to
  a usable open or error state, and a later **Open NLI record** request can
  retry after the context becomes available.
- [ ] After returning to the map, select another person or settlement. Confirm
  the previous archive action is gone and the new selection state is correct.
- [ ] Select a person without a linked record. Confirm **No NLI record found**
  appears and no window opens.
- [ ] Close the archive manually, then press **Back to map**. Confirm the action
  is safe and restores the remote Navigation content.

### Result record

- Date and time:
- Browser and version:
- Browser mode or kiosk flags:
- GIS display arrangement:
- Integration endpoints and console errors:
- Timeline route state and flowing-dash direction: pass / fail
- Pause, End, and Stop lifecycle: pass / fail
- Polygon beat sequencing: pass / fail
- Settlement route-boundary trigger: pass / fail
- Settlement investigation-polygon trigger: pass / fail
- Dark basemap and Hebrew labels: pass / fail
- Person zoom and dropdown closure: pass / fail
- Projection clock-only caption and Presentation isolation: pass / fail
- Remote state follows matching GIS result: pass / fail
- Timeout cancellation: pass / fail
- Open retry after unavailable or close: pass / fail
- Popup permission enabled: yes / no
- Named window reused: pass / fail
- Opened on intended display: pass / fail
- **Back to map**: pass / fail
- Selection-change cleanup: pass / fail
- Missing-record behavior: pass / fail
- Manual-close recovery: pass / fail
- Programmatic cross-origin load claim: none (required)
- `navigation_attempted` treated as load proof: no (required)
- Interleaved revision-4 HTTP / revision-5 WebSocket retry: pass / fail
- Notes:

## Later exhibit acceptance

These checks complete acceptance after the integration and window checks:

- Run the full timeline interaction matrix on GIS and projection together.
- Review route direction, red carrier and dash contrast, settlement outlines,
  alarm scaling/ripple, bubble legibility, halo visibility, clock placement,
  and reduced motion on the exhibit hardware.
- Capture at least 1,000 dense-state scheduler samples and confirm the 95th
  percentile is at or below 8 ms.
- Confirm **Stop** and disposal leave no animation frame, timer, duplicate
  source, or duplicate layer.
