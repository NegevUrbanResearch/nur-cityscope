import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildSettlementNameCatalog } from '../../frontend/src/shared/settlement-name-catalog.js';
import { captureSettlementReferencePosition } from '../../frontend/src/projection/settlement-name-framing.js';

/** Adds missing names to the captured coordinate frame while retaining every existing placement. */
export function buildAddedSettlementPositions(catalog, settings) {
  const positions = { left: {}, right: {} };
  for (const entry of catalog.entries) {
    if (settings.baseline.outputs.left[entry.citycode] || settings.baseline.outputs.right[entry.citycode]) continue;
    for (const output of ['left', 'right']) {
      const position = captureSettlementReferencePosition({ catalog, baseline: settings.baseline, output, lng: entry.lng, lat: entry.lat });
      // Start outside the outline; the editor can adjust each output independently.
      positions[output][entry.citycode] = { x: position.x + 50, y: position.y - 30 };
    }
  }
  return positions;
}

async function main() {
  const baseUrl = process.env.OTEF_LOCAL_URL || 'http://localhost';
  const endpoint = `${baseUrl}/api/otef_viewport/by-table/otef/`;
  const stateResponse = await fetch(endpoint);
  if (!stateResponse.ok) throw new Error(`State request failed: ${stateResponse.status}`);
  const state = await stateResponse.json();
  const collection = JSON.parse(await readFile(new URL('../../public/processed/layers/projector_base/שמות_יישובים.geojson', import.meta.url), 'utf8'));
  const catalog = buildSettlementNameCatalog(collection);
  const positions = buildAddedSettlementPositions(catalog, state.settlement_name_settings);
  if (!Object.keys(positions.left).length) { console.log('No missing settlement positions'); return; }
  const catalogJson = JSON.stringify(catalog.entries);
  const payload = { action: 'set_settlement_names', operation: 'append_baseline', positions, catalogJson,
    catalogDigest: createHash('sha256').update(catalogJson).digest('hex'), baseRevision: state.settlement_name_revision,
    sourceId: randomUUID(), timestamp: new Date().toISOString() };
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify(payload, null, 2)); return; }
  const response = await fetch(`${endpoint}command/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(`Added ${Object.keys(positions.left).join(', ')} at settlement revision ${result.settlementNameRevision}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
