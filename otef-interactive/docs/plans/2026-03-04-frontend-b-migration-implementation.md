# Frontend B Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Execution Note (2026-03-04):** Active execution runbook is `docs/plans/2026-03-04-frontend-b-delegacy-execution.md` (batch execution + archive-before-delete policy).

**Goal:** Migrate OTEF frontend runtime from script-ordered globals/CommonJS hybrid to bundled ES modules with centralized config and behavior parity across map/projection/remote/curation.

**Architecture:** Introduce `frontend/src` as canonical ES module source, build with Vite multi-entry outputs, and migrate domains in controlled phases using temporary compatibility adapters that are deleted by the end. Centralize all scattered config in `src/config` and make all consumers import from config modules. Preserve existing runtime behavior and API/data contracts while progressively replacing global wiring.

**Tech Stack:** JavaScript (ESM), Vite (multi-entry build), Jest (existing tests), Leaflet/proj4/PMTiles/protomaps-leaflet, existing Django/Nginx Docker serving.

---

### Task 1: Add Build Scaffolding and Entry Points

**Files:**
- Create: `otef-interactive/vite.config.mjs`
- Create: `otef-interactive/frontend/src/entries/map-main.js`
- Create: `otef-interactive/frontend/src/entries/projection-main.js`
- Create: `otef-interactive/frontend/src/entries/remote-main.js`
- Create: `otef-interactive/frontend/src/entries/curation-main.js`
- Modify: `otef-interactive/package.json`
- Test: `otef-interactive/tests/migration/build-smoke.test.js`

**Step 1: Write the failing test**

```js
const fs = require("fs");
const path = require("path");
test("vite config and all 4 entry files exist", () => {
  const root = path.resolve(__dirname, "../../");
  const required = [
    "vite.config.mjs",
    "frontend/src/entries/map-main.js",
    "frontend/src/entries/projection-main.js",
    "frontend/src/entries/remote-main.js",
    "frontend/src/entries/curation-main.js",
  ];
  required.forEach((p) => expect(fs.existsSync(path.join(root, p))).toBe(true));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/build-smoke.test.js`  
Expected: FAIL with missing file(s)

**Step 3: Write minimal implementation**

- Add Vite multi-entry config for 4 HTML pages.
- Add basic entry files that currently only log startup (placeholder).
- Add package scripts:
  - `build:frontend`
  - `dev:frontend`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/build-smoke.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Verify bundler config exists and package scripts are wired.
- Confirm each page has a defined entry file target.

### Task 2: Create Centralized Config Folder and Baseline Config Modules

**Files:**
- Create: `otef-interactive/frontend/src/config/app-config.js`
- Create: `otef-interactive/frontend/src/config/map-config.js`
- Create: `otef-interactive/frontend/src/config/projection-config.js`
- Create: `otef-interactive/frontend/src/config/animation-config.js`
- Create: `otef-interactive/frontend/src/config/ui-config.js`
- Create: `otef-interactive/frontend/src/config/perf-config.js`
- Create: `otef-interactive/tests/migration/config-centralization.test.js`

**Step 1: Write the failing test**

```js
test("central config exports table and zoom bounds", async () => {
  const { APP_CONFIG } = await import("../../frontend/src/config/app-config.js");
  const { MAP_CONFIG } = await import("../../frontend/src/config/map-config.js");
  expect(APP_CONFIG.defaultTable).toBe("otef");
  expect(MAP_CONFIG.zoom.min).toBe(10);
  expect(MAP_CONFIG.zoom.max).toBe(19);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/config-centralization.test.js`  
Expected: FAIL with module/file not found

**Step 3: Write minimal implementation**

- Add all config modules and export frozen objects.
- Include all known duplicated constants:
  - table names
  - zoom limits
  - curated palette
  - legend fallback scheme
  - map/projection perf defaults
  - animation defaults/limits
  - WMTS overrides defaults

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/config-centralization.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Confirm no module in `src` defines these constants inline anymore once migrated.
- Confirm animation config is present and documented in config modules.

### Task 3: Build Compatibility Layer for Transitional Global Contracts

**Files:**
- Create: `otef-interactive/frontend/src/shared/runtime-bridge.js`
- Create: `otef-interactive/tests/migration/runtime-bridge.test.js`

**Step 1: Write the failing test**

```js
test("runtime bridge exposes temporary shared state adapter", async () => {
  const bridge = await import("../../frontend/src/shared/runtime-bridge.js");
  expect(typeof bridge.createRuntimeBridge).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/runtime-bridge.test.js`  
Expected: FAIL with module not found

**Step 3: Write minimal implementation**

- Implement bridge wrapper for transitional state:
  - remote sync lock flags
  - unsubscribe registry
  - PMTiles popup registry
  - rotation edit preview flags
- Keep adapter internally scoped; avoid new direct `window.*` dependencies.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/runtime-bridge.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Ensure bridge is marked temporary with explicit removal criteria.

### Task 4: Migrate Shared Core Modules to ESM

