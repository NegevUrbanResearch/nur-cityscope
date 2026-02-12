// OTEFDataContext internals namespace
// Shared helpers for DataContext submodules
// getLogger: single source from logger.js (window.getLogger)

window.OTEFDataContextInternals = window.OTEFDataContextInternals || {};

window.OTEFDataContextInternals.getLogger =
  typeof window !== "undefined" && window.getLogger
    ? window.getLogger
    : function () {
        return {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        };
      };
