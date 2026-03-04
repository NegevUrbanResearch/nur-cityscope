# Frontend B Migration Design (OTEF Interactive)

**Date:** 2026-03-04
**Status:** Approved for planning
**Owner:** Frontend refactor track

## 1. Objective

Perform a full architecture migration of `otef-interactive/frontend` to modern frontend best practices:

- ES modules (explicit imports/exports)
- Bundler-based multi-entry build (map/projection/remote/curation)
- Centralized configuration in a dedicated config folder
- Eliminate global/script-order module wiring (`window.*` and browser `require(...)`)
- Preserve runtime behavior and parity across all pages

This migration is part of cleanup/refactor for maintainability, clarity, and long-term scalability.

## 2. Current-State Findings (Audit Summary)

### 2.1 Runtime wiring

Current browser runtime depends on script ordering in HTML pages:

- `frontend/index.html` (~36 script tags)
- `frontend/projection.html` (~28 script tags)
- `frontend/remote-controller.html` (~17 script tags)
- `frontend/curation.html` (~3 script tags)

The JS codebase is hybrid:

- Browser globals (`window.<name> = ...`)
- CommonJS exports (`module.exports = ...`) for Jest/tooling
- Runtime fallback `require(...)` branches in browser files

### 2.2 Scattered configuration and duplicated constants

Configuration and constants are spread across multiple domains and files. Key examples:

- Table names (`"otef"`) repeated in:
  - `frontend/js/shared/api-client.js`
  - `frontend/js/remote/remote-controller.js`
  - `frontend/js/projection/projection-display.js`
  - `frontend/js/map/map-initialization.js`
- Zoom bounds (`10..19`) repeated in:
  - `frontend/js/map/map-options.js`
  - `frontend/js/remote/remote-controller.js`
  - `frontend/js/shared/otef-data-context/OTEFDataContext-actions.js`
  - `frontend/js/map/map-initialization.js`
- Curated palettes duplicated in:
  - `frontend/js/map/leaflet-control-with-basemap.js`
  - `frontend/js/projection/projection-layer-manager.js`
- Legend fallback schemes in:
  - `frontend/js/map/map-legend.js`
- Projection/GIS perf and animation knobs partially centralized in:
  - `frontend/js/shared/map-projection-config.js`
  but still consumed with duplicated defaults/fallbacks in multiple modules.

### 2.3 Animation config/state is fragmented

Animation concerns are split across layers:

- Capability metadata in processed `styles.json` (`style.animation`)
- Runtime animation state in `OTEFDataContext.animations`
- Runtime phase clock in `shared/animation-runtime.js`
- Flow rendering in `map-utils/advanced-style-drawing.js` and `projection/layer-renderer-canvas.js`
- Perf/animation limits in `shared/map-projection-config.js`

We need unified config ownership without changing existing behavior contracts.

### 2.4 Duplicate logic and high-maintenance hotspots

- Symbol interpretation overlap:
  - `map/map-legend.js` duplicates style-IR translation logic already represented in `map-utils/advanced-style-engine.js`
- Similar curated layer loading/orchestration exists in both:
  - `map/leaflet-control-with-basemap.js`
  - `projection/projection-layer-manager.js`
- Very large modules (700+ LOC) combine multiple responsibilities:
  - `projection/layer-renderer-canvas.js`
  - `map/map-legend.js`
  - `projection/projection-layer-manager.js`
  - `map/leaflet-control-with-basemap.js`

### 2.5 Tooling and tests

- No frontend bundler currently configured in `otef-interactive/package.json` (Jest only)
- Tests mostly use CommonJS imports and global mocking
- Existing suite mostly passes; known failing tests reference missing:
  - `otef-interactive/docs/perf-validation-checklist.md`

## 3. Target Architecture

## 3.1 Source layout

Introduce a canonical module source tree:

`frontend/src/`

- `entries/`
  - `map-main.js`
  - `projection-main.js`
  - `remote-main.js`
  - `curation-main.js`
- `config/`
- `shared/`
- `map/`
- `projection/`
- `remote/`
- `curation/`
- `map-utils/`

Legacy `frontend/js/` will be migrated domain-by-domain and eventually removed from runtime loading.

