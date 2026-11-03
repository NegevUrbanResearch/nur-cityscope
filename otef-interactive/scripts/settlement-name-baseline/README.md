# Settlement-name capture validator

Offline check for the projection settlement-name baseline. It does not read exhibit Chrome, recapture meshes, or fill in missing numbers.

```powershell
node otef-interactive/scripts/settlement-name-baseline/validate-capture.mjs --capture <capture.json>
```

`validateCapture(capture)` returns a list of problem paths. An empty list means the capture may authorize later conversion. The CLI also writes `capture-validation.json` beside the capture file. That file holds the capture payload SHA-256, checked artifact paths and hashes, catalogue membership, and the same errors. The capture payload does not contain its own digest.

The script exports `validateCapture`, `sha256Hex`, and `sha256File` only.

A complete capture names both browser routes (`span=left|right` and `outputMode=browser`), keeps every finite Point citycode as a string (leading zeroes included), and treats visibility as separate from membership. Meshes must equal `prepareProjectionSideMesh` for the saved logical mesh and the acknowledged warp. Baseline asset id and SHA-256 must match the calibration warp identity. Without artifact bytes, `validateCapture` still hashes each embedded live-source FeatureCollection and logical mesh and compares those digests to the declared SHA-256 fields. Processed-source and font SHA-256 values are checked against supplied artifact bytes. A well-formed hash with no bytes is an unverifiable error. The CLI keeps requiring the referenced files. Wall evidence follows the shared people-name wall: `placements` is one array that may mix `left` and `right` `output` values, and each placement is `{id, name, output, x, y, width, height}` with the pid in `id`. The canvas adapter filters that array by side. `logicalPlane` carries finite `heading` and positive `planeScale`. `coverageIdentity`, copied from `diagnostics.coverageIdentity`, is `{left, right}` from `coverage.outputIdentities`. A string is the wrong shape. Present diagnostics need `state: "valid"` plus nonnegative integer `expected`, `placed`, `missing`, `extra`, and `duplicate` counts, with `expected` equal to `placed` and the other three counts at zero. Wall `pages` are rejected unless `namesWall.activeMode` is `wall`, matching runtime model mode, which omits them. In wall mode, pages are an object keyed by `left` and `right` with finite geometry on both sides. An array of pages is rejected.

Absent camera, wall, or generation fields are reported. They are not replaced with zero.

## Initialize an existing installation

After applying the Django migrations, initialize settlement-name settings once for the `otef` table before using the settlement-name editor. Migration `0030_otefviewportstate_settlement_names` adds empty settings at revision 0; the editor cannot save against that uninitialized state.

The initializer requires an approved capture and the replay evidence derived from it. Keep the capture and all referenced source, font, and mesh artifacts together. Validate the capture first; the command writes `capture-validation.json` beside it:

```powershell
node otef-interactive/scripts/settlement-name-baseline/validate-capture.mjs --capture <capture.json>
```

Stage the validated capture for browser replay:

```powershell
node otef-interactive/scripts/settlement-name-baseline/build-initialization.mjs --capture <capture.json> --validation <capture-validation.json> --replay-out otef-interactive/.settlement-name-replay
```

From the repository root, start the replay server and open `/settlement-name-replay.html`:

```powershell
npx vite --config otef-interactive/scripts/settlement-name-baseline/replay-vite.config.mjs
```

Confirm the page reports `Parity passed`, then use **Download evidence** to save `converted-baseline.json` and `parity.json`. Generate the initialization command from those files:

```powershell
node otef-interactive/scripts/settlement-name-baseline/build-initialization.mjs --capture <capture.json> --validation <capture-validation.json> --replay-out otef-interactive/.settlement-name-replay --converted <converted-baseline.json> --parity <parity.json> --out <initialize.json>
```

POST the generated `initialize.json` unchanged to the deployed table command endpoint. For OTEF, the path is `/api/otef_viewport/by-table/otef/command/`:

```powershell
$server = "https://<deployed-host>"
curl.exe -X POST "$server/api/otef_viewport/by-table/otef/command/" -H "Content-Type: application/json" --data-binary @initialize.json
```

Proceed when the response has `status: "ok"` and `settlementNameRevision: 1`. The command updates the settlement-name settings and converts the projection calibration to schema V6 in one transaction. Keep the generated capture, evidence, and initialization files with the deployment record; do not substitute hand-edited values because their hashes and parity are checked by the server.
