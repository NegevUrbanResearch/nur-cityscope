# Projection Config UI Redesign Implementation Plan

> **For agentic workers:** Use subagent-driven-development task execution, adapted to the owner's explicit workflow: Luna implements, Sol reviews completed code and runs browser checks, and Astra visually inspects Sol's screenshots. This role assignment and end-of-work review sequence supersede skill defaults for per-task reviewers/model escalation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Projection Config comfortable on desktop and the 11-inch Galaxy Tab, with accessible calibration controls, precise touch adjustment, and clear save/application feedback.

**Architecture:** Rearrange the existing view and CSS around the current controllers, descriptors, node selection, clients, and disposable editors. Keep native form controls and existing transaction/preview protocols; improve their presentation without replacing the calibration system. Settlement rendering/persistence remains owned by its separate plan.

**Tech Stack:** Existing ES modules, CSS, SVG, native form controls, Vitest/jsdom, Vite, Django regression suites, and nginx-served frontend.

**Spec:** `docs/superpowers/specs/2026-09-29-projection-config-ui-design.md`.

**Status:** Ready for implementation after three Sol/Astra review rounds, with the owner's subsequent model/review/commit instructions incorporated. Planning only; application code, tests, and physical acceptance have not run for this redesign.

## Global constraints

- Work in the existing `dev` checkout. Check the branch and working tree before execution. Preserve unrelated changes and ignored NLI artifacts. The owner authorizes task-owned commits on dev, including the spec/plan; no new branch/worktree, push, merge, or publication is authorized.
- The coordinator commits only verified task-owned source/tests/docs. Keep raw screenshots/captures local unless separately requested. Do not stage ignored data or other planning files incidentally; explicitly force-add only this spec/plan if their ignored status requires it.
- Preserve the graph's nodes, geometry edges, dragging, pan, zoom, inline controls, and selection. Preserve projector configuration, mesh evaluation, presets, schema, coordinates, units, precision, and save contracts.
- No new frontend shell, dependency, state store, service, schema, or generalized editor framework is required.
- Searchable settlement selection and an installation checklist are explicitly excluded. No wizard, auto-calibration, custom keyboard, magnifier, global undo, or whole-exhibit backup system.
- Interactive targets are at least 44 CSS pixels on touch surfaces; use approximately 48 pixels for the directional nudge controls. Retain fine 0.25-pixel and coarse 1-pixel warp nudges.
- Descriptor-based numeric fields keep blur/Enter commits; warp X/Y and independent editors keep their existing completed-edit paths. Ordinary sliders keep input updates; existing release-commit fields keep that exception. Blank/incomplete/nonfinite values never become zero.
- Calibration Live/Apply/presets cover geometry and people-wall settings. Clock/legend and planned settlement edits save independently. Display assignments remain workstation/browser scoped. Do not present one global Saved/Ready state as physical alignment.
- Local draft feedback, preview rendering, server storage, and output acknowledgement remain distinct. Preserve pending/failure/conflict feedback after modal close through existing domain state.
- Only one active editor preview; closing removes it. No hidden permanent frame, second socket, polling, backend endpoint, or migration.
- Preserve running projector tabs and accepted calibration during inspection. Use Live off for reversible local geometry checks, restore exact values, and do not overwrite presets or launch/reload outputs to inspect styling.
- Actual Galaxy Tab touch, keyboard, venue-network response, and optical alignment are acceptance evidence to collect, not assumed results.

## Task boundaries and dependencies

| Task | Deliverable | Depends on |
| --- | --- | --- |
| 1 | Stable desktop/compact page layout, utility disclosures, scoped status | Existing view/controller |
| 2 | Full-width touch sliders and stable value entry | 1 |
| 3 | Tablet warp panel, clear selection, reachable precision/recovery | 1; 2 provides field treatment |
| 4 | Consistent existing editors, settlement coordination, rendered acceptance | 1-3 |

Use a fresh `gpt-6-luna` subagent per implementation task, with bounded task context and the relevant spec/plan sections. Each Luna implements, runs focused checks, and self-reviews. The coordinator owns sequencing and task commits; agents must not stage/commit concurrently. Do not add an agent per checkbox. Shared view/CSS edits run sequentially. Application fixes from any review also go to Luna; do not silently promote implementation to Sol/Astra.

At the end, `gpt-6-sol` reviews the complete task diff and test evidence, then runs browser acceptance and captures screenshots. Sol sends the saved screenshot paths and context directly to `gpt-6-astra`, which performs visual inspection against the spec. This user-selected sequence replaces the previous per-task Sol gates and final general Astra code review. Review failures loop through Luna fixes, affected checks, and refreshed Sol/Astra evidence as described in Task 4.

