// OTEFDataContext internals namespace
// Shared helpers for DataContext submodules

window.OTEFDataContextInternals = window.OTEFDataContextInternals || {};

window.OTEFDataContextInternals.getLogger =
  window.OTEFDataContextInternals.getLogger ||
  function () {
    return (typeof window !== "undefined" && window.logger) || {
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
  };
