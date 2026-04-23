---
version: alpha
name: OTEF Remote Controller — Negev Urban Research Lab
description: >
  Mobile-first remote for OTEF wall sessions: warm Negev dark (stone + charcoal),
  single terracotta accent, Hebrew-default chrome with English toggle. Tokens map
  to CSS variables in css/remote-styles.css; behavior stays on OTEFDataContext,
  existing WebSocket/API, and layer-sheet logic (full-height panel, not drawer).
colors:
  primary: "#c17f4a"
  canvas: "#12100e"
  surface: "#1c1917"
  surface-raised: "#262320"
  ink: "#f5f0ea"
  ink-muted: "#bfb6ab"
  ink-subtle: "#8c847a"
  primary-hover: "#d4925e"
  on-primary: "#141210"
  border: "#3d3834"
  border-strong: "#4a4540"
  success: "#7a9b7a"
  warning: "#d4a85c"
  danger: "#b85c5c"
  overlay-scrim: "#0a0908"
typography:
  title-sm:
    fontFamily: system-ui, "Segoe UI", "SF Pro Text", "Helvetica Neue", sans-serif
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body-md:
    fontFamily: system-ui, "Segoe UI", "SF Pro Text", "Helvetica Neue", "Noto Sans Hebrew", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label-sm:
    fontFamily: system-ui, "Segoe UI", "SF Pro Text", "Helvetica Neue", "Noto Sans Hebrew", sans-serif
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
  tab-label:
    fontFamily: system-ui, "Segoe UI", "SF Pro Text", "Helvetica Neue", "Noto Sans Hebrew", sans-serif
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  pill: 9999px
spacing:
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  touch: 56px
components:
  app-background:
    backgroundColor: "{colors.canvas}"
  hairline-divider:
    backgroundColor: "{colors.border}"
    height: 1px
  hairline-divider-strong:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  modal-scrim:
    backgroundColor: "{colors.overlay-scrim}"
  supporting-text:
    textColor: "{colors.ink-subtle}"
    typography: "{typography.label-sm}"
  header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title-sm}"
    padding: "{spacing.md}"
  bottom-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    padding: "{spacing.sm}"
    height: 64px
  nav-tab-active:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    typography: "{typography.tab-label}"
    rounded: "{rounded.md}"
  nav-tab-inactive:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    typography: "{typography.tab-label}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  layer-row:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  animation-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 6px
  connection-status-connected:
    textColor: "{colors.success}"
  connection-status-connecting:
    textColor: "{colors.warning}"
  connection-status-disconnected:
    textColor: "{colors.danger}"
---

## Overview

The OTEF Remote Controller is a **mobile-first** phone/tablet UI for the Negev Urban Research Lab wall: pan/zoom, GIS table context, layer visibility and time animation, plus curation. Visual tone is **quiet desert instrumentation**—warm charcoal and stone, **one terracotta** primary (`colors.primary`), matte surfaces, no cyan-on-black or neon glow. **Hebrew is default** (`lang="he"`, `dir="rtl"`); a compact **עב / en** header pill (two segments, `role="group"`, `aria-label` from locale) switches locale and mirrored layout (logical CSS). **Three bottom tabs**—Navigation, Layers, Curation—replace scattered entry points; Layers is a **full-height scrollable panel** (not a draggable bottom sheet) with **no loss** of grouping, toggles, animation chips, pack/processed behaviors, or OTEFDataContext wiring. **Curation** embeds same-origin `curation.html` in an iframe; parent owns the **single Supabase heartbeat**; embedded app skips duplicate init when an **embed flag** (e.g. `?embed=1`) is present—see implementation plan Task 7. **Layer row labels** use `formatLayerLabelForDisplay` in **`src/shared/layer-name-utils.js`** (underscores/hyphen noise → spaces for display only; canonical ids and `fullLayerIds` unchanged). **Pack labels / layers:** stable group ids are titled via **`src/remote/layer-pack-display-names.js`** (curated title still comes from `t("curatedGroupLabel")` in locale). **Switching away from the Layers tab** does not clear drill-down: reopening **Layers** shows the same focused pack; the in-panel **Back** control returns to the pack overview.

## Colors

