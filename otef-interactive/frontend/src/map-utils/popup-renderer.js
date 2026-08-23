/**
 * Popup Renderer
 *
 * Unified popup rendering for GeoJSON and PMTiles layers.
 * Renders safe HTML from feature properties based on layer popup configuration.
 */
import { escapeHtml } from "../shared/html-utils.js";

/**
 * Render popup content from feature properties and popup configuration.
 * @param {Object} feature - Feature object with properties (GeoJSON or normalized PMTiles)
 * @param {Object} popupConfig - Popup config from layer manifest (ui.popup)
 * @param {string} [layerName] - Optional layer name to show as category header
 * @returns {string} HTML content for the GIS popup
 */
function renderPopupContent(feature, popupConfig, layerName) {
  if (!popupConfig || !popupConfig.fields) {
    return '<div class="popup-content">No popup configuration</div>';
  }

  const props = feature.properties || {};
  const hideEmpty = popupConfig.hideEmpty !== false; // Default to true

  let categoryHeader = "";
  if (layerName) {
    categoryHeader = `<div class="popup-category">${escapeHtml(layerName)}</div>`;
  }

  const fieldItems = [];
  for (const field of popupConfig.fields) {
    const key = field.key;

    let value = props[key];
    if (value === undefined) {
      const lowerKey = key.toLowerCase();
      const actualKey = Object.keys(props).find((k) => k.toLowerCase() === lowerKey);
      if (actualKey) {
        value = props[actualKey];
      }
    }

    if (hideEmpty && (value === null || value === undefined || value === "" || value === " ")) {
      continue;
    }

    const formattedValue = formatFieldValue(value);
    const label = escapeHtml(field.label);
    const valueHtml = formatFieldHtml(formattedValue, field);

    fieldItems.push(`
      <div class="popup-field">
        <span class="popup-label">${label}:</span>
        <span class="popup-value">${valueHtml}</span>
      </div>
    `);
  }

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
        ${fieldItems.join("")}
      </div>
    </div>
  `;
}

/**
 * Format a field value for display.
 * @param {*} value - Raw field value
 * @returns {string} Formatted string
 */
function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function formatFieldHtml(value, field) {
  const href = typeof value === "string" ? value.trim() : "";
  const asUrl = field && (field.type === "url" || isHttpUrl(href));
  if (!asUrl || !isHttpUrl(href)) {
    return escapeHtml(value);
  }
  const label = field && field.linkLabel ? String(field.linkLabel) : href;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function formatFieldValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "כן" : "לא";
  }

  if (typeof value === "number") {
    return value.toString();
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return String(value);
}

if (typeof window !== "undefined") {
  window.renderPopupContent = renderPopupContent;
}

export { renderPopupContent };
