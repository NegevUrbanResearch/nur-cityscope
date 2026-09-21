# Browser projector verification

Status: ready for owner manual review. Final Astra code review approved `20ff196`. Owner alignment acceptance and TD retirement are pending. Performance testing is deferred until after owner manual review.

## Verified on the exhibit workstation

- Calibration migration preserved existing presets, selection and framing; the read-only TD migration baseline was installed without replacing them.
- The saved TD migration baseline loaded through the actual calibration page at revision 595.
- With TD outputs off, one **Open Both** launched fullscreen browser output on both assigned 1920×1080 Optoma displays: left at `(-1024, -1175)`, right at `(896, -1080)`.
- Both outputs rendered and reported successful application of the loaded baseline. Screen captures showed thin roads and readable text following the alpha correction. This does not establish physical alignment against the model.
- **Close Both** closed the pair; TD's existing control restored both TD outputs.
- Keystone and Grid Warp nodes expose an enlarged image with overlaid handles and arrow controls. Phone/tablet layouts were inspected at 393×852, 852×393, 768×1024 and 1024×768; these are emulated viewport checks, not physical touch acceptance.
- Right grid point 28 moved from `(1071.94, 737.18)` to `(1072.19, 737.43)` with two Fine taps. Undo/redo restored the expected values. With Live off, the database revision remained 595.
- Live edits reached both browser outputs: the selected point moved right 0.25 pixels, row 4 moved down 1 pixel, and the top-left keystone corner moved right 1 pixel. The left output's warp remained unchanged. Browser warp bypass preserved the corrections and visibly changed the actual right output.
- A separate **Browser warp review 2026-09-21** preset saved and reloaded those corrections. Loading the TD migration baseline restored zero residuals. Residual reset and preset Revert produced their distinct expected states.
- On the final build, a native mouse drag moved the outer right-grid handle in the enlarged image, refitted on release, and Undo restored its imported coordinates. The working baseline remained at revision 606 with both residual grids zero and identity keystone corners.
- Final handoff: both browser outputs are open fullscreen on the assigned projectors and report the baseline applied. TD's output windows are off; TD remains running and available for the short return sequence. The GIS window was left unchanged.

## Pending owner acceptance

- Physical touch dragging and owner alignment acceptance remain pending. Focused automated tests cover cancellation and invalid geometry; they do not establish physical usability or alignment.
- Owner compares browser output against TD by eye on the model, including both sides and their overlap. No tripod or camera capture is required.
- After manual review, measure animation/navigation performance and complete the extended run. No performance improvement is claimed yet.

Use the [operation guide](browser-projector-warp-operations.md) for the short TD/browser handoff. Keep TD available throughout acceptance.

## Automated verification

The integration frontend suite at `b5c6dca` passed 2,171 tests and failed two: a stale schema fixture in the name-field controller test and the previously observed remote people-search assertion at `tests/remote/remote-people-search.test.js:176`. The remote-search test and implementation were unchanged by this projection work. The schema fixture was corrected in `0a24787`, with its 43-test suite passing. Final editor corrections in `20ff196` passed 25 focused tests, production build and diff check; Astra approved the rereview. The full suite was not repeated after these focused corrections, and is not claimed green.

Earlier focused Django runs passed the 30 schema/API/baseline/migration tests, 14 warp/baseline tests and five WebSocket tests. Migration preservation was also checked against the live pre-migration backup. No backend code changed during the final editor corrections.