- **Primary (`#c17f4a`)** — Terracotta for primary actions, active tab label, focus emphasis, animation chip text. Hover **`primary-hover` (`#d4925e`)**. **`on-primary` (`#141210`)** on filled buttons.
- **Canvas (`#12100e`)** — App root / main backdrop; deepest warm charcoal (basalt), not blue-black. See `app-background`.
- **Surface (`#1c1917`)** — Header, bottom nav, dense panels.
- **Surface raised (`#262320`)** — Layer rows, active tab well, overlay cards.
- **Ink (`#f5f0ea`) / Ink muted (`#bfb6ab`) / Ink subtle (`#8c847a`)** — Body, secondary, tertiary; `supporting-text` binds subtle ink for captions.
- **Border (`#3d3834`) / Border strong (`#4a4540`)** — 1px dividers and chip outlines. Token use: `hairline-divider` / `hairline-divider-strong` (1px hairline swatches for lintable refs); in CSS prefer `border-color: var(--color-border)`.
- **Success / Warning / Danger (`#7a9b7a` / `#d4a85c` / `#b85c5c`)** — Connection dot + status copy only; do not replace terracotta for generic highlights.
- **Overlay scrim (`#0a0908`)** — Base for connection / warning overlays; use ~70–85% alpha in CSS. See `modal-scrim`.

**Contrast:** **Ink on surface** and **on-primary on primary** target **WCAG AA** (≥4.5:1) for normal text.

## Typography

- **Stack:** `system-ui`, `Segoe UI`, `SF Pro Text`, `Helvetica Neue`, **`Noto Sans Hebrew`**, sans-serif.
- **title-sm** — App bar / section titles (~18px semibold).
- **body-md** — Descriptions, status, body UI (16px regular, RTL-friendly line height).
- **label-sm** — Buttons, chips, counts (~13px medium).
- **tab-label** — Bottom nav (12px semibold; keep Hebrew strings short).
- **Locale pill (header)** — Segmented control **עב** (Hebrew) and **en** (English) at **~12px** / medium in **`.remote-locale-btn`**, with **padding** so each segment stays **≥44px** min width/height; group label is localized (`localeGroupAria`), not the short glyphs.

Implementation: **logical properties** (`padding-inline`, `margin-inline`, `inset-inline-*`) so English (`dir="ltr"`) mirrors without one-off overrides.

## Layout

- **Viewport:** `100dvh`, column flex: **fixed header** → **scrollable `main`** (active tab body) → **fixed bottom nav**; `env(safe-area-inset-*)` on header and nav.
- **Header:** Title/branding, **compact locale pill** (`#remoteLocaleToggle` / `remote-locale-btn`), **connection** cluster; **below**, full-width **`#table-switcher`** (existing mount contract unchanged).
- **Tab panels:** Three regions, each with **`data-remote-tab`** set to **`navigation`**, **`layers`**, or **`curation`** (exact attribute/value names are CI contracts—keep in sync with `html-entrypoint-contract`). Only one panel visible at a time; **Layers** hosts list + **panel header** (title + **active layer count**). **Curation** panel holds **iframe** (`title` localized); **do not** tear down iframe on tab switches unless memory forces it.
- **Navigation tab:** D-pad, nipplejs joystick, zoom slider + step controls (existing behavior/throttle preserved).

### Navigation tab panel (controller)

This is the **main-area** body for the Navigation tab (`#remote-panel-navigation` / `#navigationSection`) — not the **footer** tab bar (`bottom-nav`).

