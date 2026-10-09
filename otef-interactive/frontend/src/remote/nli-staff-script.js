import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { GAZA_BORDER_FULL_ID } from "../shared/gaza-border-style.js";

export const COPY = {
  he: {
    home: "דף הבית",
    prev: "הקודם",
    next: "הבא",
    done: "סיום",
    backToShow: "סיום הסיפור, המשך הרצף",
    startStory: "התחלת הסיפור: {{title}}",
    of: "מתוך",
    cueApplying: "שולח את הסצנה…",
    cueReady: "הסצנה נשלחה",
    cueFailed: "החלת הסצנה נכשלה",
    cueRetry: "ניסיון נוסף",
    homeRetry: "ניסיון נוסף",
    stepAria: "מעבר לשלב {{n}}",
    showTitle: "רצף ההקרנה המלא",
    showMeta: "הרצף המלא, שלב אחר שלב",
    searchLabel: "חיפוש שם או מקום",
    searchPlaceholder: "חיפוש שם או מקום",
    searchClearing: "מנקה את החיפוש…",
    searchClearFailed: "לא ניתן לנקות את החיפוש במפה. הבחירה הנוכחית נשמרה.",
    draft: "התוכן לשלב זה עדיין נכתב.",
    steps: "שלבים",
    disconnected: "אין חיבור למפה",
    connected: "מחובר",
    connecting: "מתחבר…",
    fullscreenEnter: "מעבר למסך מלא",
    fullscreenExit: "יציאה ממסך מלא",
    fullscreenUnavailable: "המסך המלא אינו זמין בדפדפן הזה",
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
    cueApplying: "Sending the scene…",
    cueReady: "Scene sent",
    cueFailed: "Could not apply this scene",
    cueRetry: "Retry",
    homeRetry: "Retry",
    stepAria: "Go to step {{n}}",
    showTitle: "Full projection sequence",
    showMeta: "The full sequence, step by step",
    searchLabel: "Search a name or place",
    searchPlaceholder: "Search a name or place",
    searchClearing: "Clearing search…",
    searchClearFailed: "Could not clear the map search. The current selection was kept.",
    draft: "This step is still being written.",
    steps: "steps",
    disconnected: "Map is disconnected",
    connected: "Connected",
    connecting: "Connecting…",
    fullscreenEnter: "Enter fullscreen",
    fullscreenExit: "Exit fullscreen",
    fullscreenUnavailable: "Fullscreen is unavailable in this browser",
    placeTypeSettlement: "Settlement",
    archiveMissing: "No archive record found for this name.",
  },
};

const SETTLEMENT_LAYER_IDS = [
  "projector_base.שמות_יישובים",
  "projector_base.Locations_Lines",
  "projector_base.ישובים",
];
const ROUTE_232 = "nli.ציר_232";
const HOUSE_OUTLINES = "nli.narrative_polygon";
const SEA = "projector_base.SEA";
const GAZA_ROADS = "gaza.Gaza_Roads";
const PEOPLE = "nli.people";
const OPEN_SPACES = "land_use.שטחים_פתוחים";

export const PEOPLE_NAMES_LAYER_IDS = ["nli.people_names"];
export const FOCUS_LAYER_IDS = [...SETTLEMENT_LAYER_IDS, ROUTE_232, HOUSE_OUTLINES, GAZA_BORDER_FULL_ID];
export const OPENING_LAYER_IDS = [...FOCUS_LAYER_IDS, SEA, GAZA_ROADS];
export const TIMELINE_LAYER_IDS = [...OPENING_LAYER_IDS, ...NLI_PLAYABLE_IDS];
export const HOME_LAYER_IDS = [
  "projector_base.שמות_יישובים",
  "projector_base.Locations_Lines",
  "projector_base.ישובים",
  "nli.ציר_232",
  "projector_base.SEA",
  "gaza.Gaza_Roads",
  GAZA_BORDER_FULL_ID,
];
export const IDENTITY_LAYER_IDS = [...FOCUS_LAYER_IDS, PEOPLE];
export const WALL_LAYER_IDS = PEOPLE_NAMES_LAYER_IDS;

const NOVA_TIMELINE_LAYER_IDS = [...FOCUS_LAYER_IDS, ...NLI_PLAYABLE_IDS];

/**
 * A cue is the map state a step applies on entry. Every key is optional:
 * `narrative` overrides the script narrative (`null` exits to the overview),
 * `layers` is the exact set of enabled layers, `clock` is `"idle"`, `"ended"`,
 * or a play window `{ from, to }` in minutes of the day, and `escape` sets the
 * Nova escape overlay (unlisted routes turn off).
 */
export const HOME_CUE = { narrative: null, layers: HOME_LAYER_IDS, clock: "idle", escape: {} };
const IDENTITY_CUE = { layers: IDENTITY_LAYER_IDS, clock: "idle" };
const WALL_CUE = { layers: WALL_LAYER_IDS, clock: "idle" };

const OPENING_MINUTES = {
  id: "opening-minutes",
  clock: "06:29",
  title: { he: "הדקות הראשונות", en: "The opening minutes" },
  note: {
    he: "ציר זמן 6:29–6:41, עד שעת ההתחלה של האירועים של משפחת שגב.",
    en: "Timeline 06:29–06:41, up to the start of the Segev family events.",
  },
  cue: { layers: TIMELINE_LAYER_IDS, clock: { to: 401 } },
  kit: ["timeline"],
};

