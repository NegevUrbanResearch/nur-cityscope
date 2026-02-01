/**
 * Popup Renderer
 *
 * Unified popup rendering for GeoJSON and PMTiles layers.
 * Renders safe HTML from feature properties based on layer popup configuration.
 */

/**
 * Render popup content from feature properties and popup configuration.
 * @param {Object} feature - Feature object with properties (GeoJSON or normalized PMTiles)
 * @param {Object} popupConfig - Popup config from layer manifest (ui.popup)
 * @param {string} [layerName] - Optional layer name to show as category header
 * @returns {string} HTML content for Leaflet popup
 */
function renderPopupContent(feature, popupConfig, layerName) {
  if (!popupConfig || !popupConfig.fields) {
    return '<div class="popup-content">No popup configuration</div>';
  }

  const props = feature.properties || {};
  const hideEmpty = popupConfig.hideEmpty !== false; // Default to true

  // Build layer category header if provided
  let categoryHeader = '';
  if (layerName) {
    categoryHeader = `<div class="popup-category">${escapeHtml(layerName)}</div>`;
  }

  // Build field list
  const fieldItems = [];
  for (const field of popupConfig.fields) {
    const key = field.key;

    // Case-insensitive lookup
    let value = props[key];
    if (value === undefined) {
       const lowerKey = key.toLowerCase();
       const actualKey = Object.keys(props).find(k => k.toLowerCase() === lowerKey);
       if (actualKey) {
           value = props[actualKey];
       }
    }

    // Skip empty fields if hideEmpty is true
    if (hideEmpty && (value === null || value === undefined || value === '' || value === ' ')) {
      continue;
    }

    const formattedValue = formatFieldValue(value);
    const label = escapeHtml(field.label);
    const valueHtml = escapeHtml(formattedValue);

    fieldItems.push(`
      <div class="popup-field">
        <span class="popup-label">${label}:</span>
        <span class="popup-value">${valueHtml}</span>
      </div>
    `);
  }

  // If no fields found
  if (fieldItems.length === 0) {
    return `
      <div class="popup-content" dir="rtl">
        ${categoryHeader}
        <p>No information available</p>
      </div>
    `;
  }

  return `
    <div class="popup-content" dir="rtl">
      ${categoryHeader}
      <div class="popup-fields">
        ${fieldItems.join('')}
      </div>
    </div>
  `;
}

/**
 * Format a field value for display.
 * @param {*} value - Raw field value
 * @returns {string} Formatted string
 */
function formatFieldValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle boolean values
  if (typeof value === 'boolean') {
    return value ? 'כן' : 'לא';
  }

  // Handle numeric values (no special formatting for now)
  if (typeof value === 'number') {
    return value.toString();
  }

  // Handle strings - trim whitespace
  if (typeof value === 'string') {
    return value.trim();
  }

  // Fallback: convert to string
  return String(value);
}

// escapeHtml is provided by html-utils.js (loaded via script tag)

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPopupContent };
}
