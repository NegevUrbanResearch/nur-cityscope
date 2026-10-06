import { NOVA_RIBBON_COLORS } from "./nli-investigation-theme.js";

/** The Nova ribbons are runtime overlays, outside the authored layer registry. */
export function novaEscapeLegendLayer(dataContext, language) {
  const overlay = dataContext.getEscapeOverlay?.();
  if (dataContext.getNarrativeState?.()?.id !== "nova"
    || (overlay?.individual !== true && overlay?.overlap !== true)) return null;

  const label = language === "en" ? "Fleeing routes" : "צירי בריחה";
  const { fromColor, toColor, gradientSize } = NOVA_RIBBON_COLORS;
  const band = (1 - gradientSize) / 2;
  return {
    id: "nli.fleeing_routes",
    name: label,
    geometryType: "line",
    items: [{
      id: "nli.fleeing_routes",
      label,
      shape: "line",
      stroke: fromColor,
      strokeWidth: 6,
      strokeOpacity: overlay.overlap === true ? 1 : 0.6,
      strokeGradient: [
        { offset: 0, color: fromColor },
        { offset: band, color: fromColor },
        { offset: 1 - band, color: toColor },
        { offset: 1, color: toColor },
      ],
    }],
  };
}
