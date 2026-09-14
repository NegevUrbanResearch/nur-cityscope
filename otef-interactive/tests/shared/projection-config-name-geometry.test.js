import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from '../../frontend/src/shared/projection-config-schema.js';
import {
  buildNliNameField,
  chooseProjectionNameOwner,
  computeProjectionNameOwnership,
  createNameFieldGeometry,
} from '../../frontend/src/shared/nli-name-field-geometry.js';

const rectangle = (pid, x, y = 0.5, width = 0.04, height = 0.02) => ({
  pid,
  x: x * 1920,
  y: y * 1080,
  width: width * 1920,
  height: height * 1080,
});

describe('projection name ownership', () => {
  it('assigns a fitting label to one deterministic eye and counts clipped labels', () => {
    const result = computeProjectionNameOwnership({
      config: DEFAULTS,
      labelRectangles: [
        rectangle('left-only', 0.18),
        rectangle('overlap', 0.49),
        rectangle('right-only', 0.78),
        rectangle('clipped', 0.01),
      ],
    });

    expect(result.owners).toEqual({
      'left-only': 'left',
      overlap: 'left',
      'right-only': 'right',
    });
    expect(result.clippedCount).toBe(1);
  });

  it('uses post translation to expose a prepared label in the other eye', () => {
    const config = structuredClone(DEFAULTS);
    const before = computeProjectionNameOwnership({
      config,
      labelRectangles: [rectangle('coast', 0.56)],
    });
    config.outputs.left.post.tx = -0.4;
    config.outputs.right.crop.x0 = 0.8;
    const after = computeProjectionNameOwnership({
      config,
      labelRectangles: [rectangle('coast', 0.56)],
    });

    expect(before.owners.coast).toBe('right');
    expect(after.owners.coast).toBe('left');
  });

  it('ties ownership to the left eye', () => {
    expect(chooseProjectionNameOwner(0.1, 0.1)).toBe('left');
    expect(chooseProjectionNameOwner(-0.1, -0.1)).toBeNull();
  });

  it('uses one canonical halo for both output instances', () => {
    const labelRectangles = [{ pid: 'edge', x: 0.05025, y: 0.5, width: 0.0001, height: 0.01 }];
    const first = computeProjectionNameOwnership({ config: DEFAULTS, labelRectangles });
    const second = computeProjectionNameOwnership({ config: DEFAULTS, labelRectangles });
    expect(second).toEqual(first);
    expect(first.clippedCount).toBe(1);
  });

  it('maps centered prepared placements through pre-only calibration edits', () => {
    const geometry = createNameFieldGeometry({
      bounds: [[34, 31], [34.2, 31.2]],
      heading: 41,
    });
    const field = buildNliNameField({
      features: [{
        type: 'Feature',
        properties: { pid: 'prepared', status: 'Murdered', name: 'abc', source_lon: 34.1, source_lat: 31.1 },
        geometry: { type: 'Point', coordinates: [34.1, 31.1] },
      }],
    }, geometry, { measureText: () => 20, fontSizes: [10] });
    const prepared = structuredClone(field.geojson);
    const variants = [
      { ...DEFAULTS, pre: { ...DEFAULTS.pre, tx: 0.2 } },
      { ...DEFAULTS, pre: { ...DEFAULTS.pre, rotateDeg: 0 } },
      { ...DEFAULTS, pre: { ...DEFAULTS.pre, scale: 4 } },
    ];
    expect(computeProjectionNameOwnership({ field, config: DEFAULTS })).toEqual({
      owners: { prepared: 'right' },
      clippedCount: 0,
    });
    expect(variants.map((config) => computeProjectionNameOwnership({ field, config }))).toEqual([
      { owners: {}, clippedCount: 1 },
      { owners: {}, clippedCount: 1 },
      { owners: {}, clippedCount: 1 },
    ]);
    expect(field.geojson).toEqual(prepared);
  });
});
