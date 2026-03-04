const LOG_LEVEL = "warn";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const shouldLog = (level) => LEVELS[level] >= LEVELS[LOG_LEVEL];

export const logger = {
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

export function getLogger() {
  return (typeof window !== "undefined" && window.logger) || logger;
}

if (typeof window !== "undefined") {
  window.logger = logger;
  window.getLogger = getLogger;
}
