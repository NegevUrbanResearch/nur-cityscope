// HTML Utilities
// Shared utilities for HTML manipulation and escaping

/**
 * Escape HTML to prevent XSS attacks
 * @param {string|any} value - Value to escape (will be converted to string)
 * @returns {string} Escaped HTML string
 */
function escapeHtml(value) {
  if (value == null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Make available globally for script tag loading
if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
