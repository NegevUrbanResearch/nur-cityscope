/**
 * Cartographic legend for the Leaflet GIS map.
 * Depends on the global `layerState` object.
 */

/**
 * Update cartographic legend to show only active layers.
 */
function updateMapLegend() {
  const legend = document.getElementById("mapLegend");
  if (!legend) return;

  const activeLayers = [];

  // Roads layer
  if (layerState.roads) {
    activeLayers.push({
      title: "Roads",
      items: [
        {
          symbol: { background: "#505050", border: "#303030" },
          label: "Road Network",
        },
      ],
    });
  }

  // Parcels layer with land use categories
  if (layerState.parcels) {
    activeLayers.push({
      title: "Land Use",
      items: [
        { symbol: { background: "#ffd700", border: "#b8860b" }, label: "Residential" },
        { symbol: { background: "#ff6b6b", border: "#cc5555" }, label: "Commercial" },
        { symbol: { background: "#9370db", border: "#7b5cb5" }, label: "Industry" },
        {
          symbol: { background: "#90ee90", border: "#5fad5f" },
          label: "Public Open Space",
        },
        { symbol: { background: "#228b22", border: "#1a6b1a" }, label: "Forest" },
        {
          symbol: { background: "#87ceeb", border: "#6ba5c7" },
          label: "Public Institution",
        },
        { symbol: { background: "#e0e0e0", border: "#b0b0b0" }, label: "Other" },
      ],
    });
  }

  // Model base layer
  if (layerState.model) {
    activeLayers.push({
      title: "Model Base",
      items: [
        {
          symbol: null,
          label: "Physical 3D model overlay",
        },
      ],
    });
  }

  // Major roads layer
  if (layerState.majorRoads) {
    activeLayers.push({
      title: "Major Roads",
      items: [
        { symbol: { background: "#B22222", border: "#8B1A1A" }, label: "Primary Road" },
        { symbol: { background: "#CD853F", border: "#A06B30" }, label: "Regional Road" },
      ],
    });
  }

  // Small roads layer
  if (layerState.smallRoads) {
    activeLayers.push({
      title: "Small Roads",
      items: [
        { symbol: { background: "#A0A0A0", border: "#707070" }, label: "Local Roads" },
      ],
    });
  }

  // Build legend HTML
  if (activeLayers.length === 0) {
    legend.innerHTML = "";
    return;
  }

  let html = '<div class="map-legend-title has-groups">Legend</div>';

  activeLayers.forEach((group) => {
    html += '<div class="map-legend-group">';
    html += `<div class="map-legend-group-title">${group.title}</div>`;

    group.items.forEach((item) => {
      html += '<div class="map-legend-item">';
      if (item.symbol) {
        html += `<span class="map-legend-symbol" style="background: ${item.symbol.background}; border-color: ${item.symbol.border};"></span>`;
      } else {
        html += '<span class="map-legend-symbol" style="background: transparent; border: none;"></span>';
      }
      html += `<span class="map-legend-label">${item.label}</span>`;
      html += "</div>";
    });

    html += "</div>";
  });

  legend.innerHTML = html;
}

