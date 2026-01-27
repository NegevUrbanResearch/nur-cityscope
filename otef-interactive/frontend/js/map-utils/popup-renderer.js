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
  const titleField = popupConfig.titleField;
  
  // Build layer category header if provided
  let categoryHeader = '';
  if (layerName) {
    categoryHeader = `<div class="popup-category">${escapeHtml(layerName)}</div>`;
  }
  
  // Build title if specified (from feature property)
  let title = '';
  if (titleField && props[titleField]) {
    const titleValue = formatFieldValue(props[titleField]);
    title = `<h3 class="popup-title">${escapeHtml(titleValue)}</h3>`;
  }

  // Build field list
  const fieldItems = [];
  for (const field of popupConfig.fields) {
    // Skip the titleField if it's also in the fields array (avoid duplication)
    if (titleField && field.key === titleField) {
      continue;
    }
    
    const value = props[field.key];
    
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

  // If we have a title but no fields (because titleField was the only field), show just the title
  if (fieldItems.length === 0 && title) {
    return `
      <div class="popup-content" dir="rtl">
        ${categoryHeader}
        ${title}
      </div>
    `;
  }

  // If no title and no fields, return a message
  if (fieldItems.length === 0 && !title) {
    return '<div class="popup-content"><p>No information available</p></div>';
  }

  return `
    <div class="popup-content" dir="rtl">
      ${categoryHeader}
      ${title}
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
