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

The OTEF Remote Controller is a **mobile-first** phone/tablet UI for the Negev Urban Research Lab wall: pan/zoom, GIS table context, layer visibility and time animation, plus curation. Visual tone is **quiet desert instrumentation**—warm charcoal and stone, **one terracotta** primary (`colors.primary`), matte surfaces, no cyan-on-black or neon glow. **Hebrew is default** (`lang="he"`, `dir="rtl"`); a compact **Hebrew | English** toggle in the header switches locale and mirrored layout (logical CSS). **Three bottom tabs**—Navigation, Layers, Curation—replace scattered entry points; Layers is a **full-height scrollable panel** (not a draggable bottom sheet) with **no loss** of grouping, toggles, animation chips, pack/processed behaviors, or OTEFDataContext wiring. **Curation** embeds same-origin `curation.html` in an iframe; parent owns the **single Supabase heartbeat**; embedded app skips duplicate init when an **embed flag** (e.g. `?embed=1`) is present—see implementation plan Task 7. **Layer row labels** use `formatLayerLabelForDisplay` in **`src/shared/layer-name-utils.js`** (underscores/hyphen noise → spaces for display only; canonical ids and `fullLayerIds` unchanged). **Switching away from the Layers tab** does not clear drill-down: reopening **Layers** shows the same focused pack; the in-panel **Back** control returns to the pack overview.

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

Implementation: **logical properties** (`padding-inline`, `margin-inline`, `inset-inline-*`) so English (`dir="ltr"`) mirrors without one-off overrides.

## Layout

- **Viewport:** `100dvh`, column flex: **fixed header** → **scrollable `main`** (active tab body) → **fixed bottom nav**; `env(safe-area-inset-*)` on header and nav.
- **Header:** Title/branding, **locale toggle**, **connection** cluster; **below**, full-width **`#table-switcher`** (existing mount contract unchanged).
- **Tab panels:** Three regions, each with **`data-remote-tab`** set to **`navigation`**, **`layers`**, or **`curation`** (exact attribute/value names are CI contracts—keep in sync with `html-entrypoint-contract`). Only one panel visible at a time; **Layers** hosts list + **panel header** (title + **active layer count**). **Curation** panel holds **iframe** (`title` localized); **do not** tear down iframe on tab switches unless memory forces it.
- **Navigation tab:** D-pad, nipplejs joystick, zoom slider + step controls (existing behavior/throttle preserved).
- **Layers tab:** Full-page list; same actions as current sheet (groups, chevrons, row toggles, pack/processed rows, animation chips).
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
