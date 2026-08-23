import { describe, expect, test } from "vitest";
import { renderPopupContent } from "../../frontend/src/map-utils/popup-renderer.js";

const NLI_CATALOG_POPUP = {
  titleField: "name_he",
  hideEmpty: true,
  fields: [
    { label: "Hebrew name", key: "name_he" },
    { label: "English name", key: "name_en" },
    { label: "Categories", key: "categories" },
  ],
};

describe("renderPopupContent", () => {
  test("renders nli catalog keys from processed geojson properties", () => {
    const html = renderPopupContent(
      {
        properties: {
          name_he: "פוזדניקוב, אליק",
          name_en: "Pozdnykov, Alik",
          categories: "Fallen soldiers",
        },
      },
      NLI_CATALOG_POPUP,
      "NLI catalog",
    );
    expect(html).toContain("popup-category");
    expect(html).toContain("NLI catalog");
    expect(html).toContain("Hebrew name");
    expect(html).toContain("Pozdnykov, Alik");
    expect(html).toContain("Fallen soldiers");
  });

  test("looks up keys case-insensitively and hides empty fields", () => {
    const html = renderPopupContent(
      { properties: { NAME: "Nova", timeline: "" } },
      {
        hideEmpty: true,
        fields: [
          { label: "Name", key: "Name" },
          { label: "Timeline", key: "timeline" },
        ],
      },
    );
    expect(html).toContain("Nova");
    expect(html).not.toContain("Timeline");
  });

  test("renders nli_url fields as links", () => {
    const html = renderPopupContent(
      {
        properties: {
          nli_url: "https://www.nli.org.il/he/authorities/987007591931905171",
        },
      },
      {
        hideEmpty: true,
        fields: [{ label: "NLI catalog", key: "nli_url", type: "url", linkLabel: "Open record" }],
      },
    );
    expect(html).toContain('href="https://www.nli.org.il/he/authorities/987007591931905171"');
    expect(html).toContain("Open record");
    expect(html).toContain('target="_blank"');
  });

  test("escapes HTML in property values", () => {
    const html = renderPopupContent(
      { properties: { Name: "<img src=x>" } },
      { fields: [{ label: "Name", key: "Name" }] },
    );
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img src=x>");
  });
});
