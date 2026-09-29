# Projection Config UI redesign

Date: 2026-09-29

Status: Approved for implementation planning; spec and implementation plan passed Sol/Astra reviews. The owner subsequently authorized commits on dev and selected the execution/review workflow below. No application implementation or exhibit mutation has run for this redesign.

## Purpose and scope

Make Projection Config clear, comfortable, and precise on desktop and touch devices when moving the project from the lab to the NLI exhibit. Preserve the working projection configuration and most of the node canvas. Redesign the surrounding interface and improve access to existing editing tools.

The operator expects to use both the workstation and an 11-inch Galaxy Tab. Keystone and grid warp will commonly be adjusted on the tablet while standing near the physical model. Parameter sliders must also feel good on touch devices. Phones remain supported for occasional adjustments.

Keep this an internal technician tool. Use the existing ES modules, native controls, CSS, callbacks, clients, and editor lifecycles. No new frontend shell, dependency, state store, service, schema, or generalized editor framework is required.

The settlement-name feature has its own spec and plan:

- `docs/superpowers/specs/2026-09-29-settlement-name-config-design.md`
- `docs/superpowers/plans/2026-09-29-settlement-name-config.md`

This redesign accommodates that feature without implementing its renderer, persistence, initialization, or migration. Integrate the actual settlement node when its implementation is available; do not ship a dummy node or editor.

## Evidence and decisions

Read-only inspection of the current nginx-served page found that at 390 by 844 CSS pixels the calibration toolbar occupies 300 pixels and workstation output controls occupy another 390 pixels. The editing inspector begins at vertical position 847, below the initial viewport. On desktop the output-launch controls overlay the graph.

The owner approved reorganizing the workspace rather than a cosmetic-only refresh or a calibration wizard. Preserve desktop graph relationships, dragging, pan, zoom, and inline controls. Use grouped task selection and focused controls on compact screens.

Sol reviewed responsive usability, calibration flow, and implementation economy. Astra examined persistence misunderstanding, touch operation, and recovery assumptions. Both recommended making existing precision controls immediately accessible on tablets and keeping independent save domains explicit.

Searchable settlement selection and an installation checklist are explicitly excluded. Do not add a guided wizard, automatic calibration, preset thumbnails, a new profile system, global undo, a custom numeric keyboard, or a magnifier. A cross-domain exhibit backup/restore feature is outside this scope.

## Visual treatment

Use restrained dark surfaces, readable system typography, consistent spacing, and one accent for primary actions and selection. Reserve distinct semantic colors for errors, warnings, and successful acknowledgements; never communicate state through color alone.

Reduce competing borders, heavy shadows, and unrelated controls presented with equal emphasis. Use a small reusable set of CSS variables within the config stylesheet for surfaces, text, borders, accent, spacing, and control dimensions. Do not introduce a design-system package or theme switcher.

Keep field labels and units legible, numeric values stable through tabular digits, keyboard focus visible, and disabled states understandable. Interactive targets are at least 44 CSS pixels on touch surfaces; use approximately 48 pixels for the directional nudge controls. Invisible handle hit areas can be larger than their visible marker.

## Page organization

### Header and utilities

Place a compact header in normal layout flow outside the graph. It contains the page title, loaded calibration preset identity, calibration status, and clearly scoped calibration Live/Apply controls. A long preset name may truncate visually while remaining available in full to assistive technology and within preset management.

Keep routine editing immediately accessible. Separate secondary utilities into named panels or disclosures:

- Presets: distinguish the actually loaded preset from an item selected for loading. Keep Update preset, Save as new, Load, and Revert, preserving their existing operations and read-only preset rules.
- Transfer and sharing: import, export, link, and QR behavior remain available without occupying the initial mobile editing area.
- Workstation outputs: display identification, assignments, Open Both, Close Both, and existing handoff instructions remain accessible on the workstation. On a phone/tablet, show a concise workstation-only explanation rather than an expanded block of unusable controls. Preserve the current capability restrictions.

