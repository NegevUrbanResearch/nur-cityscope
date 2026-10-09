// Display copy keyed by the existing Nova story polygon IDs. Source data stays literal.
const ENGLISH_NAMES = Object.freeze({
  97: 'Fighting — Highway 232',
  98: 'Fighting — southern tank position',
  99: 'Fighting — wooded area',
  100: 'Fighting — Nova site',
  102: 'Fighting — vendor parking',
  103: 'Fighting — main parking area',
  104: 'Abduction of Almog Meir Jan, Bar Kuperstein, Elkana Bohbot, Evyatar David, Guy Gilboa-Dalal, Maxim Herkin, and Yosef Ohana',
  105: 'Abduction of Omer Shem Tov, Ori Danino, Maya and Itay Regev',
  106: 'Abduction of Eitan Mor, Rom Braslavski, and Moran Stella Yanai',
  182: 'Abduction of Roni Krivoi',
  183: 'Abduction of Inbar Haiman',
  184: 'Abduction of Shlomi Ziv and Andrey Kozlov',
  185: 'Abduction of Noa Argamani and Avinatan Or',
  186: 'Abduction of Segev Kalfon',
});
const EITAN_MOR_DISPLAY_NAME = 'חטיפת איתן מור, רום ברסלבסקי ומורן סטלה ינאי';
const EITAN_MOR_NAME_SUFFIX = ' (זמן משוער - ייתכן שנחטפו בזמנים שונים לאורך הצהריים)';

export function novaExplainerName(properties, language = 'he') {
  const value = properties?.Name;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (language === 'en') return Object.hasOwn(ENGLISH_NAMES, properties.OBJECTID) ? ENGLISH_NAMES[properties.OBJECTID] : null;
  const trimmed = value.trim();
  if (trimmed === `${EITAN_MOR_DISPLAY_NAME}${EITAN_MOR_NAME_SUFFIX}`) return EITAN_MOR_DISPLAY_NAME;
  if (/^מוקד לחימה \d+ -/.test(trimmed)) return trimmed.replace(/^מוקד לחימה \d+ -/, 'מוקד לחימה -');
  return value;
}