**Files:**
- Create/Modify: `otef-interactive/frontend/src/shared/logger.js`
- Create/Modify: `otef-interactive/frontend/src/shared/message-protocol.js`
- Create/Modify: `otef-interactive/frontend/src/shared/api-client.js`
- Create/Modify: `otef-interactive/frontend/src/shared/websocket-client.js`
- Create/Modify: `otef-interactive/frontend/src/shared/otef-data-context/*.js`
- Test: `otef-interactive/tests/shared/*.test.js`
- Create: `otef-interactive/tests/migration/shared-esm-parity.test.js`

**Step 1: Write the failing test**

```js
test("ESM API client exposes default table config from app config", async () => {
  const api = await import("../../frontend/src/shared/api-client.js");
  expect(api.OTEF_API.defaultTable).toBe("otef");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/shared-esm-parity.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Port shared modules to ESM exports/imports.
- Replace global cross-linking with explicit imports.
- Keep behavior parity for protocol, websocket reconnect, DataContext updates.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/shared-esm-parity.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Confirm shared core no longer requires `module.exports` for runtime path.

### Task 5: Migrate `map-utils` Domain to ESM + Config Imports

**Files:**
- Modify/Create under: `otef-interactive/frontend/src/map-utils/`
  - `coordinate-utils.js`
  - `style-applicator.js`
  - `advanced-style-engine.js`
  - `advanced-style-drawing.js`
  - `advanced-pmtiles-layer.js`
  - `layer-factory.js`
  - `visibility-utils.js`
  - `visibility-controller.js`
  - `popup-renderer.js`
  - `pink-line-route.js`
- Test: `otef-interactive/tests/map-utils/*.test.js`
- Create: `otef-interactive/tests/migration/map-utils-config-usage.test.js`

**Step 1: Write the failing test**

```js
test("visibility utils reads zoom limits from centralized config", async () => {
  const mod = await import("../../frontend/src/map-utils/visibility-utils.js");
  expect(typeof mod.scaleToZoom).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/map-utils-config-usage.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Port map-utils to ESM and explicit imports.
- Remove browser runtime `require(...)` fallback logic.
- Consume config constants from `src/config/*`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/map-utils`  
Expected: PASS (or explicit tracked diffs)

**Step 5: Review checkpoint**

- Confirm no runtime globals are needed for map-utils module coupling.

### Task 6: Migrate Map Domain (Initialization, Loader, Legend, Sync)

**Files:**
- Modify/Create under: `otef-interactive/frontend/src/map/`
  - `map-main.js` (entry wiring)
  - `map-initialization.js`
  - `leaflet-control-with-basemap.js`
  - `layer-state-manager.js`
  - `map-legend.js`
  - `map-options.js`
  - `viewport-sync.js`
  - `viewport-sync-scheduler.js`
  - `viewport-apply-policy.js`
  - `perf-telemetry.js`
- Test: `otef-interactive/tests/map/*.test.js`
- Create: `otef-interactive/tests/migration/map-parity-smoke.test.js`

**Step 1: Write the failing test**

```js
test("map options consume centralized zoom config", async () => {
  const { buildMapOptions } = await import("../../frontend/src/map/map-options.js");
  const opts = buildMapOptions({});
  expect(opts.minZoom).toBe(10);
  expect(opts.maxZoom).toBe(19);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/map-parity-smoke.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Port map domain to ESM imports.
- Move duplicated constants to config imports.
- Refactor global sync flags through runtime bridge/store.
- Keep layer loading and legend behavior identical.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/map`  
Expected: PASS (except unrelated known failures)

**Step 5: Review checkpoint**

- Validate map page runtime parity manually in browser.

### Task 7: Migrate Projection Domain (Renderers + Managers + Editors)

**Files:**
- Modify/Create under: `otef-interactive/frontend/src/projection/`
  - `projection-main.js`
  - `projection-display.js`
  - `projection-layer-manager.js`
  - `layer-renderer-canvas.js`
  - `wmts-layer-renderer.js`
  - `projection-bounds-editor.js`
  - `projection-rotation-editor.js`
  - `highlight-smoothing-policy.js`
- Test: `otef-interactive/tests/projection/*.test.js`
- Create: `otef-interactive/tests/migration/projection-animation-config.test.js`

**Step 1: Write the failing test**

```js
test("projection smoothing policy reads centralized animation/perf config", async () => {
  const mod = await import("../../frontend/src/projection/highlight-smoothing-policy.js");
  expect(typeof mod.computeLerpFactor).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/projection-animation-config.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Port projection modules to ESM.
- Centralize projection and animation constants via config imports.
- Preserve bounds/orientation editing behavior and DataContext sync semantics.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/projection`  
Expected: PASS

**Step 5: Review checkpoint**

- Validate projection page behavior manually (highlight, layers, flow animation, bounds/orientation tools).

### Task 8: Migrate Remote and Curation Domains

**Files:**
- Modify/Create under: `otef-interactive/frontend/src/remote/`
  - `remote-main.js`
  - `remote-controller.js`
  - `layer-sheet-controller.js`
- Modify/Create under: `otef-interactive/frontend/src/curation/`
  - `curation-main.js`
  - `curation.js`
- Test: `otef-interactive/tests/remote/*.test.js`
- Create: `otef-interactive/tests/migration/remote-config-usage.test.js`

**Step 1: Write the failing test**

```js
test("remote zoom controls use centralized zoom config bounds", async () => {
  const remote = await import("../../frontend/src/remote/remote-controller.js");
  expect(remote).toBeTruthy();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/remote-config-usage.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Port remote and curation to ESM.
- Remove duplicated constants and import from config modules.
- Preserve existing UI interactions and API behaviors.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote`  
Expected: PASS

**Step 5: Review checkpoint**

- Validate remote/curation page behaviors manually.

### Task 9: Update HTML Pages to Bundled Module Entrypoints

**Files:**
- Modify: `otef-interactive/frontend/index.html`
- Modify: `otef-interactive/frontend/projection.html`
- Modify: `otef-interactive/frontend/remote-controller.html`
- Modify: `otef-interactive/frontend/curation.html`
- Test: `otef-interactive/tests/migration/html-entrypoint-contract.test.js`

**Step 1: Write the failing test**

```js
const fs = require("fs");
test("index.html no longer contains long legacy js script chain", () => {
  const html = fs.readFileSync("frontend/index.html", "utf8");
  expect(html.includes('src="js/map/map-initialization.js"')).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/html-entrypoint-contract.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Replace legacy script chains with bundled module entry includes.
- Keep third-party CDN dependencies only where intentionally externalized.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/html-entrypoint-contract.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Confirm each page initializes through a single app entrypoint path.

### Task 10: Migrate/Adapt Jest for ESM and Preserve Existing Coverage

**Files:**
- Modify: `otef-interactive/package.json`
- Create/Modify: `otef-interactive/jest.config.*`
- Modify: selected test files under `otef-interactive/tests/**`
- Create: `otef-interactive/tests/migration/esm-test-harness.test.js`

**Step 1: Write the failing test**

```js
test("esm harness can import config module", async () => {
  const mod = await import("../../frontend/src/config/app-config.js");
  expect(mod.APP_CONFIG).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/esm-test-harness.test.js`  
Expected: FAIL

**Step 3: Write minimal implementation**

- Configure Jest to run ESM tests/modules correctly.
- Update tests incrementally to import `frontend/src/*` modules.
- Keep compatibility adapters only as needed during transition.

**Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS except separately tracked unrelated repository issues

**Step 5: Review checkpoint**

- Record any non-migration failing tests and root causes.

### Task 11: Remove Transitional Bridge and Legacy Runtime Coupling

**Files:**
- Modify: `otef-interactive/frontend/src/**` (bridge consumers)
- Delete/retire transitional bridge modules once fully unused
- Test: `otef-interactive/tests/migration/no-global-coupling-guard.test.js`

**Step 1: Write the failing test**

```js
const { execSync } = require("child_process");
test("no window-based module coupling remains in src", () => {
  const out = execSync('rg -n "window\\.[A-Za-z0-9_]+\\s*=.*(Layer|Config|Helper|Renderer)" frontend/src || true').toString();
  expect(out.trim()).toBe("");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/no-global-coupling-guard.test.js`  
Expected: FAIL while bridge still exists

**Step 3: Write minimal implementation**

- Remove remaining compatibility bridge usage.
- Replace with explicit imports/state modules.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/no-global-coupling-guard.test.js`  
Expected: PASS

**Step 5: Review checkpoint**

- Confirm bridge removal and zero residual module-coupling globals.

### Task 12: End-to-End Verification, Docs, and Cleanup

**Files:**
- Modify: `otef-interactive/README.md`
- Create: `otef-interactive/docs/plans/2026-03-04-frontend-b-migration-verification.md`
- Modify: migration notes/docs as needed
- Optional fix: `otef-interactive/docs/perf-validation-checklist.md` path mismatch issue

**Step 1: Write the failing test/checklist item**

```md
- [ ] Map page loads via bundled entrypoint
- [ ] Projection page loads via bundled entrypoint
- [ ] Remote page loads via bundled entrypoint
- [ ] Curation page loads via bundled entrypoint
- [ ] All centralized configs consumed from src/config
```

**Step 2: Run verification to capture current failures**

Run:
- `npm run build:frontend`
- `npm test`
- manual smoke checks in Docker URLs

Expected: identify any parity or path regressions before final fixes

**Step 3: Write minimal implementation/fixes**

- Fix build/runtime regressions
- Update docs for build/run/deploy path
- Resolve known checklist doc-path inconsistency or track separately with owner/date

**Step 4: Run full verification**

Run:
- `npm run build:frontend`
- `npm test`
- manual smoke checks across all 4 pages

Expected: build succeeds, tests pass (except explicitly tracked non-migration issues), pages behave as before

**Step 5: Review checkpoint**

- Summarize completed migration and any residual risks.
- Do not stage, commit, or push unless explicitly requested by the user.