Scope error/status messages to their operation. A collapsed utility with an unresolved failure must expose an error indication and a route to its details. Disclosures must not intercept form input or dismiss pending failures.

Do not relabel Revert as local Undo. Revert is an existing calibration operation with output effects. Preset actions can also change applied calibration; their labels/help must not suggest they are passive backups.

### Desktop workspace

Use explicit layout regions: header, graph, and adjacent inspector. Do not rely on an assumed header height or place administrative panels over graph controls. Keep the inspector stable while the graph pans or zooms. It may collapse to recover graph space; selected task and reopening action remain accessible.

Retain the graph nodes, edges, compact inline controls, and existing selection identity. The inspector presents the selected node's full controls. Put patterns and detailed application diagnostics near the relevant calibration context, with details collapsible. Preserve pattern branch selection and cleanup behavior.

### Compact workspace

Keep the existing compact alternative to the graph. Use one grouped task picker with Shared calibration, Left projector, Right projector, and Content/layout groups. Existing node IDs and callbacks remain authoritative; changing tasks is not a save or geometry edit.

The selected task, affected output/scope, controls, and Open editor action appear immediately after the compact header. Secondary utility panels start collapsed. The page scrolls naturally without horizontal overflow. A coarse pointer or limited usable width/height must not force the desktop graph interface.

Avoid a second mobile navigation state: page, graph, task picker, and modal selection must agree. Preserve selection, drafts, and ordinary editor ownership during layout changes.

## Tablet warp editor

### Layout

Landscape uses a large preview next to a narrow adjustment panel, approximately 280 pixels where available. Portrait uses preview above the adjustment panel. Do not infer CSS viewport dimensions from the tablet's screen diagonal; choose layout from available space and input capability.

Keep tool and output identity visible, such as Right / Grid Warp. Close, current selection, step size, directional nudges, and Undo remain reachable. Show the essential adjustment controls by default on touch devices rather than hiding them behind Fine adjustment. Allow panel collapse for a larger preview.

Keep numeric coordinates, group selection, bypass, and reset actions in the secondary scrollable portion. Arrange directional buttons spatially as a cross rather than an unrelated row. Show the existing step explicitly, for example 0.25 output px per tap. Retain the existing fine 0.25-pixel and coarse 1-pixel steps.

Preserve the editor's focus handling, Escape/Close, keyboard opening, restoration of focus, and single-preview lifecycle. Keep Live/Apply and acknowledgement visible without long messages consuming the preview. Short summaries can open detailed errors.

### Selection and touch

Retain tap-to-select and direct dragging. Make selected handles visually distinct with a marker/ring that remains legible as the preview fits the available space. Display selected corner, point, edge, row, or column identity away from the finger. For group selections show how many points will move. Keep the existing selection picker as an alternative to tapping dense handles.

Keep the existing screen-space handle hit detection, pointer ownership/capture, frozen gesture mapping, valid mesh constraints, and cancellation/restoration behavior. Moving a finger must not cause a handle to jump to the initial touch position. Existing group movement must remain explicit rather than becoming silent single-point movement.

A small drag threshold is a candidate improvement, not a requirement to add speculative gesture machinery. First test whether tapping a handle on the actual tablet produces accidental edits; add a narrowly scoped screen-space threshold only if this problem is observed. A tap then remains selection-only and movement beyond the threshold preserves the initial handle offset.

Dragging provides larger movement; nudges and numeric entry provide precision. Do not change the coordinate system, ranges, warp mesh, or history semantics. Undo reverses the existing edit, including one completed drag as one history entry.

The preview surface owns its active drag; the parameter panel owns scrolling. Preserve cancellation on pointer loss, blur, output/tool switch, resize, and orientation change. With calibration Live enabled, cancellation can require restoring the starting state on outputs; do not promise that a cancelled gesture never sent a live update.

### Keyboard and resizing

Account for browser controls, safe areas, and the numeric keyboard. Essential context, Close, and recovery controls remain reachable in reduced height. Secondary settings scroll; do not add fixed minimum regions whose combined heights exceed the usable viewport. Preview fitting retains the renderer's aspect ratio and mapping.

