import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const required = [
  '../.superpowers/sdd/memorial-wall-revision-699-snapshot.json',
  '../.superpowers/sdd/memorial-wall-browser-guttman-metrics-center-middle-rtl.json',
  '../.superpowers/sdd/memorial-wall-browser-guttman-metrics-4-8-center-middle-rtl.json',
  'public/processed/layers/nli/people_names.geojson',
  'public/processed/layers/nli/release-metadata.json',
  'public/processed/layers/projector_base/Tkuma_Area_LIne.geojson',
  'public/projection-calibration/td-baselines/left.json',
  'public/projection-calibration/td-baselines/right.json',
  'frontend/data/model-bounds.json',
];

/** The accepted-data gate must fail rather than silently skip on an unprepared exhibit. */
export function requireNameWallExhibitInputs(root = projectRoot, exists = existsSync) {
  const missing = required.filter((path) => !exists(resolve(root, path)));
  if (missing.length) throw new Error(`Name wall exhibit gate missing required inputs: ${missing.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireNameWallExhibitInputs();
    const result = spawnSync(process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/shared/nli-name-wall-current-data.test.js'],
      { cwd: projectRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