Settlement work may share `config-view.js`, `config-controller.js`, `node-canvas.js`, and `config.css`. Do not implement both plans concurrently in those files. Recheck the current feature state at execution; do not run its capture/migration plan as part of this UI task. Existing UI work can proceed without a fake settlement node. When the real feature lands, its task grouping and editor styling use the conventions here; record settlement-specific rendered acceptance separately if it is not yet available.

## Files and existing interfaces

| File | Responsibility/change |
| --- | --- |
| `otef-interactive/frontend/src/projection-config/config-view.js` | Rearrange existing controls, group task options, render scoped summaries and touch field/selection feedback |
| `otef-interactive/frontend/src/projection-config/config.css` | Scoped visual tokens, explicit page regions, touch fields, editor layout; replace conflicting old rules |
| `otef-interactive/frontend/src/projection-config/warp-editor-dialog.js` | Default touch panel visibility, lifecycle-preserving fitting, reduced-height handling |
| `otef-interactive/frontend/src/projection-config/clock-layout-editor-dialog.js` and `clock-layout-controls.js` | Existing editor identity/save-scope copy and placement only |
| `otef-interactive/frontend/src/projection-config/config-controller.js` | Only narrowly necessary view/status integration; no client or geometry rewrite |
| `otef-interactive/tests/projection-config/config-ui.test.js` | New small jsdom suite for actual rearranged view interaction; no reusable fixture framework |
| Existing config-view/controller, node-canvas, warp, and clock tests | Preserve behavioral contracts; change structural assertions only where the intentional DOM rearrangement requires it |
| `otef-interactive/docs/projection-config-acceptance.md` | Append this redesign's real software/device evidence and limitations |

Preserve public signatures:

```js
createProjectionConfigView(root, {
  descriptors, onAction, onOutputAction, onField, onNudge, onNamesMode,
  onNode, onOpenClockEditor, onClockScene, onClockElement, onClockField,
  onClockRecovery, onWarpAction, onWarpPointer,
});
// Returns update, controls, fields, nodeMap, setPresetName, canManageDisplays,
// getClockEditorOpener, cancelWarpPointer, closeWarpEditor, dispose.

createWarpEditorDialog({ document, host, editorPanel, overlay,
  onBeforeClose, onBeforeSwitch, onFineToggle, onBeforeResize, onApply, onLive });
// Returns open, isOpen, update, setViewBox, close, dispose.
```

`view.update(...)` already receives `state`, `errors`, `conflict`, `statusText`, `selectedNode`, `loadedPresetId`, `loadedPresetLoadToken`, `statusRows`, `appliedSummary`, `outputState`, `warpStates`, `namesWallStatus`, `clockScene`, `clockElement`, `clockLayouts`, and `clockHydration`. Use those inputs rather than a parallel state model. `fields` stays keyed as `${nodeId}:${path}` and `inspector:${path}`. Native task selection calls `onNode(id)`; no writes occur on selection.

Use `data-utility="presets|transfer|outputs"` on native `details` elements and `data-utility-status` on their short summary status. These are local DOM hooks, not a new public editor API. Keep existing button action names, callback payloads, and controls references.

## Task 1: Reorganize page chrome, utilities, and task navigation

**Files:** Modify `config-view.js`, `config.css`, and intentional DOM assumptions in `tests/projection-config/config-view.test.js`. Create `tests/projection-config/config-ui.test.js`. Preserve `config-controller.js` behavior.

**Consumes:** Existing view callbacks/update inputs and node IDs. **Produces:** Same view interface, grouped native task picker, adjacent inspector, collapsible utilities with accessible errors; Tasks 2/3 reuse these regions.

- [ ] **1. Establish focused failing interaction tests.** Add this local test setup to `config-ui.test.js`; use it for Tasks 1/2 rather than duplicating the existing large handwritten DOM stub.