const REST_OF_DAY = {
  id: "rest-of-day",
  clock: "06:42",
  title: { he: "שאר היום", en: "The rest of the day" },
  note: {
    he: "ציר הזמן ממשיך מ־6:42 ועד סוף היום.",
    en: "The timeline runs from 06:42 to the end of the day.",
  },
  cue: { layers: TIMELINE_LAYER_IDS, clock: { from: 402 } },
  kit: ["timeline"],
};

const TIMELINE_COMPLETE = {
  id: "timeline-complete",
  title: { he: "ציר הזמן המלא", en: "The full timeline" },
  cue: { narrative: null, layers: TIMELINE_LAYER_IDS, clock: "idle", escape: {} },
  kit: [],
};

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
    OPENING_MINUTES,
    {
      id: "segev-family",
      title: { he: "משפחת שגב", en: "Segev family" },
      branch: ["segev"],
      kit: [],
    },
    REST_OF_DAY,
    {
      id: "nova-mor-levy",
      title: { he: "נובה ומור לוי", en: "Nova and Mor Levy" },
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
      cue: WALL_CUE,
      kit: ["search", "presentation"],
      presentation: { segmentId: "names_wall", open: "auto", onClose: "stay", controls: false },
    },
  ],
};

export const HOME_SHOW_SHORTCUTS = Object.freeze([
  {
    id: SHOW_STEP_IDS.IDENTITY,
    index: "07",
    title: { he: "מאגר הזהויות", en: "Identity database" },
    meta: { he: "אנשים כנקודות וחיפוש", en: "People as points and search" },
  },
  {
    id: SHOW_STEP_IDS.WALL,
    index: "08",
    title: { he: "קיר השמות", en: "Names wall" },
    meta: { he: "כל השמות וחיפוש", en: "All names and search" },
  },
]);

export const TIMELINE = {
  id: "timeline",
  index: "00",
  narrative: null,
  title: { he: "ציר הזמן", en: "The timeline" },
  steps: [OPENING_MINUTES, REST_OF_DAY, TIMELINE_COMPLETE],
};

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
        cue: { layers: FOCUS_LAYER_IDS, clock: "idle" },
        kit: ["presentation"],
        presentation: { segmentId: "segev", open: "manual", onClose: "stay" },
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
        cue: { layers: [...FOCUS_LAYER_IDS, OPEN_SPACES], clock: "idle", escape: {} },
        kit: [],
      },
      {
        title: { he: "המתחמים", en: "The compounds" },
        note: {
          he: "פוליגוני הנובה עולים בחמישה ביטים בני שמונה שניות, לפי הרצף המתועד.",
          en: "Nova polygons appear in five eight-second beats, following the documented sequence.",
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
        cue: { layers: NOVA_TIMELINE_LAYER_IDS, clock: "ended", hiddenDisplays: ["gis", "projection"], escape: { individual: true } },
        kit: ["escape"],
        escapeKinds: ["individual"],
      },
      {
        title: { he: "מור לוי", en: "Mor Levy" },
        note: {
          he: "מתחילים בסיפור של מור. המדריך מספר את הרקע והמסלול שעשתה.",
          en: "Begin Mor's story. The guide tells her background and the route she took.",
        },
        cue: { layers: NOVA_TIMELINE_LAYER_IDS, clock: "ended", hiddenDisplays: ["gis", "projection"], escape: { mor: true } },
        kit: ["escape", "presentation"],
        escapeKinds: ["mor"],
        presentation: { segmentId: "nova_mor", open: "auto", onClose: "stay" },
      },
      {
        title: { he: "הנצחה", en: "Memorial" },
        cue: { layers: [...FOCUS_LAYER_IDS, PEOPLE], clock: "ended", hiddenDisplays: ["gis", "projection"], escape: { settled: true } },
        kit: ["escape", "presentation"],
        escapeKinds: ["individual"],
        presentation: { segmentId: "nova_memorial", open: "auto", onClose: "stay" },
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
        cue: { layers: FOCUS_LAYER_IDS, clock: "idle" },
        kit: ["presentation"],
        presentation: { segmentId: "sderot", open: "manual", onClose: "stay" },
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
        cue: { layers: TIMELINE_LAYER_IDS, clock: "idle", hiddenDisplays: ["projection"] },
        kit: ["presentation"],
        presentation: { segmentId: "shura", open: "auto", onClose: "stay" },
      },
    ],
  },
  {
    id: "hostages",
    index: "05",
    narrative: "hostages",
    title: { he: "חיים פרי וחטופים", en: "Haim Peri and hostages" },
    meta: { he: "חיים פרי, ניר עוז", en: "Haim Peri, Nir Oz" },
    steps: [
      {
        title: { he: "ניר עוז", en: "Nir Oz" },
        cue: { layers: FOCUS_LAYER_IDS, clock: "idle" },
        kit: [],
      },
      {
        title: { he: "מצגת", en: "Presentation" },
        cue: { layers: FOCUS_LAYER_IDS, clock: "idle", hiddenDisplays: ["gis", "projection"] },
        kit: ["presentation"],
        presentation: { segmentId: "hostages", open: "auto", onClose: "stay" },
      },
      {
        title: { he: "נרצחים וחטופים בניר עוז", en: "Nir Oz victims and hostages" },
        cue: { layers: [...FOCUS_LAYER_IDS, PEOPLE], clock: "idle", hiddenDisplays: ["gis", "projection"] },
        kit: [],
      },
      {
        title: { he: "כל החטופים", en: "All hostages" },
        cue: { narrative: "hostages_all", layers: [...FOCUS_LAYER_IDS, PEOPLE], clock: "idle", hiddenDisplays: ["gis", "projection"] },
        kit: [],
      },
    ],
  },
];

export const SCRIPTS = [SHOW, TIMELINE, ...NARRATIVES];
