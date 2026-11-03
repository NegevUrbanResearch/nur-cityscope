import { expect, test } from "vitest";
import OTEFDataContext from "../../frontend/src/shared/OTEFDataContext.js";

test("management access returns the existing OTEF socket instance", () => {
  const original = OTEFDataContext._wsClient;
  const existingSocket = { send() {} };
  OTEFDataContext._wsClient = existingSocket;
  try {
    expect(OTEFDataContext.getManagementSocket()).toBe(existingSocket);
  } finally {
    OTEFDataContext._wsClient = original;
  }
});
