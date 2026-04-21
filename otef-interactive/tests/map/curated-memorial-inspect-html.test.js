import { describe, it, expect } from "vitest";
import { buildMemorialInspectHtml } from "../../frontend/src/map/curated-memorial-inspect-html.js";

describe("buildMemorialInspectHtml", () => {
  it("uses Hebrew fallbacks when name and description empty", () => {
    const html = buildMemorialInspectHtml({
      name: "",
      description: "",
      feature_type: "central",
    });
    expect(html).toContain("ללא שם");
    expect(html).toContain("אין תיאור");
  });

  it("includes provided name and description", () => {
    const html = buildMemorialInspectHtml({
      name: "אנדרטה",
      description: "טקסט הסבר",
      feature_type: "local",
    });
    expect(html).toContain("אנדרטה");
    expect(html).toContain("טקסט הסבר");
  });
});
