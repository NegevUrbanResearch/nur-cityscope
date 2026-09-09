# NLI Segev Selector and Marker Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Satellite variant row with a responsive anchored popover and make the projection Segev marker substantially smaller.

**Architecture:** Keep popover-open state local to the remote basemap controller and independent from the durable basemap value. Keep marker sizing in the existing projection display profile so GIS rendering is unchanged.

**Tech Stack:** Vanilla JavaScript, CSS, HTML, Vitest, Playwright smoke harness.

## Global Constraints

- Work on the existing `dev` checkout.
- Do not commit, push, create a branch, or create a worktree.
- Preserve the existing narrative camera logic; the reported camera conflict was caused by two GIS windows.
- Use test-first RED/GREEN cycles and verify the rendered remote surface.

---

### Task 1: Anchored Satellite variant popover

**Files:**
- Modify: `otef-interactive/frontend/remote-controller.html`
- Modify: `otef-interactive/frontend/css/remote-styles.css`
- Modify: `otef-interactive/frontend/src/remote/remote-controller.js`
- Modify: `otef-interactive/tests/remote/remote-basemap-controls.test.js`
- Modify: `otef-interactive/tests/remote/remote-tab-panels-hidden-contract.test.js`

**Interfaces:**
- `createRemoteBasemapController()` owns an ephemeral `menuOpen` boolean.
- Satellite parent toggles the menu without selecting a basemap.
- A variant selection sends exactly one basemap command and closes the menu.

- [ ] Add failing behavior tests for parent toggle, no immediate command, variant auto-close, outside click, Escape, active-state non-opening, disabled-state closure, and teardown.
- [ ] Add failing structure/style tests proving the variant container is anchored inside a relative Satellite wrapper, absolutely positioned, responsive, and does not add a grid row.
- [ ] Run `npm.cmd test -- tests/remote/remote-basemap-controls.test.js tests/remote/remote-tab-panels-hidden-contract.test.js` and witness RED.
- [ ] Implement the wrapper, floating CSS, and controller-owned open state. Add document listeners with deterministic cleanup.
- [ ] Re-run the focused tests and the complete remote suite; expect GREEN.
- [ ] Run the bounded real-entry remote smoke and verify no layout shift and immediate close after both choices.

### Task 2: Compact projection narrative marker

**Files:**
- Modify: `otef-interactive/frontend/src/shared/nli-investigation-theme.js`
- Modify: `otef-interactive/tests/shared/maplibre-narrative-focus.test.js`

**Interfaces:**
- Projection narrative profile becomes halo radius `6`, stroke `1.5`, text size `11`, and text halo `1.1`.
- GIS narrative profile remains exactly `9`, `2`, `16`, and `1.5`.

- [ ] Change the projection-profile expectations first and run the focus test to witness RED.
- [ ] Update only the projection `narrativeFocus` tokens.
- [ ] Run the shared focus, projection narrative, and GIS narrative suites; expect GREEN and unchanged GIS values.
- [ ] Run the production frontend build and `git diff --check`.

## Self-Review

- The popover is independent from basemap selection and cannot reopen on reconnect.
- No camera, backend, narrative-state, GIS marker, or projection-highlight behavior changes.
- Both tasks have direct behavioral tests and a rendered remote check.
