import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'public/processed/layers/nli/people_names.geojson',
  'public/processed/layers/nli/release-metadata.json',
  'public/processed/layers/projector_base/Tkuma_Area_LIne.geojson',
  'frontend/data/model-bounds.json',
];

/** The accepted-data gate must fail rather than silently skip on an unprepared exhibit. */
export function requireNameWallExhibitInputs(root = projectRoot, exists = existsSync, artifactDirectory = process.env.OTEF_NAME_WALL_ACCEPTANCE_ARTIFACT_DIR) {
  if (typeof artifactDirectory !== 'string' || !artifactDirectory.trim()) throw new Error('Set OTEF_NAME_WALL_ACCEPTANCE_ARTIFACT_DIR to the current bilingual browser capture directory');
  const directory = resolve(root, artifactDirectory);
  if (/(^|[\\/])(?:\.superpowers|docs[\\/]superpowers)(?:[\\/]|$)/i.test(directory)) throw new Error('Name wall acceptance requires an allowed artifact directory');
  const evidence = ['wall-snapshot.json', 'left-mesh.json', 'right-mesh.json', 'baseline-manifest.json', 'name-metrics-he-rtl.json', 'name-metrics-en-ltr.json'];
  const missing = [...required.map(path => resolve(root, path)), ...evidence.map(path => resolve(directory, path))].filter(path => !exists(path));
  if (missing.length) throw new Error(`Name wall exhibit gate missing required inputs: ${missing.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireNameWallExhibitInputs();
    const result = spawnSync(process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/shared/nli-name-wall-current-data.test.js', '--maxWorkers=1'],
      { cwd: projectRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
