# Settlement-name capture validator

Offline check for the projection settlement-name baseline. It does not read exhibit Chrome, recapture meshes, or fill in missing numbers.

```powershell
node otef-interactive/scripts/settlement-name-baseline/validate-capture.mjs --capture .superpowers/sdd/settlement-name-config/baseline/capture.json
```

`validateCapture(capture)` returns a list of problem paths. An empty list means the capture may authorize later conversion. The CLI also writes `capture-validation.json` beside the capture file. That file holds the capture payload SHA-256, checked artifact paths and hashes, catalogue membership, and the same errors. The capture payload does not contain its own digest.

The script exports `validateCapture`, `sha256Hex`, and `sha256File` only.

A complete capture names both browser routes (`span=left|right` and `outputMode=browser`), keeps every finite Point citycode as a string (leading zeroes included), and treats visibility as separate from membership. Meshes must equal `prepareProjectionSideMesh` for the saved logical mesh and the acknowledged warp. Baseline asset id and SHA-256 must match the calibration warp identity. Without artifact bytes, `validateCapture` still hashes each embedded live-source FeatureCollection and logical mesh and compares those digests to the declared SHA-256 fields. Processed-source and font SHA-256 values are checked against supplied artifact bytes. A well-formed hash with no bytes is an unverifiable error. The CLI keeps requiring the referenced files. Wall evidence follows the shared people-name wall: `placements` is one array that may mix `left` and `right` `output` values, and each placement is `{id, name, output, x, y, width, height}` with the pid in `id`. The canvas adapter filters that array by side. `logicalPlane` carries finite `heading` and positive `planeScale`. `coverageIdentity`, copied from `diagnostics.coverageIdentity`, is `{left, right}` from `coverage.outputIdentities`. A string is the wrong shape. Present diagnostics need `state: "valid"` plus nonnegative integer `expected`, `placed`, `missing`, `extra`, and `duplicate` counts, with `expected` equal to `placed` and the other three counts at zero. Wall `pages` are rejected unless `namesWall.activeMode` is `wall`, matching runtime model mode, which omits them. In wall mode, pages are an object keyed by `left` and `right` with finite geometry on both sides. An array of pages is rejected.

Absent camera, wall, or generation fields are reported. They are not replaced with zero.
