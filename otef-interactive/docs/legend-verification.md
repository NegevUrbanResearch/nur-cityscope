# Legend verification — 2026-09-21

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
