import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";

export const COPY = {
  he: {
    home: "דף הבית",
    prev: "הקודם",
    next: "הבא",
    done: "סיום",
    backToShow: "סיום הסיפור, המשך הרצף",
    startStory: "התחלת הסיפור: {{title}}",
    of: "מתוך",
    gisLabel: "מסך GIS",
    modelLabel: "הקרנה / מודל",
    kitIdle: "אין שליטה בשלב זה — המשך בנרטיב.",
    cueApplying: "מעדכן את המפה…",
    cueReady: "המפה מוכנה לשלב זה",
    cueFailed: "לא ניתן לעדכן את המפה",
    stepAria: "מעבר לשלב {{n}}",
    showTitle: "מהלך ההקרנה",
    showMeta: "הרצף המלא, שלב אחר שלב",
    namesHomeTitle: "מאגר הזהויות וקיר השמות",
    namesHomeMeta: "קפיצה ישירה לשלבי החיפוש",
    freeTitle: "שליטה חופשית",
    searchLabel: "חיפוש שם או מקום",
    searchPlaceholder: "חיפוש שם או מקום",
    searchClearing: "מנקה את החיפוש…",
    searchClearFailed: "לא ניתן לנקות את החיפוש במפה. הבחירה הנוכחית נשמרה.",
    draft: "התוכן לשלב זה עדיין נכתב.",
    steps: "שלבים",
    freeMeta: "סצנות מוכנות ושכבות",
    disconnected: "אין חיבור למפה",
    connected: "מחובר",
    connecting: "מתחבר…",
    packLibrary: "תוכן הספרייה",
    packBase: "שכבות בסיס",
    packEmpty: "אין שכבות בחבילה זו",
    layersTitle: "שכבות",
    layersMeta: "בחירה ידנית של שכבות",
    layersSheetTitle: "שליטה בשכבות",
    layersSheetLede: "בחירה ידנית של שכבות",
    layersClose: "סגירה",
    placeTypeSettlement: "יישוב",
    archiveMissing: "לא נמצאה רשומת ארכיון לשם זה.",
  },
  en: {
    home: "Home",
    prev: "Previous",
    next: "Next",
    done: "Finish",
    backToShow: "Finish story, continue sequence",
    startStory: "Start the story: {{title}}",
    of: "of",
    gisLabel: "GIS screen",
    modelLabel: "Projection / model",
    kitIdle: "No controls in this step — continue the narrative.",
    cueApplying: "Updating the map…",
    cueReady: "Map is set for this step",
    cueFailed: "Could not update the map",
    stepAria: "Go to step {{n}}",
    showTitle: "Run of show",
    showMeta: "The full sequence, step by step",
    namesHomeTitle: "Identity database and names wall",
    namesHomeMeta: "Jump straight to either search step",
    freeTitle: "Free control",
    searchLabel: "Search a name or place",
    searchPlaceholder: "Search a name or place",
    searchClearing: "Clearing search…",
    searchClearFailed: "Could not clear the map search. The current selection was kept.",
    draft: "This step is still being written.",
    steps: "steps",
    freeMeta: "Preset scenes and layers",
    disconnected: "Map is disconnected",
    connected: "Connected",
    connecting: "Connecting…",
    packLibrary: "Library Content",
    packBase: "Base Layers",
    packEmpty: "No layers in this pack",
    layersTitle: "Layers",
    layersMeta: "Manually select layers",
    layersSheetTitle: "Layer Control",
    layersSheetLede: "Manually select layers",
    layersClose: "Close",
    placeTypeSettlement: "Settlement",
    archiveMissing: "No archive record found for this name.",
  },
};

const SETTLEMENT_LAYER_IDS = [
  "projector_base.שמות_יישובים",
  "projector_base.Locations_Lines",
  "projector_base.ישובים",
];
const BLACK_GROUND = "projector_base.רקע_שחור";
const ROUTE_232 = "nli.ציר_232";
const SEA = "projector_base.SEA";
const GAZA_ROADS = "gaza.Gaza_Roads";
const PEOPLE = "nli.people";
const OPEN_SPACES = "land_use.שטחים_פתוחים";

