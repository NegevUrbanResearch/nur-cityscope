import { describe, expect, it } from 'vitest';
import { resolveNliLocation } from '../../frontend/src/shared/nli-name-field-places.js';

describe('NLI source location labels', () => {
  it('reuses the canonical Hebrew settlement name without collapsing distinct source groups', () => {
    expect(resolveNliLocation("Re'im")).toMatchObject({
      groupId: "re'im", label: 'רעים', placeId: 'yeshuv-0713',
    });
    expect(resolveNliLocation('Nova')).toMatchObject({
      groupId: 'nova', label: 'נובה', placeId: 'custom-reim-parking',
      anchorCoordinates: [34.4713, 31.3972],
    });
    expect(resolveNliLocation('Nahal Oz Base')).toEqual({
      groupId: 'nahal oz base', label: 'מוצב נחל עוז', placeId: null,
      anchorCoordinates: null,
    });
    expect(resolveNliLocation('Nahal Oz')).toMatchObject({
      groupId: 'nahal oz', label: 'נחל עוז', placeId: 'yeshuv-0844',
    });
    expect(resolveNliLocation('Mivtahim')).toMatchObject({
      groupId: 'mivtahim', label: 'מבטחים', placeId: 'yeshuv-0829',
    });
    expect(resolveNliLocation('Kissufim Base').groupId).toBe(resolveNliLocation('Kissufim base').groupId);
    expect(resolveNliLocation('Kissufim base')).toMatchObject({
      groupId: 'kissufim base', label: 'מוצב כיסופים', placeId: null,
      anchorCoordinates: null,
    });
    expect(resolveNliLocation('Nahal Oz').anchorCoordinates).toHaveLength(2);
  });

  it('retains an unknown source category', () => {
    expect(resolveNliLocation('Unlisted Site')).toEqual({
      groupId: 'unlisted site', label: 'Unlisted Site', placeId: null,
      anchorCoordinates: null,
    });
  });
});
