// Logger utility for OTEF Interactive
// Provides leveled logging with production-safe defaults

const LOG_LEVEL = "warn";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const shouldLog = (level) => LEVELS[level] >= LEVELS[LOG_LEVEL];

const logger = {
  debug: (...args) => {
    if (shouldLog("debug")) console.debug(...args);
  },
  info: (...args) => {
    if (shouldLog("info")) console.info(...args);
  },
  warn: (...args) => {
    if (shouldLog("warn")) console.warn(...args);
  },
  error: (...args) => {
    if (shouldLog("error")) console.error(...args);
  },
};

// Make available globally for script tag loading
if (typeof window !== "undefined") {
  window.logger = logger;
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = logger;
}