export const PEOPLE_NAMES_LAYER_IDS = ["nli.people_names"];
export const FOCUS_LAYER_IDS = [...SETTLEMENT_LAYER_IDS, ROUTE_232, BLACK_GROUND];
export const OPENING_LAYER_IDS = [...FOCUS_LAYER_IDS, SEA, GAZA_ROADS];
export const TIMELINE_LAYER_IDS = [...OPENING_LAYER_IDS, ...NLI_PLAYABLE_IDS];
export const IDENTITY_LAYER_IDS = [...FOCUS_LAYER_IDS, PEOPLE];
export const WALL_LAYER_IDS = PEOPLE_NAMES_LAYER_IDS;

const NOVA_TIMELINE_LAYER_IDS = [...FOCUS_LAYER_IDS, ...NLI_PLAYABLE_IDS];

/**
 * A cue is the map state a step applies on entry. Every key is optional:
 * `narrative` overrides the script narrative (`null` exits to the overview),
 * `layers` is the exact set of enabled layers, `clock` is `"idle"` or a play
 * window `{ from, to }` in minutes of the day, and `escape` sets the Nova
 * escape overlay (unlisted routes turn off).
 */
const OPENING_CUE = { layers: OPENING_LAYER_IDS, clock: "idle" };
const IDENTITY_CUE = { layers: IDENTITY_LAYER_IDS, clock: "idle" };
const WALL_CUE = { layers: WALL_LAYER_IDS, clock: "idle" };

const same = { he: "אותו דבר", en: "Same" };
const unknown = { he: "?", en: "?" };

const OPENING_COPY = {
  he: "שמות ישובים וקווי מתאר של ישובים, כביש 232, SEA, דרכי עזה.",
  en: "Settlement names and outlines, Route 232, SEA, and Gaza roads.",
};
const TIMELINE_MODEL = {
  he: "ישובים ושמותיהם מחשיכים; פוליגונים, צירי חדירה ואזעקות מופיעים ככל שהזמן מתקדם; ישובים מתגלים והופכים אדומים בהתנגשות עם צירי חדירה או פוליגונים פעילים. השעון מופיע מתחת לעזה.",
  en: "Settlements and names dim. Polygons, infiltration routes, and alarms appear as time advances; settlements turn red when active routes or polygons intersect them. The clock appears below Gaza.",
};
const TIMELINE_GIS = {
  he: `${TIMELINE_MODEL.he} אפשר לראות את אשקלון, נתיבות ואופקים.`,
  en: `${TIMELINE_MODEL.en} Ashkelon, Netivot, and Ofakim are visible.`,
};
const PER_NARRATIVE = { he: "לפי טבלת הנרטיב", en: "Per the narrative table" };

export const SHOW_STEP_IDS = Object.freeze({
  IDENTITY: "identity-database",
  WALL: "names-wall",
});