```js
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createProjectionConfigView } from '../../frontend/src/projection-config/config-view.js';
import { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS } from '../../frontend/src/projection-config/config-controller.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
let mounted;
afterEach(() => {
  mounted?.dispose(); mounted = null;
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function mount({ touch = false, ...callbacks } = {}) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: touch, addEventListener() {}, removeEventListener() {},
  })));
  const root = document.createElement('main'); document.body.append(root);
  const onNode = vi.fn(); const onAction = vi.fn();
  mounted = createProjectionConfigView(root, {
    descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS],
    onNode, onAction, ...callbacks,
  });
  const state = { draft: structuredClone(DEFAULT_PROJECTION_CONFIG), live: false };
  mounted.update({ state, selectedNode: 'pre' });
  return { root, view: mounted, state, onNode, onAction };
}
test('compact task navigation preserves identity and does not apply geometry', () => {
  const { root, view, state, onNode, onAction } = mount({ touch: true });
  const picker = root.querySelector('.node-selector');
  expect([...picker.querySelectorAll('optgroup')].map(x => x.label))
    .toEqual(['Shared calibration', 'Left projector', 'Right projector', 'Content/layout']);
  picker.value = 'right-grid'; picker.dispatchEvent(new Event('change'));
  expect(onNode).toHaveBeenLastCalledWith('right-grid');
  expect(onAction).not.toHaveBeenCalled();
  view.update({ state, selectedNode: 'right-grid' });
  expect(picker.value).toBe('right-grid');
  expect(root.querySelector('[data-action="warp-editor-open-mobile"]').hidden).toBe(false);
  expect(root.querySelectorAll('iframe')).toHaveLength(0);
});
test('preset errors remain discoverable without expanding utilities on each refresh', () => {
  const { root, view, state } = mount({ touch: true });
  const utility = root.querySelector('[data-utility="presets"]');
  expect(utility.open).toBe(false);
  view.update({ state, errors: { name: 'Enter a preset name' } });
  expect(utility.querySelector('summary').textContent).toContain('Enter a preset name');
  utility.open = true;
  view.update({ state, errors: { name: 'Enter a preset name' } });
  expect(utility.open).toBe(true);
  expect(view.controls.actionError.textContent).toContain('Enter a preset name');
});
test('utilities follow compact editing and have a header access route', () => {
  const { root } = mount({ touch: true });
  const workspace = root.querySelector('.config-workspace');
  const utilities = root.querySelector('#projection-config-utilities');
  expect(workspace.compareDocumentPosition(utilities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(root.querySelector('.config-chrome a[href="#projection-config-utilities"]')).not.toBeNull();
});
```

Also extend current preset tests to assert loaded identity does not change on pending dropdown selection; transfer errors and output errors remain discoverable; touch output actions remain blocked; programmatic refresh never resets a utility's open state or entered name. Existing regressions already cover save/load/revert payloads, cold hydration, import naming, and display controls; retain them.

