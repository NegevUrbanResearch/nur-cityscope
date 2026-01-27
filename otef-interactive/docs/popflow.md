# Popup Flow (OTEF Interactive)

This document captures how popups are generated and how to keep them stable across `process_layers.py` runs. It is written for future AI or developers who need to reproduce the behavior without reintroducing regressions.

## Summary

Popups only render when a layer manifest entry includes `ui.popup`. The `process_layers.py` script regenerates `manifest.json` files, so popup configuration must be persisted outside those generated manifests and merged in during processing.

## Data Sources and Responsibilities

- **Source GeoJSON** lives in `otef-interactive/public/source/layers/<pack>/gis/`.
- **Processed outputs** live in `otef-interactive/public/processed/layers/<pack>/`.
- **Popup configuration** lives in a static mapping file at `otef-interactive/public/source/popup-config.json`.
- **Frontend popup rendering** is handled by `otef-interactive/frontend/js/map-utils/popup-renderer.js` and is only invoked when `layerConfig.ui.popup` exists.

## Required Files

### 1) Popup mapping file

`otef-interactive/public/source/popup-config.json`

Structure:
```
{
  "<pack_id>": {
    "layers": {
      "<layer_id>": {
        "titleField": "FIELD_NAME",
        "fields": [
          { "label": "Label 1", "key": "FIELD_1" }
        ],
        "hideEmpty": true
      }
    }
  }
}
```

Notes:
- `titleField` is optional. If you do not want a title line, omit it.
- `fields` is required to show rows.
- `hideEmpty` is recommended to prevent blank rows.

### 2) Processed manifests

`process_layers.py` writes `manifest.json` and `styles.json` under `public/processed/layers/<pack>/`.

Each layer entry must include:
```
"ui": {
  "popup": {
    "titleField": "...",
    "fields": [...],
    "hideEmpty": true
  }
}
```

## How Popup Config Gets Into the Manifest

`process_layers.py` must merge the static popup mapping into each layer entry **every run**. If this merge is missing, popups will disappear for both GeoJSON and PMTiles because the frontend only binds popup handlers when `ui.popup` exists.

Recommended merge behavior:
- Load `popup-config.json` once.
- For each layer entry, lookup `popup_config[pack_id].layers[layer_id]`.
- If found, inject `layer_entry["ui"] = {"popup": layer_popup_cfg}`.
- If not found, preserve any existing `ui.popup` already in a previously generated manifest (so popups are not lost when a mapping is missing).

## Frontend Behavior (Why `ui.popup` Is Required)

Popups are gated by `layerConfig.ui.popup`:
- GeoJSON click handling only attaches when `ui.popup` is present.
- PMTiles click handling only registers layers that contain `ui.popup`.

If `ui.popup` is missing in the manifest, popups will not fire at all, regardless of `popup-renderer.js`.

## Running the Layer Processor (Host, Not Docker Exec)

Run on the host machine, with the project venv:
```
cd otef-interactive/scripts
.venv\Scripts\Activate.ps1
python process_layers.py --source ../public/source/layers --output ../public/processed/layers
```

Do not run `process_layers.py` via `docker exec`. It expects local paths and uses Docker only for tippecanoe.

## Common Failure Modes and How to Avoid Them

1) **Popups disappear after processing**
   - Cause: `process_layers.py` overwrote manifests without re-injecting `ui.popup`.
   - Fix: ensure popup-config merge is applied every run.

2) **Popup config file ignored by git**
   - `popup-config.json` must be tracked. If it is ignored, future regenerations will lose `ui.popup`.
   - Make sure `.gitignore` explicitly allows `otef-interactive/public/source/popup-config.json`.

3) **Running from the wrong working directory**
   - If scripts use relative paths, running from a subdirectory can break file resolution.
   - Prefer running scripts from repo root or use absolute paths in scripts.

4) **Windows subprocess decode errors**
   - Tippecanoe output can include non-ASCII bytes.
   - If you see `UnicodeDecodeError`, it is usually safe to ignore if output files are created.
   - To avoid noise, capture subprocess output as bytes and decode safely, or set `PYTHONIOENCODING=utf-8` before running.

## Validation Checklist

- `public/processed/layers/layers-manifest.json` lists the pack.
- `public/processed/layers/<pack>/manifest.json` includes `ui.popup` for mapped layers.
- In the UI: clicking a GeoJSON layer shows the fields defined in `popup-config.json`.
- In the UI: PMTiles layers show the same popup fields.

