# Frontend-B De-Legacy Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Frontend-B migration to true ESM runtime with no script-chain dependency, while preserving behavior and Docker runtime parity.

**Architecture:** Migrate in domain batches with TDD guardrails. Each batch converts `frontend/src` modules to explicit ESM imports/exports, rewires entrypoints away from `loadLegacyScriptChain`, and moves replaced legacy files from `frontend/js` into `frontend/archive/legacy-batches/<batch-id>/` instead of deleting. Final deletion happens only after full manual verification.

**Tech Stack:** JavaScript ESM, Vite multi-entry build, Jest, Docker/Nginx runtime.

---

## Batch Policy (applies to every task)

- Batch size: small, isolated, reversible.
- Test first: add/adjust migration test before implementation when coverage is missing.
- Archive policy: after replacing a legacy module, move its old file to `frontend/archive/legacy-batches/<batch-id>/...` in the same batch.
- Verification per batch:
  - `npm run build:frontend`
  - targeted migration/domain tests for touched area
  - `npm test` (full) at major checkpoints (end of Batch 3, 5, 7)
- Manual browser checks are deferred until all batches complete (user-owned), but HTTP reachability checks run after each batch.
- No commit/push unless explicitly requested.

### Task 1: Establish De-Legacy Guardrails and Archive Structure

**Files:**
- Create: `otef-interactive/frontend/archive/legacy-batches/.gitkeep`
- Create: `otef-interactive/tests/migration/delegacy-gates.test.js`
- Modify: `otef-interactive/docs/plans/2026-03-04-frontend-b-migration-implementation.md` (add pointer to this execution plan)

**Step 1: Write the failing test**

```js
const { execSync } = require("child_process");

test("no loadLegacyScriptChain usage remains in completed batches", () => {
  const out = execSync('rg -n "loadLegacyScriptChain" frontend/src/entries || true').toString();
  expect(out).toBe("");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/delegacy-gates.test.js`
Expected: FAIL while script-chain entrypoints still exist.

**Step 3: Write minimal implementation**

