import { readNliLabelHeading } from './nli-label-heading.js';
import { runNameFieldWorker } from './nli-name-field-worker-client.js';

const fields = new Map();
export function loadNliNameField() {
  const heading = readNliLabelHeading(globalThis.localStorage);
  if (fields.has(heading)) return fields.get(heading);
  const promise = (async () => {
    const json = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Name field HTTP ${response.status}: ${url}`);
      return response.json();
    };
    const [model, data, metadata] = await Promise.all([
      json('/otef-interactive/data/model-bounds.json'),
      json('/otef-interactive/public/processed/layers/nli/people_names.geojson'),
      json('/otef-interactive/public/processed/layers/nli/release-metadata.json'),
    ]);
    if (typeof globalThis.proj4 !== 'function') throw new Error('Name field requires coordinate conversion');
    const convert = (x, y) => globalThis.proj4('EPSG:2039', 'EPSG:4326', [x, y]);
    const bounds = [convert(model.west, model.south), convert(model.east, model.north)];
    const footprint = (model.bounds_polygon || model.polygon)?.map((p) => convert(p.x, p.y));
    await document.fonts?.load("12px 'Guttman Hatzvi'");
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const texts = data.features.map((feature) =>
      String(feature.properties?.hebrew_name || feature.properties?.name || '').trim());
    const widths = [12, 10, 8].map((size) => {
      ctx.font = `${size}px 'Guttman Hatzvi', sans-serif`;
      return [size, new Map(texts.map((name) => [name, ctx.measureText(name).width]))];
    });
    return runNameFieldWorker({
      collection: data,
      geometry: { bounds, footprint, heading },
      widths,
      datasetVersion: metadata.datasetVersion || metadata.release?.datasetVersion || metadata.version || '',
    });
  })().catch((error) => {
    fields.delete(heading);
    throw error;
  });
  fields.set(heading, promise);
  return promise;
}
