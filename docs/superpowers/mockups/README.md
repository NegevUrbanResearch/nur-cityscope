# OTEF Remote — Task 2 visual mockups

**Purpose:** Reviewable, static-only artifacts for the 2026-04-22 remote redesign plan (Task 2: Navigation / Layers / Workshop), aligned with `otef-interactive/frontend/DESIGN.md`. No app wiring; open in a browser.

| File | Role |
|------|------|
| `otef-remote-mockup.html` | One page: **Navigation** (single phone), **Layers** (wider block with **two** adjacent phone shells — pack overview + focused pack), **Workshop** (single phone). Frames sit side-by-side when the viewport is wide and wrap on narrow screens. |
| `otef-remote-layers-mockups.html` | **Hub** that embeds the chosen **Layers** mockup (**Variant C**) in one iframe; intro links to the UX follow-up plan. Open from the `mockups/` folder so sibling relative paths resolve. |
| `otef-remote-layers-variant-c.html` | **Variant C (chosen)** — **Sharpened** static comp: horizontal **pack strip** (edge fades, **no** visible scrollbar), **responsive layer tile grid**, **one bulk visibility toggle**, tile-level **animation** control, **per-pack + header counts**, **RTL + LTR** shells. Exploratory variants **A** and **B** were removed after selection. |

**Layers shell follow-up (2026-04-22):** UX follow-up plan: [`../plans/2026-04-22-otef-remote-ux-followup.md`](../plans/2026-04-22-otef-remote-ux-followup.md) (Variant **C** + hub above).

## What each screen demonstrates

1. **Navigation** — Terracotta/Negev shell: compact header (title, **Hebrew | EN** locale toggle) and a **connection lamp only** (green dot; red reserved for offline — see *Grounding*). **Map/table context is a thin sliver; the primary content is the D-pad, joystick, and zoom block** (same family of controls as the current main remote controller), scaled for one hand. **No layer UI** here. **Table switcher is not shown in these mockups** (implementation still uses `#table-switcher` in the app — omitted here for visual focus).

2. **Layers (two phones)** — Same **compact header** as other tabs (lamp + locale). Represented as **two static states next to each other** (no JS):
   - **Task 6 / behavior:** **Overview → focused-pack drill-in** is the UX equivalent of the prior in-list **group expand/collapse** (same grouping/toggles/actions; only the navigation shell changes).
   - **Overview phone:** **All packs at a glance** — compact tiles; this iteration stresses **no endless single-column scroll of every layer** (overview + focused states). If tiles exceed the viewport, **bounded scroll inside the Layers panel** is expected — do not read the comp as “never scroll.” Each tile shows **how many layers are active in that pack** (illustrative counts), a **pack master** on/off toggle, and a **separate open/drill** control (not the same action as master).
   - **Focused phone:** Full **single-pack** view after “opening” a pack (example: **זרימה**). **Back** affordance to return to the overview list. **Pack-level Flow** (for flow packs) stays in the **header**; rows show **visibility** toggles and **per-row animation** only where applicable — **non-flow** focused packs are **visibility-only** (no Flow header cluster, no animation column). Example rows show **mixed** animation (one on, one off). **No** noisy מעובד / אוצרות / raw **id** badges; a small **flow-category** indicator (e.g. זרם) is allowed when it clarifies the row. Merged / multi-id semantics stay in **short, human copy** when useful.

3. **Workshop (סדנה)** — Renamed from “Curation”; **English** tab label: **workshop** (EN toggle / mirrored layout). **Same** functional intent as today: same-origin `curation.html?embed=1` surface, **parent** owns Supabase/heartbeat, embedded document **no extra logic**. The frame is **visually refreshed** (intro copy, chips) but does **not** claim new product capabilities.

## Grounding (from layer-scheme / runtime analysis — documentation only)

- **Packs** reflect **effective layer groups in runtime**; they are not a fixed list in this file.
- **Curated** paths can add **special merge / handling**; treat those as “same data model, different rules,” not a second product.
- **One row** can map to **multiple full layer ids**; counts and master toggles may aggregate accordingly.
- **Animation** toggles are **not** the same as **visibility** toggles (when a layer has animation at all).
- **Connection UI** in the mockup is intentionally minimal: a **lamp** only (green = connected; for offline, use a red treatment — CSS hook `status-pip.is-off` exists for future static comps).
- **Table switcher** is **hidden in mockups**; the implementation contract in `remote-controller` / `table-switcher.js` is unchanged in code and should stay documented in the main plan, not in this file.

## Implementation targets (mockup vs. app)

- **Bottom tabs:** `DESIGN.md` lists `spacing.touch` **56px** as the primary hit target. The mockup uses `min-height` / `min-width: 56px` on tab buttons (bar can stay ~64px tall per token). If production differs slightly, keep **≥44px** minimum accessible target and prefer **56px** where layout allows.

## Task 2 plan checklist (mapping)

- **2.1** — Three frame groups: **Navigation** (controller-first, no layers, no table switcher in comp), **Layers** (dual-phone: overview + focused), **Workshop** (embed surface). **Consistent** compact header; Hebrew default. **Curation** naming retired in the mockup; **workshop** / **סדנה** used in labels and README.
- **2.2** — Layers: **pack master** separate from **open/drill**; **pack-level Flow** on focused flow packs vs **per-row** animation (conditional — omit for non-flow packs); **mixed** row animation example; **active counts** on overview tiles + global total in title row; **no** noisy processed/אוצרות/id badges; **flow-category** chip OK when relevant; mobile-first Negev styling.
- **2.3** — Navigation and Workshop show **layout / chrome / one-hand** intent without matching Layers density.

**Review:** Open `otef-remote-mockup.html` locally, narrow or zoom the window to approximate phone width, and compare to `docs/superpowers/plans/2026-04-22-otef-remote-redesign.md` STOP GATE.