- **Panel chrome:** Use `--nav-panel-padding-block-start` and `--nav-panel-padding-block-end` (default 12px / 16px) plus `env(safe-area-inset-bottom)` on the bottom panel padding. Horizontal inset follows `--spacing-unit` (maps from `spacing.md`).
- **Card inset:** The pan/zoom block uses `--nav-panel-section-padding-block` and `--nav-panel-section-padding-inline` (12px / 16px) so the `control-section` does not add extra vertical air.
- **Vertical distribution (portrait):** `.navigation-panel-stack` is **`flex: 1`** so it fills the tab body; **`.navigation-group--zoom`** uses **`margin-block-start: auto`** so the pan/joystick cluster stays toward the **top** and the zoom block toward the **bottom**, with spare height absorbed between them (not an empty band below zoom). **`--nav-panel-group-gap`** still sets the minimum step between the two groups; pan/zoom inner groups use **`gap: --space-xs`** for label-to-control rhythm.
- **Groups:** Pan (D-pad + joystick) and zoom (readout, slider, ±) use compact **section labels** (`navPanGroupLabel` / `navZoomGroupLabel` in `remote-locale.js`, ~11px uppercase muted). `.zoom-controls` does not add a second top margin (gap owns the rhythm).
- **D-pad size (portrait):** **`--nav-panel-dpad-size`** = `min(max(200px, 42dvh), min(260px, 55dvh))` so the pad grows modestly on tall narrow viewports while staying within the band; scoped to `#navigationSection .dpad` so global responsive `.dpad` tweaks do not fight it. **Short landscape:** **`--nav-panel-dpad-size-landscape-short`** (160px) plus **`margin-block-start: 0`** on the zoom group restores the side-by-side row layout.
- **D-pad column:** In this tab only, **`#navigationSection .dpad-container`** has **`margin-block: 0`** so spacing comes from group/stack gaps, not duplicate vertical margins on the wrapper.
- **Landscape (short):** In `@media (orientation: landscape) and (max-height: 500px)`, the stack becomes a **row** (wrap): pan stays compact left/center, zoom flexes in reading direction; navigation D-pad uses **`--nav-panel-dpad-size-landscape-short`**; panel top/bottom padding tightens. Footer tab bar rules are unchanged.
- **Touch:** D-pad buttons and zoom ± stay at `min-height` / `min-width` from `--touch-target-size` (≥44px, prefer 56px); joystick container keeps a ≥44px minimum hit box.

- **Layers tab:** Full-page list; same actions as current sheet (groups, chevrons, row toggles, pack/processed rows, animation chips).
  - Superseded for remote layers UX by 'Layers panel (chosen mockup: Variant C sharpened)' until Task 7 aligns implementation.
- **Touch:** Prefer **`spacing.touch` (56px)** on pad, zoom, and nav targets; 8–16px gaps between hit areas.

## Elevation & Depth

- Default **no glow**. Shadows: subtle warm black `rgba(10, 8, 6, 0.35)`, small blur; pressed controls optional inner highlight `rgba(245, 240, 234, 0.06)`.
- **Bottom nav:** Prefer **1px top border** using **`border`** token; keep shadow minimal.
- **Connection overlay:** Full-screen scrim (`modal-scrim` + alpha) + centered **`surface-raised`** card, **`rounded.lg`**, focus trap, one clear primary action. **`#warningOverlay`** (or current id) stays **global** across tabs.

## Shapes

- **rounded.sm / md / lg / pill** — 8 / 12 / 16px; pill for chips.
- **Joystick / D-pad:** Geometry unchanged; icons **ink-muted**, **primary** on active press.

## Components

- **app-background** — Root fill: **`{colors.canvas}`**.
- **header** — **`{colors.surface}`**, title **`title-sm`** / **ink**; table switcher row full-bleed under chrome.
- **bottom-nav** — **`{colors.surface}`**, inactive labels **ink-muted**; **three** items only (Navigation / Layers / Curation). **Active:** `nav-tab-active` (raised + terracotta label); **inactive:** `nav-tab-inactive`.
- **button-primary** / **button-primary-hover** — Filled CTA; focus ring ~2px **primary** at ~35% opacity outside control.
- **layer-row** — Raised row, **ink** title; **1px `border`** token in CSS between rows or on card edge as today’s density requires.
- **animation-chip** — Pill, **primary** text on **surface**; outline via CSS **`border-strong`**.
- **connection-status-*** — Dot + label: connected **success**, connecting **warning** (subtle pulse), disconnected **danger**; motion under ~2s period.
- **modal-scrim** — **`{colors.overlay-scrim}`** as solid base before alpha.
- **supporting-text** — Tertiary copy: **`ink-subtle`** + **`label-sm`**.

Map tokens to CSS custom properties (e.g. `--color-canvas`, `--color-primary`, `--nav-height`) in **`css/remote-styles.css`**; markup lives in **`remote-controller.html`** per Tasks 3–4.

## Layers panel (chosen mockup: Variant C sharpened)

