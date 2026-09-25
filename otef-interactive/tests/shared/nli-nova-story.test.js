import { describe, expect, it } from "vitest";
import {
  NLI_NOVA_STORY,
  novaBeatIndexAtPosition,
  novaBeatIndexFromPercent,
  novaBeatPercent,
  novaBeatStartMs,
} from "../../frontend/src/shared/nli-nova-story.js";

const EXPECTED_NOVA_BEATS = [
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

describe("authored Nova story", () => {
  it("contains the five approved localized beat records and polygon membership", () => {
    expect(NLI_NOVA_STORY.startMinutes).toBe(483);
    expect(NLI_NOVA_STORY.beatDurationMs).toBe(4000);
    expect(NLI_NOVA_STORY.manualRevealMs).toBe(320);
    expect(NLI_NOVA_STORY.representativeMinutes).toEqual([492, 506, 540, 630, 720]);
    expect(NLI_NOVA_STORY.beats).toHaveLength(5);

    const ids = NLI_NOVA_STORY.beats.flatMap((beat) => beat.polygonObjectIds);
    expect(ids).toEqual([97, 100, 104, 98, 99, 186, 105, 184, 102, 103, 185, 182, 106, 183]);
    expect(new Set(ids).size).toBe(14);
    expect(ids).not.toContain(107);
    expect(NLI_NOVA_STORY.beats).toEqual(EXPECTED_NOVA_BEATS);
  });

  it("maps beat indices, percentages, and positions to clamped Nova beat boundaries", () => {
    expect(novaBeatStartMs(0)).toBe(0);
    expect(novaBeatStartMs(4)).toBe(16_000);
    expect(novaBeatPercent(0)).toBe(0);
    expect(novaBeatPercent(4)).toBe(100);
    expect(novaBeatIndexFromPercent(0)).toBe(0);
    expect(novaBeatIndexFromPercent(37)).toBe(1);
    expect(novaBeatIndexFromPercent(100)).toBe(4);
    expect(novaBeatIndexFromPercent(-10)).toBe(0);
    expect(novaBeatIndexFromPercent(120)).toBe(4);
    expect(novaBeatIndexAtPosition(0)).toBe(0);
    expect(novaBeatIndexAtPosition(3999)).toBe(0);
    expect(novaBeatIndexAtPosition(4000)).toBe(1);
    expect(novaBeatIndexAtPosition(20_000)).toBe(4);
  });
});