Changing orientation or usable viewport during a gesture cancels/restores it before fitting again. Do not clear a completed draft or silently change output selection. Actual keyboard behavior requires device validation, beyond viewport screenshots.

## Parameter fields and sliders

On touch/compact inspectors, give each slider its own full-width row. Present label and value/unit clearly; place numeric entry and fine decrease/increase controls together separately. Do not squeeze the track into the remaining space after four other controls.

Keep native range controls initially. Style a comfortable thumb and touch area while preserving keyboard behavior. The surrounding panel must scroll naturally. Verify vertical scrolling does not unintentionally change values before adding any custom gesture handling.

Preserve descriptor ranges, steps, units, precision, validation, and numeric commit behavior. Ordinary sliders update on input through existing calibration Live scheduling; fields already configured to commit on release retain that behavior. Descriptor-based parameter fields retain blur/Enter commits; warp and independent editors retain their existing completed-edit commit paths. Invalid or incomplete values must not become zero. Do not add Apply requests for every pointer event or globally switch to release-only updates.

Keep the active field, thumb, and entered number stable during ordinary render refreshes and delayed acknowledgements. Genuine conflicts/disconnects retain visible errors and existing recovery behavior rather than being hidden to preserve apparent smoothness.

Desktop graph controls may remain compact; tablet and inspector controls must not inherit graph-scale sizing.

## Save scope and feedback

Present three different facts separately: the selected edit's storage state, calibration application state, and available output acknowledgements. Do not derive a global Ready indicator from saved data or renderer responses. Acknowledged rendering does not prove physical alignment or perceived response speed.

| Domain | Behavior | Preset scope |
| --- | --- | --- |
| Projector geometry and people-name wall settings, including planned wall rotation | Existing calibration Live/Apply/Save behavior | Calibration presets contain these settings |
| Clock and legend layouts | Existing independent save behavior | Not restored by calibration presets |
| Planned settlement position and shared typography | Completed edits autosave independently, including with calibration Live off | Not restored by calibration presets |
| Workstation display assignment | Existing workstation/browser storage and capability behavior | Not restored by calibration presets |

Explain calibration Live scope near the control. For independent editors say that completed edits save automatically. Preserve Loading, Saving, Saved, failed-save, hydration, and conflict states. A failure or pending completed edit remains visible after closing its modal through the existing domain status on its node or inspector. Retry and Load saved retain their existing domain behavior.

Update local controls and draft feedback promptly through the existing editor path while retaining validated transport and coalescing. Retain the Rendering / Current draft distinction until the matching preview acknowledges rendering. Show when changes are local because calibration Live is off, when application is pending, and which output acknowledgement is available. Existing unconfirmed and failure states must not become success through simplified wording.

Preserve loaded-preset name prefilling, typed names during ordinary updates, explicit-load naming behavior, protected Original/TD presets, and reload-loss guidance. Explain preset contents at preset management. Keep reset targets precise: settlement reset returns to the captured position, and historical calibration presets do not calculate alignment for a new venue.

## Settlement and other editor integration

Add the actual Settlement names node to Content/layout and the graph's content/settings column without calibration-transform edges, following its separate plan. Clearly distinguish it from the people-name wall. Its output and selected settlement scope X/Y; typography applies to both projectors. Use a normal non-searchable settlement selector.

Use consistent placement for tool title, output/selection, status, Close, preview, and parameters across warp, clock/legend, and settlement editors. Preserve their different actions and transaction semantics. Do not force clock or settlement autosave into calibration Live/Apply.

Retain one active preview only. Settlement/clock previews use their defined accepted calibration rather than silently adopting the page's uncommitted geometry. Closing or switching editors destroys the old preview and preserves completed pending edits according to the existing client contract. Opening a preview must not alter exhibit playback, scene, people selection, or display assignment.

## Implementation boundaries

Primary changes belong in `otef-interactive/frontend/src/projection-config/config-view.js`, `config.css`, and the existing editor view modules. Keep controllers, descriptors, clients, node IDs, and geometry authoritative. Extract a small focused view helper only when it simplifies these changes; do not use the redesign to reorganize unrelated projection code.

