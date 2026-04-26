import { renderLayerRow } from "../../frontend/src/remote/layer-sheet-controller.js";

function makeAnimatableLayerRow() {
  return {
    baseName: '?????_?????-???',
    displayLabel: '????? ????? ???',
    fullLayerIds: ['october_7th.?????_?????-???'],
    layers: [
      {
        id: '?????_?????-???',
        name: '????? ????? ???',
        enabled: true,
        style: { animation: { type: 'flow' } },
      },
    ],
    enabled: true,
  };
}

function makeNonAnimatableLayerRow() {
  return {
    baseName: '????_?????',
    displayLabel: '???? ?????',
    fullLayerIds: ['october_7th.????_?????'],
    layers: [
      {
        id: '????_?????',
        name: '???? ?????',
        enabled: true,
      },
    ],
    enabled: true,
  };
}

describe('layer sheet animation controls', () => {
  test('animation button encodes merged row fullLayerIds for visibility bootstrap', () => {
    const row = {
      baseName: 'r',
      displayLabel: 'R',
      fullLayerIds: ['october_7th.x', 'october_7th.y'],
      layers: [
        {
          id: 'x',
          name: 'X',
          enabled: true,
          style: { animation: { type: 'flow' } },
        },
      ],
      enabled: true,
    };
    const html = renderLayerRow(row, { groupId: 'october_7th', animations: {} });
    expect(html).toContain('data-animation-visibility-ids');
    expect(html).toContain('october_7th.x');
    expect(html).toContain('october_7th.y');
  });

  test('layer row renders animation toggle only for animatable layers', () => {
    const html = renderLayerRow(makeAnimatableLayerRow(), {
      groupId: 'october_7th',
      animations: {},
    });
    expect(html).toContain('data-animation-toggle');
    expect(html).toContain('layer-tile--anim');

    const html2 = renderLayerRow(makeNonAnimatableLayerRow(), {
      groupId: 'october_7th',
      animations: {},
    });
    expect(html2).not.toContain('data-animation-toggle');
    expect(html2).not.toContain('layer-tile--anim');
    expect(html2).not.toContain('anim-btn');
  });

  test('layer row animation chip is active when any row animation is enabled', () => {
    const row = {
      baseName: '?????_?????-???',
      displayLabel: '????? ????? ???',
      fullLayerIds: [
        'october_7th.?????_?????-???',
        'october_7th.?????_?????-???_????',
      ],
      layers: [
        {
          id: '?????_?????-???',
          name: '????? ????? ???',
          enabled: true,
          style: { animation: { type: 'flow' } },
        },
        {
          id: '?????_?????-???_????',
          name: '????? ????? ??? ????',
          enabled: true,
          style: { animation: { type: 'flow' } },
        },
      ],
      enabled: true,
    };

    const html = renderLayerRow(row, {
      groupId: 'october_7th',
      animations: {
        'october_7th.?????_?????-???': true,
        'october_7th.?????_?????-???_????': false,
      },
    });

    expect(html).toContain('class="anim-btn active mixed"');
  });

  test('workshop pack row renders swatch when sanitized color metadata exists', () => {
    const row = {
      baseName: 'workshop-layer',
      displayLabel: 'Workshop Layer',
      fullLayerIds: ['curated_moresht_axis.foo'],
      layers: [
        {
          id: 'foo',
          name: 'Workshop Layer',
          enabled: true,
          display_color: '#aabbcc',
        },
      ],
      enabled: true,
    };
    const html = renderLayerRow(row, { groupId: 'curated_moresht_axis', animations: {} });
    expect(html).toContain('layer-tile__swatch');
    expect(html).toContain('background-color:#aabbcc');
  });

  test('workshop pack row renders split-dot swatch for allowlisted submission color', () => {
    const html = renderLayerRow(
      {
        baseName: 'styled',
        displayLabel: 'Styled',
        fullLayerIds: ['curated_moresht_axis.styled'],
        layers: [
          {
            id: 'styled',
            name: 'Styled',
            enabled: true,
            display_color: '#DC2626',
          },
        ],
        enabled: true,
      },
      { groupId: 'curated_moresht_axis', animations: {} },
    );
    expect(html).toContain('layer-tile__swatch');
    expect(html).toContain('curation-submission-swatch-dot');
    expect(html).toContain('--swatch-primary:#DC2626');
  });

  test('workshop pack row omits swatch when no color source exists', () => {
    const row = {
      baseName: 'x',
      displayLabel: 'X',
      fullLayerIds: ['curated_moresht_axis.x'],
      layers: [{ id: 'x', name: 'X', enabled: true }],
      enabled: true,
    };
    const workshopNoColor = renderLayerRow(row, {
      groupId: 'curated_moresht_axis',
      animations: {},
    });
    expect(workshopNoColor).not.toContain('layer-tile__swatch');
  });

  test('non-workshop packs ignore submission color fields on tiles', () => {
    const octoberWithColor = renderLayerRow(
      {
        baseName: 'y',
        displayLabel: 'Y',
        fullLayerIds: ['october_7th.y'],
        layers: [{ id: 'y', name: 'Y', enabled: true, submissionColor: '#ff0000' }],
        enabled: true,
      },
      { groupId: 'october_7th', animations: {} },
    );
    expect(octoberWithColor).not.toContain('layer-tile__swatch');
  });
});