- [ ] **2. Run the new suite before implementation.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/config-ui.test.js
```

Expected: new grouping/utility assertions fail against the old DOM. Fix fixture/import errors before interpreting failures as behavioral evidence.

- [ ] **3. Rearrange existing elements and native disclosures.** Keep handlers bound to the same control nodes. Move Live/Apply, loaded preset identity, and calibration status into a compact header. Move preset controls, transfer/share controls, and workstation controls into one `.config-utilities` container outside `.config-chrome`, after `.config-workspace` in DOM order. Give it `id="projection-config-utilities"` and `tabIndex=-1`; a native header link labeled Presets & tools targets that container. Use native disclosures, collapsed initially on compact surfaces. Keep one copy of each control and its existing handler.

On desktop the utilities are a bottom layout region, with a bounded scroll area when expanded; on compact pages they follow editing in normal page flow. Scope error indications to utility summaries and expose the existing header action error too, so a failure does not become invisible below a long inspector. Route `errors.name` into preset summary, `errors.import` into transfer summary, and `outputState.error` into outputs summary; retain generic action/preview/conflict/hydration errors visibly in existing status controls when a more specific scope is unknown.

Use the current loadedPreset lookup for a separately labeled header identity; do not infer it from `controls.presets.value`. Add concise preset scope copy and distinguish Revert from Undo. Preserve protected presets and the existing Update/Save-as-new actions. Keep workstation-only instructions/capability restrictions intact, with minimal collapsed summary on touch surfaces.

Group options from the existing graph node list; do not duplicate the controller's selection state:

```js
const groups = new Map([
  ['Shared calibration', []], ['Left projector', []],
  ['Right projector', []], ['Content/layout', []],
]);
for (const [id, label] of graphNodes) {
  const group = id === 'pre' ? 'Shared calibration'
    : id.startsWith('left-') ? 'Left projector'
    : id.startsWith('right-') ? 'Right projector' : 'Content/layout';
  groups.get(group).push([id, label]);
}
for (const [label, entries] of groups) {
  const group = make(doc, 'optgroup', { label });
  for (const [value, text] of entries) group.appendChild(make(doc, 'option', { value }, text));
  selector.appendChild(group);
}
```

Replace the old selector option loop, not its `onNode` listener. Keep graph node IDs, ports, edges, and compact fields. The real settlement node will automatically group under Content/layout when supplied by its own plan.

- [ ] **4. Replace conflicting page-layout CSS and add scoped visual tokens.** Use normal layout flow for chrome and explicit graph/inspector columns; remove absolute chrome/workspace/inspector offsets and guessed header clearance. Keep graph viewport absolute only inside its own positioned graph region. Use a dark neutral surface hierarchy, one accent, readable labels, focus-visible styling, and tabular numbers. The existing stylesheet is the authority; consolidate competing tablet/landscape overrides rather than append another override chain.

Core arrangement, adapted to actual element nesting:

```css
.config-shell { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.config-chrome { position: static; min-width: 0; }
.config-workspace { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; }
.graph-column { position: relative; min-width: 0; min-height: 0; }
.inspector { position: static; width: auto; max-height: none; min-height: 0; overflow-y: auto; }
.config-utilities { max-height: min(40dvh, 320px); overflow-y: auto; }
@media (max-width: 1100px), (max-height: 700px), (pointer: coarse), (hover: none) {
  .projection-config-app { height: auto; min-height: 100dvh; }
  .config-shell, .config-workspace { display: block; height: auto; }
  .node-graph-viewport { display: none; }
  .inspector { overflow: visible; }
  .config-utilities { max-height: none; overflow: visible; }
}
```

An expanded utility must scroll within usable space or allow page scrolling; it must not make graph or editing recovery unreachable on short desktop heights. Collapsed desktop inspector keeps its summary/reopen action accessible. On compact layout the task picker, first useful control, and applicable editor-opening action precede expanded administrative content.

- [ ] **5. Verify and record Luna self-review.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/config-ui.test.js tests/projection-config/config-view.test.js tests/projection-config/config-controller.test.js tests/projection-config/node-canvas.test.js tests/projection-config/output-window-controller.test.js
git diff --check
```

Expected: all named suites pass; callback, preset, display restriction, and graph regressions remain protected. Luna reports changed files, checks, scope concerns, and self-review to the coordinator; commit only this verified task's changes on dev. Sol checks rendered header/graph/inspector at desktop and 390 by 844 in Task 4, including expanded utility placement and header-anchor access. Do not weaken DOM behavior tests merely to avoid updating an intentionally changed structural assumption.

## Task 2: Make parameter controls comfortable and stable

**Files:** Modify `config-view.js` and `config.css`; extend `config-ui.test.js` and affected existing field tests. **Consumes:** Same `fields`, descriptors, callbacks, and update inputs. **Produces:** Full-width touch sliders and stable numeric/readout feedback without new control semantics.

- [ ] **1. Add failing active-input/readout regressions using Task 1's local mount.**

```js
test('refresh preserves a typed numeric value and its displayed draft', () => {
  const { view, state } = mount({ touch: true });
  const field = view.fields.get('inspector:pre.tx');
  field.number.focus(); field.number.value = '1.5';
  field.number.dispatchEvent(new Event('input'));
  const before = field.value.textContent;
  const next = structuredClone(state); next.draft.pre.tx = 0.02;
  view.update({ state: next, selectedNode: 'pre' });
  expect(field.number.value).toBe('1.5');
  expect(field.value.textContent).toBe(before);
});
test('ordinary slider updates local value before callback and keeps it through refresh', () => {
  const onField = vi.fn();
  const { view, state } = mount({ touch: true, onField });
  const field = view.fields.get('inspector:pre.scale');
  field.range.focus(); field.range.value = '1.75';
  field.range.dispatchEvent(new Event('input'));
  expect(field.value.textContent).toBe('1.750 ×');
  expect(field.number.value).toBe('1.750');
  expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenLastCalledWith('pre.scale', '1.75', 'range');
  view.update({ state, selectedNode: 'pre' });
  expect(field.value.textContent).toBe('1.750 ×');
  expect(field.number.value).toBe('1.750');
  expect(onField).toHaveBeenCalledTimes(1);
});
test('release-commit slider feedback survives refresh without premature writes', () => {
  const onField = vi.fn();
  const { view, state } = mount({ touch: true, onField });
  const field = view.fields.get('inspector:namesWall.inwardShiftPercent');
  view.update({ state, selectedNode: 'names-wall' });
  const numberBefore = field.number.value;
  field.range.focus(); field.range.value = '50';
  field.range.dispatchEvent(new Event('input'));
  const before = field.value.textContent;
  view.update({ state, selectedNode: 'names-wall' });
  expect(field.value.textContent).toBe(before);
  expect(field.number.value).toBe(numberBefore);
  expect(onField).not.toHaveBeenCalled();
  const committed = structuredClone(state);
  committed.draft.namesWall.profiles.wall.inwardShiftPercent = 50;
  onField.mockImplementation(() => view.update({ state: committed, selectedNode: 'names-wall' }));
  field.range.dispatchEvent(new Event('change'));
  expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenLastCalledWith('namesWall.inwardShiftPercent', '50', 'range');
  expect(field.number.value).toBe('50');
  view.update({ state: committed, selectedNode: 'names-wall' });
  expect(field.number.value).toBe('50');
  field.number.focus(); field.number.blur();
  expect(onField).toHaveBeenLastCalledWith('namesWall.inwardShiftPercent', '50', 'number');
});
```

Keep incomplete numeric-text coverage in the existing handwritten DOM-stub tests, where `1.` and `-` are preserved, and verify native incomplete typing in the browser. Do not change production input type to accommodate a test. Verify +/- calls existing `onNudge(path, direction)` once. Retain blank-number controller regression and percentage normalization tests.

- [ ] **2. Run the new assertions before changing fields.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/config-ui.test.js tests/projection-config/config-controller.test.js
```

Expected: active readout/commit-preview refresh regressions fail where the current update overwrites them; existing commit tests pass.

- [ ] **3. Give touch inspector fields a full-width native range row.** Keep returned field members and original inputs/handlers. Use CSS grid areas to separate track from number/unit/nudges; graph cards retain compact dimensions. For example, on the inspector field row:

```css
.inspector .config-field-row { grid-template-columns: minmax(0, 1fr) auto 48px 48px; }
.inspector .config-field-row input[type=range] { grid-column: 1 / -1; width: 100%; min-height: 44px; }
.inspector .config-field-row input[type=number] { width: 100%; min-width: 0; }
.inspector .nudge { width: 48px; min-height: 48px; }
```

Keep labels outside that row, stable value/unit placement, and a visible focus ring. Explicitly place the extra output used by release-commit fields so it does not create an accidental third-column overflow. Style native track/thumb for comfortable touch use; do not build a custom slider.

- [ ] **4. Update slider feedback before callbacks, then preserve active fields during refresh.** Replace the range input binding with a small local handler that updates its formatted readout before invoking the original callback. Convert displayed percentage input back to descriptor units before calling `displayValue`, avoiding double percentage conversion. Ordinary ranges also update their paired numeric value locally. Release-commit ranges retain the prior numeric value during preview, then synchronize it before the completed change invokes the callback, including when a synchronous refresh occurs with the range still focused.

```js
const showRangeValue = () => {
  const raw = Number(range.value);
  const normalized = descriptor.display === 'percentage' ? raw / 100 : raw;
  const formatted = displayValue(descriptor, normalized);
  value.textContent = `${formatted}${descriptor.unit ? ` ${descriptor.unit}` : ''}`;
  return formatted;
};
const onRangeInput = (event) => {
  const formatted = showRangeValue();
  if (!descriptor.commitOnChange) {
    if (number) number.value = formatted;
    onInput(event);
  }
};
range.addEventListener('input', onRangeInput);
if (descriptor.commitOnChange) range.addEventListener('change', (event) => {
  const formatted = showRangeValue();
  if (number) number.value = formatted;
  onInput(event);
});
// Replace the old range input/change listeners with these bindings;
// retain all numeric/nudge handlers.
```

Extend the existing active-element guard to the field's paired controls and readout rather than only the focused input. Use the current field object; no draft store is added.

```js
const editing = doc.activeElement === control.range || doc.activeElement === control.number;
if (!editing) {
  for (const input of [control.range, control.number]) if (input) input.value = display;
  control.value.textContent = `${display}${descriptor.unit ? ` ${descriptor.unit}` : ''}`;
}
```

Ordinary sliders retain the existing one-callback-per-input behavior. Update the existing release-commit readout test's intentional text expectation if it now includes formatting/units; do not change its no-write-before-change assertion. Do not suppress conflicts/disconnects or maintain local draft feedback after the field loses focus if a new authoritative value needs rendering. Retain Enter/blur behavior, release-commit exceptions, error association, and range/percentage precision.

- [ ] **5. Verify and record Luna self-review.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/config-ui.test.js tests/projection-config/config-view.test.js tests/projection-config/config-controller.test.js tests/shared/projection-config-client.test.js
git diff --check
```

Luna reports focused verification and self-review; the coordinator commits the task-owned changes. Sol performs the rendered checks in Task 4: track width, >=44px targets, no clipping of units/errors, native keyboard behavior, and stable value during updates. Actual touch-scroll quality remains a physical-device acceptance check.

## Task 3: Expose tablet warp precision controls and selection feedback

**Files:** Modify `config-view.js`, `warp-editor-dialog.js`, and `config.css`; extend existing `warp-editor-dialog.test.js`, `config-ui.test.js`, and relevant config-view/warp tests. Change `warp-pointer-input.js` only if the explicit device probe below proves a threshold is needed.

**Consumes:** Existing dialog/editor interfaces and `warpStates[output] = { selection, stepMode, config, handles, baselineAvailable, ... }`. **Produces:** Same geometry/history/preview contracts, visible touch precision panel, persistent selection identity, and lifecycle-correct refitting.

- [ ] **1. Add focused failing dialog/selection tests.** In `warp-editor-dialog.test.js` use its existing `setup()` helper:

```js
test('touch opening exposes precision controls and preserves one preview', () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const { dialog, opener } = setup();
  try {
    dialog.update(DEFAULT_PROJECTION_CONFIG);
    dialog.open({ side: 'right', mode: 'grid', opener });
    expect(document.querySelector('.warp-editor-fine-panel').hidden).toBe(false);
    expect(document.querySelector('[data-action="warp-editor-fine"]').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.warp-editor-title').textContent).toContain('Right');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    dialog.close(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  } finally { dialog.dispose(); window.matchMedia = original; }
});
```

In `config-ui.test.js`, use `createWarpEditor` (import from its existing module), select a grid row, and pass its `getState()/getConfig()/getControlPoints()` through `view.update`. Assert selection feedback says Row 4 and 7 points for Left, or 8 points for Right. Use an identity baseline for that output in the fixture; do not depend on imported TD assets for this DOM test. Existing suites prove point/group movement, pointer ownership, invalid meshes, cancellation, and history; retain them.

- [ ] **2. Run these assertions before implementation.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/warp-editor-dialog.test.js tests/projection-config/config-ui.test.js
```

Expected: touch default panel and explicit group-count assertions fail; old one-frame, focus, session identity, resize, and orientation protections continue to pass.

- [ ] **3. Rearrange existing warp panel sections without cloning controls.** Move selection status, step, directional buttons, and the existing Undo button into `.warp-fine-primary`; leave coordinates/group picker/bypass/reset/Redo in `.warp-fine-secondary`. Update any code that locates reset buttons by child position to stable existing `data-warp-action` references before moving Undo. Never create a second Undo handler/control with divergent state.

Render selected identity and count from the existing selection:

```js
const count = warpState.selection?.indices?.length || 0;
const kind = warpState.selection?.kind || 'point';
const index = Number(warpState.selection?.index ?? 0) + 1;
const corners = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
const edges = ['Top edge', 'Right edge', 'Bottom edge', 'Left edge'];
const selectedLabel = kind === 'all' ? 'All points'
  : kind === 'edge' ? edges[index - 1]
  : kind === 'corner' ? corners[index - 1]
  : `${kind[0].toUpperCase()}${kind.slice(1)} ${index}`;
// Include output, stage, selectedLabel, count > 1 ? `${count} points` : '',
// step and existing baseline-unavailable message in the visible status.
```

Use the existing `data-direction` button values to arrange a cross with CSS grid. Keep 0.25/1px steps and existing `onWarpAction` payloads. Selected markers remain legible at preview fit scale. Preserve the current 22 CSS-pixel hit radius and mapped gesture coordinates; visual marker sizing must not alter hit ownership or mesh evaluation.

- [ ] **4. Show precision controls by default on touch and preserve collapse.** In `dialog.open`, derive the initial panel visibility from coarse-pointer/no-hover media, set matching `aria-expanded`, and leave the existing toggle and `onFineToggle` cancellation path intact. Reopening explicitly restores the appropriate default; repeated same-output mode switches preserve the current explicit panel preference. Do not add persisted panel preference state.

```js
const touch = Boolean(win?.matchMedia?.('(pointer: coarse)')?.matches
  || win?.matchMedia?.('(hover: none)')?.matches);
finePanel.hidden = !touch;
fineToggle.setAttribute('aria-expanded', String(touch));
```

Landscape with enough space uses preview plus approximately 280px controls; portrait/narrow space stacks them. Keep primary controls accessible and secondary controls scrollable. Replace fixed minimum panel heights that exceed a reduced viewport; allow a short-height arrangement where context/Close/Undo/Live/Apply remain reachable. Preserve preview aspect fit and `setViewBox` behavior.

If actual keyboard resizing does not trigger existing viewport listeners, add only a scoped `visualViewport.resize` listener while the dialog is open. It invokes the existing cancel-before-fit path and is removed on close/dispose. Use one viewport height source for layout and fitting; do not add polling or a new resize owner. Cover that listener's cancellation and removal only if it is added.

- [ ] **5. Preserve input protections and test any observed threshold separately.** Verify the existing 22px hit radius, frozen output/rect/viewBox, primary pointer, release displacement, group drag, cancel restore, and one-history-entry behavior. Do not add a drag threshold by default. If the actual Galaxy Tab produces unintended movement when tapping, first capture a reproducing gesture, then add a small constant CSS-pixel movement threshold in the existing binder. It must account for pointer-up-only movement and retain the original start offset; a cancelled selection-only gesture produces no geometry change. Add exact reproducing tests before that conditional edit, including group/second-pointer/cancel paths.

- [ ] **6. Verify and record Luna self-review.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config/config-ui.test.js tests/projection-config/config-view.test.js tests/projection-config/config-controller.test.js tests/projection-config/warp-editor-dialog.test.js tests/projection-config/warp-pointer-input.test.js tests/projection-config/warp-editor.test.js tests/projection-config/warp-viewport.test.js
git diff --check
```

Luna reports verification and self-review; the coordinator commits this task's changes. Sol checks landscape/portrait visibility, collapse/reopen, selection identity, Undo/Close, outline/handles, and frame cleanup in Task 4. Rendering/current-draft status waits for the matching preview response; output acknowledgement remains separate in the footer.

## Task 4: Align existing editors and record actual acceptance

**Files:** Modify `clock-layout-editor-dialog.js`, `clock-layout-controls.js`, `config.css` as required for consistent placement; extend existing `clock-layout-integration.test.js` and `clock-layout-editor-dialog.test.js`; append `otef-interactive/docs/projection-config-acceptance.md`. Settlement controls/dialog/node-canvas changes belong to the separate settlement plan when present.

**Consumes:** Tasks 1-3 layout/field conventions and existing clock layout client/state. **Produces:** Coherent editor presentation without shared transaction machinery, regression/build evidence, and explicitly separated browser/device acceptance.

- [ ] **1. Add failing copy/context assertions where needed, preserving existing integration coverage.** Clock/legend inspector and modal must say completed edits autosave independently of calibration Live; projection editor identifies Left, GIS identifies its scene. Extend the existing jsdom integration tests rather than introducing another mount framework. Existing tests already exercise failed-save/conflict retention after close, selection synchronization, unload protection, focus restoration, and warp/clock preview exclusivity; keep those assertions through DOM rearrangement.

Implementation copy can use the existing selected resource:

```js
const saveScope = 'Completed edits save automatically; calibration Live does not control this layout.';
const outputContext = selection.surface === 'projection' ? 'Left projector' : `GIS / ${selection.label}`;
// Render outputContext near the existing title and saveScope by existing parameters/status.
```

Use the same token/spacing/Close/status placement rules as warp, but retain clock/legend's existing preview fitting, mapping warnings, Retry/Load saved, and explicit GIS Show on exhibit action. Do not add Apply or output selectors where unsupported. Opening/switching previews remains read-only; Show on exhibit keeps its intentional existing command path.

- [ ] **2. Coordinate the actual settlement feature without duplication.** Recheck whether `settlement-names` exists in current view/node-canvas. If present, verify it belongs to Content/layout without a geometry edge, uses a normal selector, distinguishes output X/Y from both-output typography, states independent autosave, and follows consistent modal positioning/single-preview lifecycle. Run its real integration suites named in its plan only when those modules exist. If absent, do not add placeholders, run nonexistent tests, or claim settlement-specific acceptance; record that compatibility is specified and final integration is owned by the settlement plan.

- [ ] **3. Run final focused frontend, Django, build, and whitespace gates.**

```powershell
npm --prefix otef-interactive test -- tests/projection-config tests/shared/projection-config-client.test.js tests/shared/projection-config-schema.test.js tests/shared/projection-warp-schema.test.js tests/shared/projection-warp-geometry.test.js tests/projection/projection-config-runtime.test.js tests/projection/projection-clock-preview.test.js tests/projection/projection-preview-bridge.test.js tests/entries/projection-config-clock-boot.test.js
docker compose exec nur-api python manage.py test backend.tests.test_projection_config_api backend.tests.test_projection_config_schema backend.tests.test_projection_config_migration backend.tests.test_projection_config_baseline backend.tests.test_projection_warp
npm --prefix otef-interactive run build:frontend
git diff --check
```

Expected: all suites/build pass; Django uses its separate test database. No production migration, API restart, or database write is required for this redesign. Report failures or unavailable checks with their actual causes. Once gates pass, rerun only affected checks if review fixes introduce changes.

- [ ] **4. Have Sol review completed code and perform browser checks.** After Luna finishes implementation and automated checks, have the coordinator commit the verified Task 4 implementation and record the full change range from the pre-implementation base to that revision. Give Sol the spec, plan, complete diff, test results, and known device/settlement limitations. Sol first reports requirements/code-quality findings; route blocking application fixes to Luna, rerun affected checks, and obtain Sol approval of the changed range before final browser acceptance. No per-task Sol review is required.

Sol uses the browser skill to verify actual nginx-served source at `http://localhost/otef-interactive/projection-config.html` matches the reviewed revision. Do not substitute Vite-only evidence. Start no output windows and reload no running projector tabs. Preserve an existing user config tab's work; use a separate inspection tab if necessary.

Check desktop 1440 by 900, short desktop 1280 by 720, phone 390 by 844, tablet-sized portrait 820 by 1180 and landscape 1180 by 820, plus the actual tablet's reported CSS viewport. Viewport screenshots cannot emulate physical coarse pointer or touch. Verify first useful controls on phone, no horizontal overflow, header/graph/inspector separation, utility expansion/errors, readable units/targets, keyboard focus, native slider input, modal identity/collapse, one preview on open and zero after close. Adjust viewport sizing to the actual layout when browser controls reduce height; do not promise physical equivalence from those representative sizes.

Use Live off and exact restoration for geometry/slider drafts. Clock/legend autosave despite calibration Live off: test save behavior through focused fixtures unless live content adjustment is separately authorized. Do not intentionally mutate real clock/legend or settlement data merely to validate styling. Sol captures screenshots and meaningful DOM/protocol evidence locally, resetting temporary viewport overrides and closing temporary inspection tabs afterwards. Browser failures requiring code/style changes go to Luna; Sol reruns affected browser checks after those fixes.

Save a small representative screenshot set under `.superpowers/sdd/projection-config-ui/screenshots/<reviewed-revision>/`: desktop main page, phone main page, an expanded utility, tablet warp in portrait and landscape, and an existing clock/legend editor. Include the real settlement editor when implemented. Capture additional error/interaction states only when needed to assess a finding. For each screenshot record its absolute path, CSS viewport, selected tool/output, visible state, and reviewed revision. Never reuse pre-fix screenshots to approve a changed UI.

- [ ] **5. Record Galaxy Tab and physical acceptance honestly.** On the actual 11-inch Galaxy Tab beside the model, select a Right grid point, drag, refine with four 0.25-pixel nudges, Undo, enter X, change orientation with the numeric keyboard open, then scroll past and adjust a slider. Test Live off and intentionally authorized Live on; preserve and restore known geometry. Verify zero unintended scroll edits, wrong-output changes, stuck gestures, or inaccessible recovery controls, and distinguish draft/rendered/stored/output-acknowledged state. Record observed response delay on the actual network without claiming a new latency guarantee.

If hardware is unavailable, finish independent implementation/browser work and record device/optical acceptance as pending. Do not mark those gates passed, add speculative gesture infrastructure to compensate, or imply software acknowledgements establish physical alignment. Record exact firmware/browser/viewport only when observed, not guessed from the device name.

- [ ] **6. Send Sol's screenshots to Astra, resolve visual findings, and finalize evidence.** Sol sends Astra the screenshot absolute paths, viewport/tool/state context, reviewed revision, spec, and browser findings using the authorized agent coordination workflow. Astra opens and visually inspects the saved screenshots; source inspection or a prose report does not replace viewing the actual images. Inspect hierarchy, spacing, readability, selected-state emphasis, touch affordances, mobile/tablet use of space, and consistency across editor/page surfaces. Distinguish visual findings from physical touch/latency/alignment checks that screenshots cannot establish.

Route visual findings to Luna for focused fixes. Rerun affected automated checks, have Sol review changed code and repeat affected browser checks with new screenshots, then have Astra inspect that updated evidence. Continue until no blocking code/browser/visual findings remain; keep genuine unavailable hardware/settlement acceptance separately pending rather than fabricating a pass.

Luna updates the acceptance record from Sol/Astra reports: named commands/results, screenshot paths/revisions and visual verdict, actual viewport/device checks, limitations, unchanged calibration/preset accounting, settlement availability, and per-module added/removed/net lines. `git diff --numstat` over the recorded implementation range gives tracked line accounting; explicitly include any new source/test files absent from that output. Do not delete ignored artifacts or previous evidence.

The coordinator commits verified fixes and the final acceptance documentation on dev, then verifies that the screenshot revision identifies the same source implementation; documentation-only commits do not require recapturing unchanged UI. Report the implementation commit range, Sol code/browser verdicts, Astra visual verdict, and pending physical/integration checks separately. Do not push or merge.

## Plan self-review and review history

Coverage: page/visual/navigation/utilities/status -> Task 1; sliders/entry/precision preservation -> Task 2; tablet warp/selection/lifecycle/keyboard -> Task 3; editor consistency/settlement coordination/regression/rendered/device acceptance -> Task 4. All tasks inherit save/geometry/preset and no-overengineering constraints.

Before review, check every referenced path and interface against the repository, check test fixtures for native number/media behavior, scan for unresolved placeholders, and verify no task assumes the settlement implementation has already shipped. This plan creates no application APIs or generalized abstractions.

- Sol round 1: requirements, implementation readiness, and tightness passed. Applied ordinary-slider readout clarification and descriptive keystone labels.
- Astra round 1: requirements and tightness passed; implementation needed two focused fixes. Added direct input feedback before callbacks and explicit single-container utility placement after compact editing, with bounded desktop scrolling. Removed the sanitized-number ambiguity from the jsdom example.
- Sol round 2: requirements, implementation readiness, and tightness passed; no blockers.
- Astra round 2: requirements/tightness passed; identified a stale numeric partner after release-commit change. Synchronize that number before the existing change callback and prove preview/no-write, committed pair, synchronous-refresh, and subsequent numeric-blur behavior.
- Sol round 3: final requirements, implementation readiness, and tightness pass; no remaining blockers.
- Astra round 3: final requirements, implementation readiness, and tightness pass; no remaining blockers or further planning review needed. Implementation and device acceptance remain execution work.
- Owner execution update: commits on dev authorized; all implementation/fixes assigned to Luna, Sol code review and browser checks at the end, then direct screenshot handoff to Astra for visual inspection. Removed per-task Sol review requirements; code/browser/visual failures still require focused fix-and-recheck loops.
- Luna workflow consistency check: pass; spec and plan agree on commit authorization, model roles, end-of-work review, screenshot handoff, and preserved scope/physical acceptance boundaries.