- Add gate test but scope by batch marker constants (so it only enforces completed batches).
- Create archive root folder for moved legacy files.
- Add plan pointer in original implementation doc.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/migration/delegacy-gates.test.js`
Expected: PASS with batch-aware gates.

**Step 5: Review checkpoint**

Confirm guardrail exists and archive root is in place.

### Task 2: Convert Config + Low-Coupling Utility Modules to True ESM (Batch B1)

**Files:**
- Modify: `otef-interactive/frontend/src/config/app-config.js`
- Modify: `otef-interactive/frontend/src/config/map-config.js`
- Modify: `otef-interactive/frontend/src/config/projection-config.js`
- Modify: `otef-interactive/frontend/src/config/animation-config.js`
- Modify: `otef-interactive/frontend/src/config/ui-config.js`
- Modify: `otef-interactive/frontend/src/config/perf-config.js`
- Modify: `otef-interactive/frontend/src/map/map-options.js`
- Modify: `otef-interactive/frontend/src/map-utils/visibility-utils.js`
- Modify: `otef-interactive/frontend/src/projection/highlight-smoothing-policy.js`
- Modify: `otef-interactive/frontend/src/remote/remote-controller.js`
- Test: `otef-interactive/tests/migration/config-centralization.test.js`
- Test: `otef-interactive/tests/migration/map-utils-config-usage.test.js`
- Test: `otef-interactive/tests/migration/projection-animation-config.test.js`
- Test: `otef-interactive/tests/migration/remote-config-usage.test.js`

**Step 1: Write the failing test**

```js
test("converted B1 modules are ESM-only", async () => {
  const { MAP_CONFIG } = await import("../../frontend/src/config/map-config.js");
  expect(MAP_CONFIG.zoom.min).toBe(10);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/config-centralization.test.js tests/migration/map-utils-config-usage.test.js tests/migration/projection-animation-config.test.js tests/migration/remote-config-usage.test.js`
Expected: FAIL on CommonJS usage/import mismatch.

**Step 3: Write minimal implementation**

- Replace `module.exports`/`require` with `export`/`import` in listed files.
- Keep runtime behavior identical.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/migration/config-centralization.test.js tests/migration/map-utils-config-usage.test.js tests/migration/projection-animation-config.test.js tests/migration/remote-config-usage.test.js`
Expected: PASS.

**Step 5: Review checkpoint**

Confirm B1 files have no `module.exports`, `require(`, or `../../js/` references.

### Task 3: Migrate Shared Core and Data Context to True ESM (Batch B2)

**Files:**
- Modify: `otef-interactive/frontend/src/shared/logger.js`
- Modify: `otef-interactive/frontend/src/shared/message-protocol.js`
- Modify: `otef-interactive/frontend/src/shared/api-client.js`
- Modify: `otef-interactive/frontend/src/shared/websocket-client.js`
- Modify: `otef-interactive/frontend/src/shared/OTEFDataContext.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/index.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-actions.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-bounds.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js`
- Move to archive (B2): corresponding files from `otef-interactive/frontend/js/shared/**`
- Test: `otef-interactive/tests/migration/shared-esm-parity.test.js`
- Test: `otef-interactive/tests/shared/*.test.js`

**Step 1: Write the failing test**

```js
test("shared api client is true ESM without legacy wrapper", async () => {
  const mod = await import("../../frontend/src/shared/api-client.js");
  expect(mod.OTEF_API.defaultTable).toBe("otef");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/shared-esm-parity.test.js`
Expected: FAIL while wrappers still require `../../js/shared/*`.

**Step 3: Write minimal implementation**

- Port shared modules to ESM with explicit intra-`src` imports.
- Move replaced legacy shared modules into `frontend/archive/legacy-batches/B2/shared/...`.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/migration/shared-esm-parity.test.js tests/shared`
Expected: PASS.

**Step 5: Review checkpoint**

Run: `rg -n "\.\./\.\./js/shared|module\.exports|require\(" frontend/src/shared`
Expected: no output.

### Task 4: Migrate Map-Utils Domain to True ESM (Batch B3)

**Files:**
- Modify: `otef-interactive/frontend/src/map-utils/coordinate-utils.js`
- Modify: `otef-interactive/frontend/src/map-utils/style-applicator.js`
- Modify: `otef-interactive/frontend/src/map-utils/advanced-style-engine.js`
- Modify: `otef-interactive/frontend/src/map-utils/advanced-style-drawing.js`
- Modify: `otef-interactive/frontend/src/map-utils/advanced-pmtiles-layer.js`
- Modify: `otef-interactive/frontend/src/map-utils/layer-factory.js`
- Modify: `otef-interactive/frontend/src/map-utils/visibility-controller.js`
- Modify: `otef-interactive/frontend/src/map-utils/popup-renderer.js`
- Modify: `otef-interactive/frontend/src/map-utils/pink-line-route.js`
- Move to archive (B3): corresponding files from `otef-interactive/frontend/js/map-utils/**`
- Test: `otef-interactive/tests/map-utils/*.test.js`
- Test: `otef-interactive/tests/migration/map-utils-config-usage.test.js`

**Step 1: Write the failing test**

```js
test("map-utils modules import from src graph only", async () => {
  const mod = await import("../../frontend/src/map-utils/coordinate-utils.js");
  expect(mod).toBeTruthy();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/map-utils tests/migration/map-utils-config-usage.test.js`
Expected: FAIL while wrappers still point to `../../js/map-utils/*`.

**Step 3: Write minimal implementation**

- Convert all listed map-utils files to true ESM.
- Update imports to config/shared ESM modules.
- Move replaced legacy map-utils files into `frontend/archive/legacy-batches/B3/map-utils/...`.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/map-utils tests/migration/map-utils-config-usage.test.js`
Expected: PASS.

**Step 5: Review checkpoint**

Run: `npm test`
Expected: full suite passes (except explicitly tracked unrelated failures).

### Task 5: Migrate Map Domain and Remove Map Script Chain (Batch B4)

**Files:**
- Modify: `otef-interactive/frontend/src/map/map-initialization.js`
- Modify: `otef-interactive/frontend/src/map/leaflet-control-with-basemap.js`
- Modify: `otef-interactive/frontend/src/map/layer-state-manager.js`
- Modify: `otef-interactive/frontend/src/map/map-legend.js`
- Modify: `otef-interactive/frontend/src/map/viewport-sync.js`
- Modify: `otef-interactive/frontend/src/map/viewport-sync-scheduler.js`
- Modify: `otef-interactive/frontend/src/map/viewport-apply-policy.js`
- Modify: `otef-interactive/frontend/src/map/perf-telemetry.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Move to archive (B4): replaced `otef-interactive/frontend/js/map/**` files used by map page
- Test: `otef-interactive/tests/map/*.test.js`
- Test: `otef-interactive/tests/migration/map-parity-smoke.test.js`
- Test: `otef-interactive/tests/migration/entry-bootstrap-contract.test.js`

**Step 1: Write the failing test**

```js
test("map entry boots without loadLegacyScriptChain", async () => {
  const fs = require("fs");
  const src = fs.readFileSync("frontend/src/entries/map-main.js", "utf8");
  expect(src.includes("loadLegacyScriptChain")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/entry-bootstrap-contract.test.js tests/migration/map-parity-smoke.test.js`
Expected: FAIL because entry still uses legacy chain.

**Step 3: Write minimal implementation**

- Boot map page via direct `src` imports and explicit startup order.
- Remove map entry chain loader usage.
- Archive replaced legacy map files under `B4`.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/map tests/migration/entry-bootstrap-contract.test.js tests/migration/map-parity-smoke.test.js`
Expected: PASS.

**Step 5: Review checkpoint**

Run: `powershell -Command "(Invoke-WebRequest -UseBasicParsing http://localhost/otef-interactive/).StatusCode"`
Expected: `200`.

### Task 6: Migrate Projection Domain and Remove Projection Script Chain (Batch B5)

**Files:**
- Modify: `otef-interactive/frontend/src/projection/projection-display.js`
- Modify: `otef-interactive/frontend/src/projection/projection-layer-manager.js`
- Modify: `otef-interactive/frontend/src/projection/layer-renderer-canvas.js`
- Modify: `otef-interactive/frontend/src/projection/wmts-layer-renderer.js`
- Modify: `otef-interactive/frontend/src/projection/projection-bounds-editor.js`
- Modify: `otef-interactive/frontend/src/projection/projection-rotation-editor.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Move to archive (B5): replaced `otef-interactive/frontend/js/projection/**` files used by projection page
- Test: `otef-interactive/tests/projection/*.test.js`
- Test: `otef-interactive/tests/migration/projection-animation-config.test.js`
- Test: `otef-interactive/tests/migration/projection-fetch-dedupe-contract.test.js`

**Step 1: Write the failing test**

```js
test("projection entry boots without loadLegacyScriptChain", () => {
  const fs = require("fs");
  const src = fs.readFileSync("frontend/src/entries/projection-main.js", "utf8");
  expect(src.includes("loadLegacyScriptChain")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/projection-animation-config.test.js tests/migration/projection-fetch-dedupe-contract.test.js`
Expected: FAIL until projection boots via `src` graph.

**Step 3: Write minimal implementation**

- Rewire projection entrypoint to direct `src` imports.
- Keep animation and fetch dedupe parity.
- Archive replaced legacy projection files under `B5`.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/projection tests/migration/projection-animation-config.test.js tests/migration/projection-fetch-dedupe-contract.test.js`
Expected: PASS.

**Step 5: Review checkpoint**

Run: `powershell -Command "(Invoke-WebRequest -UseBasicParsing http://localhost/otef-interactive/projection.html).StatusCode"`
Expected: `200`.

### Task 7: Migrate Remote + Curation Domains and Remove Remaining Script Chains (Batch B6)

**Files:**
- Modify: `otef-interactive/frontend/src/remote/remote-main.js`
- Modify: `otef-interactive/frontend/src/remote/layer-sheet-controller.js`
- Modify: `otef-interactive/frontend/src/entries/remote-main.js`
- Modify: `otef-interactive/frontend/src/curation/curation-main.js`
- Modify: `otef-interactive/frontend/src/curation/curation.js`
- Modify: `otef-interactive/frontend/src/entries/curation-main.js`
- Move to archive (B6): replaced `otef-interactive/frontend/js/remote/**` and `otef-interactive/frontend/js/curation/**`
- Test: `otef-interactive/tests/remote/*.test.js`
- Test: `otef-interactive/tests/migration/remote-config-usage.test.js`
- Test: `otef-interactive/tests/migration/entry-bootstrap-contract.test.js`

**Step 1: Write the failing test**

```js
test("remote entry boots without loadLegacyScriptChain", () => {
  const fs = require("fs");
  const src = fs.readFileSync("frontend/src/entries/remote-main.js", "utf8");
  expect(src.includes("loadLegacyScriptChain")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/remote-config-usage.test.js tests/migration/entry-bootstrap-contract.test.js`
Expected: FAIL while remote still uses script chain.

**Step 3: Write minimal implementation**

- Remove remote chain loader and curation dynamic legacy import.
- Rewire both pages to direct `src` module graph.
- Archive replaced legacy remote/curation files under `B6`.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test -- tests/remote tests/migration/remote-config-usage.test.js tests/migration/entry-bootstrap-contract.test.js`
Expected: PASS.

**Step 5: Review checkpoint**

Run:
- `powershell -Command "(Invoke-WebRequest -UseBasicParsing http://localhost/otef-interactive/remote-controller.html).StatusCode"`
- `powershell -Command "(Invoke-WebRequest -UseBasicParsing http://localhost/otef-interactive/curation.html).StatusCode"`
Expected: both `200`.

### Task 8: Remove Transitional Bridge Coupling and Enforce Final Gates (Batch B7)

**Files:**
- Modify: `otef-interactive/frontend/src/shared/runtime-bridge.js`
- Modify: any bridge consumer under `otef-interactive/frontend/src/**`
- Modify: `otef-interactive/tests/migration/no-global-coupling-guard.test.js`
- Modify: `otef-interactive/tests/migration/delegacy-gates.test.js`

**Step 1: Write the failing test**

```js
test("no src runtime module uses require/module.exports or ../../js paths", () => {
  const { execSync } = require("child_process");
  const out = execSync('rg -n "module\\.exports|require\\(|\\.\\./\\.\\./js/" frontend/src || true').toString();
  expect(out.trim()).toBe("");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/migration/no-global-coupling-guard.test.js tests/migration/delegacy-gates.test.js`
Expected: FAIL before cleanup completion.

**Step 3: Write minimal implementation**

- Remove remaining bridge-only coupling where no longer needed.
- Tighten migration gates to final requirements.

**Step 4: Run test to verify it passes**

Run: `npm run build:frontend`
Run: `npm test`
Expected: PASS (except explicitly tracked unrelated issues).

**Step 5: Review checkpoint**

Run:
- `rg -n "loadLegacyScriptChain" frontend/src`
- `rg -n "\.\./\.\./js/" frontend/src`
- `rg -n "module\.exports|require\(" frontend/src`
Expected: all empty.

### Task 9: Final Verification + Manual QA Handoff + Deferred Delete Plan

**Files:**
- Modify: `otef-interactive/docs/plans/2026-03-04-frontend-b-migration-verification.md`
- Create: `otef-interactive/docs/plans/2026-03-04-frontend-b-legacy-delete-after-manual-qa.md`

**Step 1: Write the checklist artifact**

```md
- [ ] npm run build:frontend passes
- [ ] npm test passes
- [ ] /otef-interactive/ manual QA pass (user)
- [ ] /otef-interactive/projection.html manual QA pass (user)
- [ ] /otef-interactive/remote-controller.html manual QA pass (user)
- [ ] /otef-interactive/curation.html manual QA pass (user)
```

**Step 2: Run verification commands**

Run:
- `npm run build:frontend`
- `npm test`
- HTTP checks:
  - `http://localhost/otef-interactive/`
  - `http://localhost/otef-interactive/projection.html`
  - `http://localhost/otef-interactive/remote-controller.html`
  - `http://localhost/otef-interactive/curation.html`

Expected: build/tests pass, URLs reachable.

**Step 3: Write minimal implementation**

- Record final automated verification evidence.
- Produce a delete-plan doc listing archived paths and exact post-manual-QA delete commands.

**Step 4: Run final gate commands**

Run:
- `rg -n "loadLegacyScriptChain" frontend/src`
- `rg -n "\.\./\.\./js/" frontend/src`
- `rg -n "module\.exports|require\(" frontend/src`

Expected: all empty.

**Step 5: Review checkpoint**

Confirm migration complete, legacy code preserved only under `frontend/archive/legacy-batches/*`, and permanent deletion deferred until user confirms manual QA passed.