export const SHOW = {
  id: "show",
  narrative: null,
  title: { he: COPY.he.showTitle, en: COPY.en.showTitle },
  meta: { he: COPY.he.showMeta, en: COPY.en.showMeta },
  steps: [
    {
      id: "opening",
      title: { he: "התחלה", en: "Opening" },
      gis: OPENING_COPY,
      model: OPENING_COPY,
      cue: OPENING_CUE,
      kit: [],
    },
    {
      id: "opening-minutes",
      clock: "06:29",
      title: { he: "הדקות הראשונות", en: "The opening minutes" },
      note: {
        he: "ציר זמן 6:29–6:41, עד שעת ההתחלה של האירועים של משפחת שגב.",
        en: "Timeline 06:29–06:41, up to the start of the Segev family events.",
      },
      gis: TIMELINE_GIS,
      model: TIMELINE_MODEL,
      cue: { layers: TIMELINE_LAYER_IDS, clock: { to: 401 } },
      kit: ["timeline"],
    },
    {
      id: "segev-family",
      title: { he: "משפחת שגב", en: "Segev family" },
      gis: PER_NARRATIVE,
      model: PER_NARRATIVE,
      branch: ["segev"],
      kit: [],
    },
    {
      id: "rest-of-day",
      clock: "06:42",
      title: { he: "שאר היום", en: "The rest of the day" },
      note: {
        he: "זום־אאוט משגב בחזרה לכל הנגב; ציר הזמן ממשיך מ־6:42 ועד סוף היום.",
        en: "Zoom out from the Segev family to the whole Negev; the timeline runs from 06:42 to the end of the day.",
      },
      gis: TIMELINE_GIS,
      model: TIMELINE_MODEL,
      cue: { layers: TIMELINE_LAYER_IDS, clock: { from: 402 } },
      kit: ["timeline"],
    },
    {
      id: "nova-mor-levy",
      title: { he: "נובה ומור לוי", en: "Nova and Mor Levy" },
      gis: PER_NARRATIVE,
      model: PER_NARRATIVE,
      branch: ["nova"],
      kit: [],
    },
    {
      id: "narratives",
      title: { he: "נרטיבים", en: "Narratives" },
      note: {
        he: "בחירה חופשית: שדרות, מחנה שורה, חטופים (חיים פרי מניר עוז).",
        en: "Free choice: Sderot, Shura Camp, Hostages (Haim Peri of Nir Oz).",
      },
      gis: PER_NARRATIVE,
      model: PER_NARRATIVE,
      branch: ["sderot", "shura", "hostages"],
      kit: [],
    },
    {
      id: SHOW_STEP_IDS.IDENTITY,
      title: { he: "מאגר הזהויות", en: "Identity database" },
      note: {
        he: "חפשו שם — המפה מתמקדת בנקודה. מהשלט אפשר לפתוח את הרשומה בארכיון.",
        en: "Search a name — the map zooms to the point. The remote can open the archive record.",
      },
      gis: {
        he: "שמות ישובים וקווי מתאר, כביש 232 ו״אנשים״ כנקודות, ללא דרכי עזה. לאחר חיפוש: זום־אין על הנקודה וחלונית עם השם מעליה.",
        en: "Settlement names and outlines, Route 232, and people as points, without Gaza roads. After a search: zoom to the point with a name pop-up above it.",
      },
      model: {
        he: "אותן שכבות. לאחר חיפוש: ריבוע של אור על הנקודה, ושאר הנקודות מחשיכות.",
        en: "The same layers. After a search: a square of light on the point, other points dimmed.",
      },
      cue: IDENTITY_CUE,
      kit: ["search"],
    },
    {
      id: SHOW_STEP_IDS.WALL,
      title: { he: "קיר השמות", en: "Wall of names" },
      note: {
        he: "חפשו שם או מקום — השמות המשויכים מוארים, השאר מחשיכים, והמקום הנבחר מואר.",
        en: "Search a name or place — associated names light up, the rest dim, and the chosen place lights up.",
      },
      gis: {
        he: "כל השמות מופיעים על המודל כקיר; כל שאר השכבות מוחשכות.",
        en: "All names appear on the model as a wall; all other layers are dimmed.",
      },
      model: same,
      cue: WALL_CUE,
      kit: ["search"],
    },
    {
      id: "back-to-start",
      title: { he: "בחזרה להתחלה", en: "Back to the start" },
      gis: OPENING_COPY,
      model: OPENING_COPY,
      cue: OPENING_CUE,
      kit: [],
    },
  ],
};

export const HOME_SHOW_SHORTCUTS = Object.freeze([
  {
    id: SHOW_STEP_IDS.IDENTITY,
    title: { he: "מאגר הזהויות", en: "Identity database" },
    meta: { he: "אנשים כנקודות וחיפוש", en: "People as points and search" },
  },
  {
    id: SHOW_STEP_IDS.WALL,
    title: { he: "קיר השמות", en: "Names wall" },
    meta: { he: "כל השמות וחיפוש", en: "All names and search" },
  },
]);

function slides(from, to) {
  return {
    he: `המפה מתחלפת למצגת — שקופיות ${from}–${to}.`,
    en: `The map yields to the presentation — slides ${from}–${to}.`,
  };
}

function focusModel(he, en) {
  return {
    he: `מודל מוחשך ופוקוס על ${he}. ישובים אחרים מוחשכים, רק ${he} בולט עם ריבוע האור והילה סביבו.`,
    en: `Model dimmed and focused on ${en}. Other settlements dim; only ${en} stands out with a square of light and a halo.`,
  };
}

