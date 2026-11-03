import { createNameFieldGeometry, buildNliNameField } from './nli-name-field-geometry.js';
import { buildNamesWallLayout } from './nli-name-wall-layout.js';
import { evaluateNameWallCoverage } from './nli-name-wall-coverage.js';

export async function computeNameFieldWorkerResult(data) {
  if (data.profile === 'namesWall') {
    const coverage = data.coverage || evaluateNameWallCoverage({ config: data.config,
      meshes: data.meshes, compositorClips: data.compositorClips,
      cameraMappings: data.cameraMappings, logicalPlane: data.logicalPlane });
    const field = await buildNamesWallLayout({ ...data, coverage });
    field.safeGeometry = coverage;
    return field;
  }
  const fieldGeometry = createNameFieldGeometry(data.geometry);
  const widths = new Map(data.widths);
  const field = buildNliNameField(data.collection, fieldGeometry, {
    fontSizes: [...widths.keys()],
    datasetVersion: data.datasetVersion,
    language: data.language || 'he',
    measureText: (name, size) => widths.get(size).get(name),
  });
  return field;
}

if (typeof self !== 'undefined') {
  self.onmessage = async ({ data }) => {
    try {
      self.postMessage({ field: await computeNameFieldWorkerResult(data) });
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
}