Preserve existing handlers and cleanup while rearranging DOM. No second socket, persistent hidden preview, polling loop, broad style migration, backend API, database change, or projector reload is required.

## Execution and review ownership

The owner's current authorization permits commits for this work on the existing dev branch, including this spec and its plan. It does not authorize a push, merge, new branch/worktree, or unrelated changes. The coordinator commits only task-owned files after applicable checks; raw screenshots/captures stay local unless separately requested.

Use fresh Luna (`gpt-6-luna`) subagents for implementation tasks and all application fixes, with the coordinator managing dependencies and shared-file access. Tasks that edit the same view/CSS run sequentially. Each Luna performs its focused tests and self-review; there is no separate Sol review after every task.

After implementation and required automated checks, Sol (`gpt-6-sol`) reviews the complete code change and performs the rendered browser checks. Sol saves representative screenshots of the final page/editors, then sends their absolute paths, viewport/state context, and exact reviewed revision to Astra (`gpt-6-astra`) for visual inspection against this spec. Astra must view the screenshots and assess hierarchy, spacing, readability, touch affordances, responsive layout, and consistency; source inspection alone cannot establish visual acceptance.

Findings go back to Luna for fixes. Rerun affected checks, and have Sol refresh browser evidence and screenshots when the UI changes before Astra rereviews. Keep code and visual verdicts separate. Browser screenshots do not substitute for physical Galaxy Tab touch, keyboard, network-response, or optical-alignment checks; record unavailable hardware checks as pending.

## Verification and acceptance

Add focused regression tests for changed behavior before implementation. Cover task selection synchronization, utility visibility/error access, selected-field isolation, slider/numeric stability, preserved preset semantics, and tablet warp controls/selection/ownership. Extend existing suites rather than adding tests that simply reproduce CSS declarations.

Run relevant config/editor/client tests, required adjacent regression checks, frontend build, and git diff --check. Follow the repository workflow for relevant Django checks. Record what actually ran; do not claim new settlement modules or physical acceptance have passed before they exist or are exercised. Report module line growth.

Inspect the actual nginx-served page on desktop and compact portrait/landscape viewports. The task picker, selected task identity, first editable control, and Open editor action when applicable must be reachable in the initial phone viewport without scrolling past administrative panels; remaining fields may scroll. Verify no horizontal overflow, stable graph/inspector regions, readable units, visible focus, reachable errors, one preview after open, and zero previews after close.

On the actual Galaxy Tab beside the model, select a Right grid point, drag, refine with four 0.25-pixel nudges, Undo, enter X numerically, change tablet orientation with the numeric keyboard open, then scroll past and adjust a parameter slider. Exercise Live off and Live on intentionally, accounting for any changed calibration. Pass only with no unintended scroll edits, wrong-output changes, stuck gestures, hidden recovery actions, or ambiguous local/applied feedback. Record observed projector response delay; localhost timing and screenshots do not establish venue responsiveness.

Preserve running projector tabs and accepted calibration during design work. Implementation verification must not overwrite presets or reload outputs merely to inspect styling. When live physical adjustment tests are authorized, retain and restore known values and distinguish software evidence from optical alignment acceptance.

## Review record

- Sol round 1: requirements and tightness passed; no blockers. Clarified initial phone access, orientation testing, and domain-local pending status; removed redundant self-review text.
- Astra round 1: requirements, implementation design, and tightness passed; no blockers. Preserved editor-specific numeric commits and asynchronous preview acknowledgement rather than inferring interaction or rendering changes.
- Sol round 2: final requirements and tightness pass; no remaining blockers or unnecessary machinery. Ready for implementation planning.
- Astra round 2: final requirements, implementation-design readiness, and tightness pass; no remaining blockers. Actual tablet and physical acceptance remain future execution checks.
- Owner execution update: commits on dev authorized; Luna implementation/fixes, final Sol code/browser review, then Astra inspection of Sol's screenshots. This supersedes earlier local/uncommitted-only and per-task review defaults.