export const NARRATIVES = [
  {
    id: "segev",
    index: "01",
    narrative: "segev",
    title: { he: "משפחת שגב", en: "Segev family" },
    meta: { he: "בארי", en: "Be'eri" },
    steps: [
      {
        clock: "06:41",
        title: { he: "הבית בבארי", en: "The house in Be'eri" },
        gis: {
          he: "זום־אין על הבית של משפחת שגב בתצ״א שחור־לבן, שעון 6:41. סימון הבית בריבוע ורוד/אדום והכיתוב ״בית משפחת שגב״.",
          en: "Zoom to the Segev family home on black-and-white aerial, clock 06:41. The house is marked with a pink/red square and “Segev family home.”",
        },
        model: focusModel("בארי", "Be'eri"),
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
      },
      {
        title: { he: "מצגת", en: "Presentation" },
        gis: slides(1, 8),
        model: same,
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
      },
    ],
  },
  {
    id: "nova",
    index: "02",
    narrative: "nova",
    title: { he: "נובה ומור לוי", en: "Nova and Mor Levy" },
    meta: { he: "אתר הנובה", en: "Nova site" },
    steps: [
      {
        clock: "08:03",
        title: { he: "אתר הנובה", en: "The Nova site" },
        gis: {
          he: "זום־אין על אתר הנובה בתצ״א שחור־לבן. שעון 08:03.",
          en: "Zoom to the Nova site on black-and-white aerial. Clock 08:03.",
        },
        model: {
          he: `${focusModel("הנובה", "Nova").he} ברקע שכבת השטחים הפתוחים.`,
          en: `${focusModel("הנובה", "Nova").en} The open-spaces layer is in the background.`,
        },
        cue: { layers: [...FOCUS_LAYER_IDS, OPEN_SPACES], clock: "idle", escape: {} },
        kit: [],
      },
      {
        title: { he: "המתחמים", en: "The compounds" },
        gis: {
          he: "זום־אין על אתר הנובה: חלוקה למתחמים ושמות.",
          en: "Zoom to the Nova site: its compounds and their names.",
        },
        model: {
          he: "פוליגוני הנובה עולים בחמישה ביטים בני ארבע שניות, לפי הרצף המתועד.",
          en: "Nova polygons appear in five four-second beats, following the documented sequence.",
        },
        cue: { layers: NOVA_TIMELINE_LAYER_IDS, clock: {}, escape: {} },
        kit: ["timeline"],
      },
      {
        title: { he: "מסלולי הבריחה", en: "Escape routes" },
        note: {
          he: "החלק הראשון תיאר מה קרה באופן קולקטיבי; עכשיו צוללים לסיפור האישי של מור לוי.",
          en: "The first part was the collective story; now move to Mor Levy's personal story.",
        },
        gis: { he: "—", en: "—" },
        model: {
          he: "מסלולי הבריחה של האנשים מהנובה; ישובים נדלקים כשקווי הבריחה מתנגשים בהם.",
          en: "Escape routes of people from Nova; settlements light up where the routes intersect them.",
        },
        cue: { layers: NOVA_TIMELINE_LAYER_IDS, escape: { individual: true } },
        kit: ["escape"],
      },
      {
        title: { he: "מור לוי", en: "Mor Levy" },
        note: {
          he: "מתחילים בסיפור של מור. המדריך מספר את הרקע והמסלול שעשתה.",
          en: "Begin Mor's story. The guide tells her background and the route she took.",
        },
        gis: slides(9, 11),
        model: {
          he: "המסלול של מור: מהנובה, בריחה לאחד מפרדסי הלימונים ואז לאתר ההתארגנות של המידברן.",
          en: "Mor's route: from Nova, to one of the lemon groves, then to the Midburn staging site.",
        },
        cue: { layers: NOVA_TIMELINE_LAYER_IDS, escape: { mor: true } },
        kit: ["escape", "archive"],
        personQuery: "מור לוי",
      },
      {
        title: { he: "הנצחה", en: "Memorial" },
        gis: {
          he: "שקופיות 12–16: תמונות מתוך הארכיון של אתר הנובה עם נקודות הנצחה.",
          en: "Slides 12–16: images from the Nova site archive with memorial points.",
        },
        model: {
          he: "מודל מוחשך חוץ מהישובים ששמותיהם ״התנגשו״ בצירי הבריחה, עם נקודות של מי שנרצחו בנובה, ושל מי שנחטפו ונרצחו או נחטפו וחזרו בחיים.",
          en: "Model dimmed except the settlements hit by the escape routes, with points for people murdered at Nova and those kidnapped and murdered or returned alive.",
        },
        cue: { layers: [...FOCUS_LAYER_IDS, PEOPLE], escape: { individual: true } },
        kit: ["escape"],
      },
    ],
  },
  {
    id: "sderot",
    index: "03",
    narrative: "sderot",
    title: { he: "שדרות", en: "Sderot" },
    meta: { he: "תחנת המשטרה", en: "The police station" },
    steps: [
      {
        title: { he: "שדרות", en: "Sderot" },
        gis: {
          he: "זום־אין על שדרות בתצ״א שחור־לבן, נקודה על משטרת שדרות.",
          en: "Zoom to Sderot on black-and-white aerial, with a point on the Sderot police station.",
        },
        model: focusModel("שדרות", "Sderot"),
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
      },
      {
        title: { he: "מצגת", en: "Presentation" },
        gis: slides(17, 20),
        model: same,
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
      },
    ],
  },
  {
    id: "shura",
    index: "04",
    narrative: null,
    title: { he: "מחנה שורה", en: "Shura Camp" },
    meta: { he: "הזיהוי", en: "Identification" },
    steps: [
      {
        title: { he: "מחנה שורה", en: "Shura Camp" },
        note: { he: COPY.he.draft, en: COPY.en.draft },
        gis: unknown,
        model: unknown,
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
        draft: true,
      },
      {
        title: { he: "מצגת", en: "Presentation" },
        note: { he: COPY.he.draft, en: COPY.en.draft },
        gis: slides(21, 27),
        model: unknown,
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
        draft: true,
      },
    ],
  },
  {
    id: "hostages",
    index: "05",
    narrative: "hostages",
    title: { he: "חטופים", en: "Hostages" },
    meta: { he: "חיים פרי, ניר עוז", en: "Haim Peri, Nir Oz" },
    steps: [
      {
        title: { he: "ניר עוז", en: "Nir Oz" },
        gis: {
          he: "זום־אין על ניר עוז בתצ״א שחור־לבן, נקודה על הבית של משפחת פרי והכיתוב ״בית משפחת פרי״.",
          en: "Zoom to Nir Oz on black-and-white aerial, with a point on the Peri family home and “Peri family home.”",
        },
        model: focusModel("ניר עוז", "Nir Oz"),
        cue: { layers: FOCUS_LAYER_IDS },
        kit: ["archive"],
        personQuery: "חיים פרי",
      },
      {
        title: { he: "מצגת", en: "Presentation" },
        gis: slides(28, 33),
        model: same,
        cue: { layers: FOCUS_LAYER_IDS },
        kit: [],
      },
      {
        title: { he: "נרצחים וחטופים בניר עוז", en: "Nir Oz victims and hostages" },
        note: { he: "צריך לראות מה במצגת מתאים לזה.", en: "Determine which presentation content belongs here." },
        gis: { he: "—", en: "—" },
        model: {
          he: "אותו דבר, עם נקודות של מי שנרצחו בניר עוז, ושל מי שנחטפו ונרצחו או נחטפו וחזרו בחיים.",
          en: "Same, with points for people murdered in Nir Oz and those kidnapped and murdered or returned alive.",
        },
        cue: { layers: [...FOCUS_LAYER_IDS, PEOPLE] },
        kit: [],
      },
      {
        title: { he: "כל החטופים", en: "All hostages" },
        note: { he: "צריך לראות מה במצגת מתאים לזה.", en: "Determine which presentation content belongs here." },
        gis: { he: "—", en: "—" },
        model: {
          he: "המודל מפסיק להיות מוחשך והפוקוס יורד מניר עוז. נקודות של כל החטופים בלבד.",
          en: "The model is no longer dimmed and the focus leaves Nir Oz. Points for all hostages only.",
        },
        cue: { narrative: "hostages_all", layers: [...FOCUS_LAYER_IDS, PEOPLE] },
        kit: [],
      },
    ],
  },
];

export const SCRIPTS = [SHOW, ...NARRATIVES];

export const SCENES = [
  {
    id: "open",
    title: { he: "פתיחה", en: "Opening" },
    meta: { he: "יישובים, כביש 232, SEA, דרכי עזה", en: "Settlements, Road 232, SEA, Gaza roads" },
    cue: OPENING_CUE,
  },
  {
    id: "loop",
    title: { he: "ציר זמן בלולאה", en: "Loop timeline" },
    meta: { he: "כל היום, מתנגן ברצף", en: "The whole day, playing on repeat" },
    cue: { layers: TIMELINE_LAYER_IDS, clock: { loop: true } },
  },
  {
    id: "layers",
    title: { he: COPY.he.layersTitle, en: COPY.en.layersTitle },
    meta: { he: COPY.he.layersMeta, en: COPY.en.layersMeta },
  },
];
