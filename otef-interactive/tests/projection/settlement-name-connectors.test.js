import { expect, test } from 'vitest';
import { settlementConnector } from '../../frontend/src/projection/settlement-name-connectors.js';

test('keeps the text gap for two lines with different glyph heights', () => {
  const label = { x: 500, y: 340, rotateDeg: 0 };
  const rings = [[[480,100],[520,100],[520,200],[480,200]]];
  const inkBox = { left: 480, right: 520, top: 325, bottom: 365 };
  const connector = settlementConnector(label, rings, inkBox);
  expect(connector.start).toEqual({ x: 500, y: 200 });
  expect(connector.end).toEqual({ x: 500, y: 323 });
});

test('uses the manually chosen outline point while keeping the label end automatic', () => {
  const rings = [[[100,300],[200,300],[200,380],[100,380]]];
  const label = { x: 500, y: 340, rotateDeg: 0 };
  const box = { left: 480, right: 520, top: 325, bottom: 355 };
  const automatic = settlementConnector(label, rings, box);
  const manual = settlementConnector(label, rings, box, { x: 100, y: 300 });
  expect(automatic.start).toEqual({ x: 200, y: 340 });
  expect(manual.start).toEqual({ x: 100, y: 300 });
  expect(manual.end.x).toBe(478);
});
