/**
 * Global variables that are shared between components
 * These are updated through API calls to match the backend state
 */
const globals = {
  // Current indicator state (year, parameters, etc.)
  INDICATOR_STATE: { year: 2023, scenario: 'current', label: 'Current State' },
  
  // Current indicator ID
  INDICATOR_ID: 1,
  
  // Visualization mode (image or map)
  VISUALIZATION_MODE: 'map'
};

export default globals; 