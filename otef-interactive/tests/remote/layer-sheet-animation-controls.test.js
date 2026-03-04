const { renderLayerRow } = require('../../frontend/src/remote/layer-sheet-controller');

function makeAnimatableLayerRow() {
  return {
    baseName: 'חדירה_לישוב-ציר',
    displayLabel: 'חדירה לישוב ציר',
    fullLayerIds: ['october_7th.חדירה_לישוב-ציר'],
    layers: [
      {
        id: 'חדירה_לישוב-ציר',
        name: 'חדירה לישוב ציר',
        enabled: true,
        style: { animation: { type: 'flow' } },
      },
    ],
    enabled: true,
  };
}

function makeNonAnimatableLayerRow() {
  return {
    baseName: 'מרחב_לחימה',
    displayLabel: 'מרחב לחימה',
    fullLayerIds: ['october_7th.מרחב_לחימה'],
    layers: [
      {
        id: 'מרחב_לחימה',
        name: 'מרחב לחימה',
        enabled: true,
      },
    ],
    enabled: true,
  };
}

describe('layer sheet animation controls', () => {
  test('layer row renders animation toggle only for animatable layers', () => {
    const html = renderLayerRow(makeAnimatableLayerRow(), {
      groupId: 'october_7th',
      animations: {},
    });
    expect(html).toContain('data-animation-toggle');

    const html2 = renderLayerRow(makeNonAnimatableLayerRow(), {
      groupId: 'october_7th',
      animations: {},
    });
    expect(html2).not.toContain('data-animation-toggle');
  });

  test('layer row animation chip is active when any row animation is enabled', () => {
    const row = {
      baseName: 'חדירה_לישוב-ציר',
      displayLabel: 'חדירה לישוב ציר',
      fullLayerIds: [
        'october_7th.חדירה_לישוב-ציר',
        'october_7th.חדירה_לישוב-ציר_נוסף',
      ],
      layers: [
        {
          id: 'חדירה_לישוב-ציר',
          name: 'חדירה לישוב ציר',
          enabled: true,
          style: { animation: { type: 'flow' } },
        },
        {
          id: 'חדירה_לישוב-ציר_נוסף',
          name: 'חדירה לישוב ציר נוסף',
          enabled: true,
          style: { animation: { type: 'flow' } },
        },
      ],
      enabled: true,
    };

    const html = renderLayerRow(row, {
      groupId: 'october_7th',
      animations: {
        'october_7th.חדירה_לישוב-ציר': true,
        'october_7th.חדירה_לישוב-ציר_נוסף': false,
      },
    });

    expect(html).toContain('animation-chip active mixed');
  });
});

