import placeCatalog from './place-navigation/place-catalog.generated.js';

// These are NLI source categories, not settlement names. Keep their raw keys
// distinct even when several categories refer to the same nearby settlement.
const SOURCE_LABELS = {
  Nova: 'נובה',
  'Nahal Oz Base': 'מוצב נחל עוז',
  Mivtahim: 'מבטחים',
  'Gaza Envelope': 'עוטף עזה',
  'Zikim Beach': 'חוף זיקים',
  Psyduck: 'פסיידאק',
  'The pensioners bus in Sderot': 'אוטובוס הגמלאים בשדרות',
  'Paga Post': 'מוצב פגה',
  'Zikim Base': 'בסיס זיקים',
  'Sufa Base': 'מוצב סופה',
  'Yiftach Outpost': 'מוצב יפתח',
  'Sderot Police Station': 'תחנת משטרת שדרות',
  'Urim Base': 'בסיס אורים',
  'Kissufim Base': 'מוצב כיסופים',
  'Erez Checkpoint': 'מעבר ארז',
  'Re\'im Base': 'בסיס רעים',
  'COGAT Base': 'בסיס מתפ״ש',
  'Northern Border': 'הגבול הצפוני',
  'Egypt Terror attack': 'פיגוע בגבול מצרים',
  'Gama Junction': 'צומת גמא',
  'Erez Outpost - Zikim': 'מוצב ארז – זיקים',
  'West Bank': 'הגדה המערבית',
  'Near Sderot': 'ליד שדרות',
  'Bait Halavan': 'בית הלבן',
  'Alba’at': 'אלבאט',
  'Arab al-Aramshe': 'ערב אל-עראמשה',
  "Netu'a": 'נטועה',
  Adamit: 'אדמית',
  Arara: 'ערערה',
  Ashkelon: 'אשקלון',
  Netivot: 'נתיבות',
  Ofakim: 'אופקים',
  'Kfar Aviv': 'כפר אביב',
  'Talmei Eliyahu': 'תלמי אליהו',
};

const catalogByEnglishName = new Map();
const catalogById = new Map(placeCatalog.entries.map(place => [place.id, place]));
for (const place of placeCatalog.entries) {
  if (!place.selectable || place.type !== 'yeshuv') continue;
  for (const name of [place.name?.en, ...(place.aliases?.en || [])]) {
    if (name) catalogByEnglishName.set(name.toLocaleLowerCase('en'), place);
  }
}
catalogByEnglishName.set('mivtahim', placeCatalog.entries.find(place => place.id === 'yeshuv-0829'));
const sourceLabelsByKey = new Map(Object.entries(SOURCE_LABELS).map(([key, value]) => [key.toLocaleLowerCase('en'), value]));

export function resolveNliLocation(rawLocation) {
  const location = String(rawLocation || '').trim();
  const groupId = location.toLocaleLowerCase('en');
  const place = catalogByEnglishName.get(groupId);
  const placeId = groupId === 'nova' ? 'custom-reim-parking' : place?.id || null;
  const center = catalogById.get(placeId)?.cameraHint?.center;
  return {
    groupId,
    label: sourceLabelsByKey.get(groupId) || place?.name?.he || location || 'מיקום לא ידוע',
    placeId,
    anchorCoordinates: Number.isFinite(center?.lng) && Number.isFinite(center?.lat)
      ? [center.lng, center.lat] : null,
  };
}
