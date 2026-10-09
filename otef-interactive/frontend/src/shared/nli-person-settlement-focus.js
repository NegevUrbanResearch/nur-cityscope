import { resolveNliLocation } from "./nli-name-field-places.js";

const cleanName = value => String(value || "").trim().replace(/^קיבוץ /, "");

/** Match the accepted person's location to the settlement sidecar and map label. */
export function personSettlementFocus(person, settlements, knownCitynames = new Set()) {
  if (!person?.location) return null;
  const location = resolveNliLocation(person.location);
  const names = new Set([cleanName(person.location), cleanName(location.label)]);
  const settlement = (settlements || []).find(feature =>
    feature.properties?.locations?.some(name => names.has(cleanName(name))));
  const settlementNames = settlement?.properties?.locations || [];
  const label = [location.label, ...settlementNames, ...settlementNames.map(cleanName)]
    .find(name => knownCitynames.has(name)) || location.label;
  return { focusSettlement: label, focusSettlementOutlineId: settlement?.properties?.outlineObjectId ?? null };
}