Implementation and the refreshed static comp follow **`docs/superpowers/plans/2026-04-22-otef-remote-ux-followup.md`** — **Sharpened Variant C** contract (not the original C mockup alone until aligned).

- **Overview:** pack selection uses **pack cards in a horizontal strip** (hybrid of full cards vs. tiny chips — readable titles and actions, not icon-only slivers).
- **Primary mockup:** [`../../docs/superpowers/mockups/otef-remote-layers-variant-c.html`](../../docs/superpowers/mockups/otef-remote-layers-variant-c.html) · **Hub:** [`../../docs/superpowers/mockups/otef-remote-layers-mockups.html`](../../docs/superpowers/mockups/otef-remote-layers-mockups.html)
- **Show/hide all (current pack):** **One** compact control — **switch (track + thumb)** *or* a single state pill (not two buttons) — for **all layers in the selected pack**; keep this row **separate** from the tile grid with **≥12px** gap to the first tile row; do not place the **animation** control beside this row.
- **Layer tiles:** Focused pack shows layers in a **compact tile grid** (wrap, minimum tile width) for density without an endless vertical list; keep **`layer-row`** / raised-surface language where tiles map to “cards.”
- **Activation:** **Click the layer tile** toggles/selects the layer; **no** row-level on/off control beside the tile. **Off** (neither on-map nor selected), **on-map (non-primary)**, and **primary selected** are visually distinct: **off** = muted/dashed/lower opacity; **on-map** = solid border + full opacity; **selected** = strongest ring/background. **Animation-capable** layers: **separate** control, **min ~44px** hit target on the control only, **bottom-end** of the tile; mockup shows at least one tile with and one without.
- **Pack selector:** Titles **compact and readable** — no default **ellipsis** on pack names. **Horizontal** strip: **no visible scrollbar**, **no** prev/next **arrow** buttons; **edge fades** + **touch scroll**; optional “גלילה אופקית” / “Swipe horizontally” hint; **scroll snap** allowed — not a vertical pack list.
- **Counts (subtle):** **Per pack** (selected pack) **e.g. `4/7` active** near the pack label; **overall** “layers on” **e.g. `12 שכבות פעילות` / `12 layers on`** in the header near title or lamp, muted, not a loud badge.
- **RTL / LTR:** One static comp should show **two mini phone shells** side-by-side (**HE** `dir="rtl"` + **EN** `dir="ltr"`) so mirroring is reviewable.

**Scroll / shell:** Keep **`#layerSheet`** as the full-height layers host; **pack strip** scrolls horizontally when needed; **layer tile grid** is the primary scroll region inside the focused-pack area (vertical overflow only if the grid exceeds the viewport—prefer density so this is rare). Align `#layerPanelContent` / `.sheet-content` rules in **`remote-styles.css`** with these regions (no footer tab bar changes for layers density).

## Workshop / curation embed

When **`curation.html`** is loaded in an iframe with **`?embed=1`** (or `embed=true`), an inline script adds **`html.curation-embed`**. In that mode the top **`.curation-header`** is hidden so the full chrome stays on the parent remote shell; the standalone page keeps the full header. Submissions has an icon-only **refresh** control (**`#curationSubmissionsRefresh`**) in the section toolbar row (same data reload as **`#curationRefresh`**).

## Do's and Don'ts

**Do**

- Keep **warm neutrals** + **one terracotta**; reserve green/amber/red for **connection semantics** only.
- Default **Hebrew** and **RTL**; toggle updates `lang`, `dir`, and mirrored spacing.
- Preserve **OTEFDataContext**, **WebSocket/API**, **layer sheet** behaviors when moving to the Layers tab; preserve **nipplejs**, **`#table-switcher`**, **global overlay**, and **single parent heartbeat** for curation embed.
- Localize visible strings per locale module; format row labels with **`formatLayerLabelForDisplay`** (`layer-name-utils.js`) only—never rewrite canonical ids.

**Don't**

- Don’t use **cyan/teal** as primary accent or **matrix** glow aesthetics.
- Don’t drop touch targets below **44px** minimum; prefer **56px** on the d-pad and primary nav.
- Don’t stack a second design system on top of these tokens.
- Don’t run **duplicate** curation heartbeat inside the iframe when **`embed`** is set.
