# Legend verification — 2026-09-21

## Current behavior (checked against code on 2026-10-01)

- GIS and projection render the same generated, bilingual legend in the
  existing `#mapLegend` element. The remote language setting picks Hebrew or
  English. GIS retains its existing paging and dwell behavior when the content
  does not fit its two-row layout.
- Projection shows the complete generated legend on one page, including entries
  that would otherwise appear on later GIS pages. It fits the saved panel by
  choosing equal-width columns and reducing text, symbols, strokes, dashes, and
  spacing together as needed. Auto evaluates one to three columns and prefers
  fewer columns when fit is equal; an authored choice can fix the count at one,
  two, or three. Labels wrap where possible, and an item that cannot fit a
  column at the requested size contributes to reducing the overall scale.
- The saved projection font size is a maximum from 8 to 64 px. Fitting can
  render it smaller, but never larger. Resizing the panel recalculates the fit
  without changing that saved maximum.
- Neither surface draws pack headings. The NLI pack never had one, and the
  other pack headings were removed in `a10ef98`.
- Projection legend placement and fit options are edited in the Projection
  Clock / Legend nodes of `projection-config.html`. The legend node exposes
  Auto / 1 / 2 / 3 columns and labels font size as a maximum; page and dwell
  controls are hidden for projection. The projection page has no E key: the old
  E-key clock and legend editors were retired in `58c7a29`. The right span keeps
  the legend hidden.
- Automated tests and the production build cover the current planner and
  renderer. The updated projection layout still needs review in the normal
  browser and on the exhibit display; no new visual acceptance is recorded
  here.

## 2026-09-21 verification record

This record predates the changes above. Its pack headings, tall projection
panel, and E-key editor observations no longer describe the shipped legend.

Verified through nginx at:

- `http://localhost/otef-interactive/`
- `http://localhost/otef-interactive/projection.html`
- `http://localhost/otef-interactive/remote-controller.html`

## Automated checks

- Required frontend selection: 12 files, 87 tests passed.
- Frontend production build: 187 modules transformed; build completed.
- Backend API selection: 11 tests passed after `--noinput` recreated a stale
  `test_nur_db`. The first run was blocked because that database already
  existed; `--keepdb` exposed obsolete columns in that stale test schema.
- Migration preflight: backend migration `0023_otefviewportstate_legend_settings`
  is applied.
- `git diff --check`: recorded in the Task 5 report.

## Browser observations

GIS in Hebrew rendered a content-sized rail at
`left=18, top=638.97, width=491.67, height=247.03` in the browser viewport.
It did not intersect the visible clock. One pack heading was emitted on each
page; the active National Library page contained six meanings, only the
three-item investigation polygon layer had a subtitle, and all six labels were
Hebrew with no mixed-script label. The visible `1 / 2` controls advanced to the
second page, which showed the projector-base meanings without clipping.

Projection was rechecked with a 1920×1080 device viewport after the production
build. With no saved projection slot, the panel was placed beside the clock at
`left=981.53, top=444.56, width=460.80, height=626.39`; its bounds remained
inside the page and did not intersect the clock. The existing E key showed both
the clock editor and legend editor, marked the legend as editing, and hid both
edit modes on the next E press. No competing key handler or clock restyle was
added.

The remote English action stayed `Connected`, changed the authoritative
setting to `en`, and switched both GIS and projection legends to LTR English.
Cold reload of all three URLs hydrated English from the server. The exhibit was
then restored to its original Hebrew setting. Current live data exposed no
eligible authored group summary controls, as intended; the synthetic authored
group behavior and persistence are covered by integration tests.

NLI categories, mixed packs, paging, Hebrew/English switching, reload
persistence, default projection placement, and editor coupling were observed.
Greens and municipality packs were not active in the current server layer
state, so no claim is made about a live screenshot of those inactive packs;
their model behavior remains covered by the focused tests. Physical
TouchDesigner screens and warp were not available to this browser session. If
the correctly placed mid-map panel is still clipped on screens 2 or 3, that is
a hardware/TD calibration limit; no TouchDesigner project was changed.
