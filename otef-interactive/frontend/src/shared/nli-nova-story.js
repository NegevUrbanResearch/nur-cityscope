const authoredBeats = [
  {
    representativeMinute: 492,
    polygonObjectIds: [97, 100, 104],
    eventTime: { he: "08:12–08:23", en: "08:12–08:23" },
    title: { he: "כביש 232 ומתחם הנובה", en: "Highway 232 and the Nova site" },
    presenterText: {
      he: "הלחימה מגיעה לכביש 232 ולמתחם הפסטיבל. סמוך למתחם נחטפים אלמוג מאיר ג׳אן, בר קופרשטיין, אלקנה בוחבוט, אביתר דוד, גיא גלבוע־דלאל, מקסים הרקין ויוסף אוחנה.",
      en: "Fighting reaches Highway 232 and the festival site. Near the site, Almog Meir Jan, Bar Kuperstein, Elkana Bohbot, Evyatar David, Guy Gilboa-Dalal, Maxim Herkin, and Yosef Ohana are abducted.",
    },
  },
  {
    representativeMinute: 506,
    polygonObjectIds: [98, 99, 186],
    eventTime: { he: "08:26–08:40", en: "08:26–08:40" },
    title: { he: "מוקדי הלחימה מתרחבים", en: "The fighting expands" },
    presenterText: {
      he: "הלחימה מתפשטת לנקודת הטנק הדרומית ולאזור המיוער. במהלך הבריחה מהמתחם נחטף שגב כלפון.",
      en: "Fighting spreads to the southern tank position and the wooded area. Segev Kalfon is abducted while escaping from the site.",
    },
  },
  {
    representativeMinute: 540,
    polygonObjectIds: [105, 184, 102, 103],
    eventTime: { he: "09:00–09:15", en: "09:00–09:15" },
    title: { he: "החטיפות ומתחמי החנייה", en: "Abductions and parking areas" },
    presenterText: {
      he: "עומר שם טוב, אורי דנינו, מאיה ואיתי רגב, שלומי זיו ואנדריי קוזלוב נחטפים באזור. בהמשך הלחימה מגיעה לחניית הספקים ולמתחם החנייה המרכזי.",
      en: "Omer Shem Tov, Ori Danino, Maya and Itay Regev, Shlomi Ziv, and Andrey Kozlov are abducted in the area. Fighting later reaches the vendor parking and main parking areas.",
    },
  },
  {
    representativeMinute: 630,
    polygonObjectIds: [185],
    eventTime: { he: "10:30", en: "10:30" },
    title: { he: "נועה ארגמני ואבינתן אור", en: "Noa Argamani and Avinatan Or" },
    presenterText: {
      he: "נועה ארגמני ואבינתן אור נחטפים מצפון־מערב למתחם הנובה. המפה מציגה את נקודת החטיפה ביחס לאתר הפסטיבל.",
      en: "Noa Argamani and Avinatan Or are abducted northwest of the Nova site. The map shows the abduction location in relation to the festival site.",
    },
  },
  {
    representativeMinute: 720,
    polygonObjectIds: [182, 106, 183],
    eventTime: { he: "12:00–13:00", en: "12:00–13:00" },
    title: { he: "החטיפות בשעות הצהריים", en: "Abductions during the afternoon" },
    presenterText: {
      he: "בשעות הצהריים נחטפים באזור רוני קריבוי, איתן מור, רום ברסלבסקי, מורן סטלה ינאי וענבר הימן.",
      en: "During the afternoon, Roni Krivoi, Eitan Mor, Rom Braslavski, Moran Stella Yanai, and Inbar Haiman are abducted in the area.",
    },
  },
];

const beats = Object.freeze(authoredBeats.map((beat) => Object.freeze({
  ...beat,
  polygonObjectIds: Object.freeze([...beat.polygonObjectIds]),
  eventTime: Object.freeze({ ...beat.eventTime }),
  title: Object.freeze({ ...beat.title }),
  presenterText: Object.freeze({ ...beat.presenterText }),
})));

export const NLI_NOVA_STORY = Object.freeze({
  startMinutes: 483,
  beatDurationMs: 4000,
  manualRevealMs: 320,
  beats,
  representativeMinutes: Object.freeze(beats.map((beat) => beat.representativeMinute)),
});

function clampedBeatIndex(index) {
  const number = Number(index);
  const integer = Number.isFinite(number) ? Math.trunc(number) : 0;
  return Math.max(0, Math.min(NLI_NOVA_STORY.beats.length - 1, integer));
}

export function novaBeatStartMs(index) {
  return clampedBeatIndex(index) * NLI_NOVA_STORY.beatDurationMs;
}

export function novaBeatPercent(index) {
  return (clampedBeatIndex(index) / (NLI_NOVA_STORY.beats.length - 1)) * 100;
}

export function novaBeatIndexFromPercent(percent) {
  const number = Number(percent);
  const clamped = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
  return clampedBeatIndex(Math.round((clamped / 100) * (NLI_NOVA_STORY.beats.length - 1)));
}

export function novaBeatIndexAtPosition(positionMs) {
  const number = Number(positionMs);
  const clamped = Number.isFinite(number) ? Math.max(0, number) : 0;
  return clampedBeatIndex(Math.floor(clamped / NLI_NOVA_STORY.beatDurationMs));
}