### 3.2 Bundler and page model

- Multi-entry build, one entry per page
- HTML pages load one compiled module bundle each
- Static path compatibility maintained for `/otef-interactive/...` serving in existing Docker/Nginx setup

### 3.3 Explicit dependency model

- All cross-module usage via imports
- Replace runtime `window` module contracts with explicit shared services/state
- Keep only deliberate browser globals where truly needed (e.g., third-party lib globals), wrapped behind adapters

## 4. Centralized Config Design

Create `frontend/src/config/` as single source of truth.

### 4.1 `app-config.js`

- table identifiers/defaults (`otef`, others if needed)
- API base routes
- WebSocket endpoint templates
- data-path conventions

### 4.2 `map-config.js`

- zoom min/max
- Leaflet map options defaults
- basemap providers/URLs/attribution
- viewport sync thresholds and policy defaults

### 4.3 `projection-config.js`

- label size scale
- projection extent tolerance
- smoothing defaults
- WMTS renderer overrides

### 4.4 `animation-config.js`

- flow animation runtime defaults
- max FPS and animation policy caps
- layer animation enablement defaults/fallback policy

### 4.5 `ui-config.js`

- curated palettes
- legend fallback schemes
- shared UI constants and text-format limits where relevant

### 4.6 `perf-config.js`

- GIS/projection perf toggles and guardrails currently nested in `MapProjectionConfig.GIS_PERF`
- explicit ownership and typed documentation

All modules that currently hardcode/duplicate these values must be updated to consume config imports only.

## 5. Migration Strategy (Approach B, disciplined)

We use a strangler-style migration with strict anti-drift guardrails:

1. Add bundler and new entrypoints
2. Add centralized config and reroute all constants
3. Migrate shared core modules
4. Migrate map-utils modules
5. Migrate map domain
6. Migrate projection domain
7. Migrate remote and curation domains
8. Remove compatibility bridge and legacy runtime wiring

Guardrails:

- No new product features on legacy JS path during migration
- Each phase has completion gates (tests + parity checks + bridge reduction)
- Track remaining `window.*` module-coupling usages until zero

## 6. Behavior-Parity Requirements

Must preserve:

- map/projection/remote/curation functional behavior
- layer loading and visibility semantics
- `OTEFDataContext` state sync and websocket behavior
- flow animation capability and runtime state semantics
- projection bounds/orientation edit behavior
- PMTiles query/popup behavior

No backend API contract changes unless explicitly required and separately approved.

## 7. Risk Register and Mitigations

### 7.1 Implicit shared globals

Examples:

- `isApplyingRemoteState`, `syncLockTimer`
- `_otefUnsubscribeFunctions`
- `pmtilesLayersWithConfigs`
- `rotationEditModeActive`, `rotationPreviewAngleDeg`

Mitigation:

- Replace with imported state/service modules
- Minimize mutable global state, encapsulate in dedicated runtime stores

### 7.2 Large multi-responsibility modules

Mitigation:

- Split by responsibility as part of migration
- Keep API-compatible facades during phase transitions

### 7.3 Test migration complexity (CommonJS -> ESM)

Mitigation:

- Migrate test files per domain in lockstep
- Preserve intent of current integration-style tests
- Keep temporary compatibility wrappers where needed, then delete

### 7.4 Deployment path compatibility

Mitigation:

- Validate bundle output paths against existing served URLs
- Explicit smoke tests in Docker environment for all 4 entry pages

## 8. Acceptance Criteria

Migration is complete when all are true:

- All 4 pages load through bundler-generated entry bundles
- No runtime dependency on multi-script ordering
- No browser-side `require(...)` paths remain
- Cross-module app wiring does not rely on ad-hoc `window` globals
- All scattered configuration values are centralized under `src/config`
- Tests pass (excluding separately tracked unrelated repo issues) and parity checks pass
- Legacy compatibility bridge removed

## 9. Out-of-Scope / Deferred

- Feature redesign or UI redesign
- Backend protocol redesign
- TypeScript conversion (can be follow-up)

## 10. Open Items Tracked During Planning

- Choose bundler and exact config format
- Decide short-term compatibility strategy for Jest under ESM
- Define parity smoke checklist per entry page

