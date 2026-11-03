import { getLogger } from "../logger.js";

export const OTEFDataContextInternals =
  (typeof window !== "undefined" && window.OTEFDataContextInternals) || {};

OTEFDataContextInternals.getLogger = getLogger;

if (typeof window !== "undefined") {
  window.OTEFDataContextInternals = OTEFDataContextInternals;
}
