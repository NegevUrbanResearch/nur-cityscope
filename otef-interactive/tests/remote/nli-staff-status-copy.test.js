import { describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";

const html = fs.readFileSync("frontend/nli-staff-remote.html", "utf8");
const manifest = JSON.parse(fs.readFileSync("frontend/src/remote/nli-presenter-content.json", "utf8"));
const recordsDigest = crypto.createHash("sha256").update(JSON.stringify(manifest.records)).digest("hex");

describe("staff scene failures and reviewed Nova copy", () => {
  it("has no routine player cue status and provides an in-content cue retry", () => {
    expect(html).not.toContain('id="cueStatus"');
    expect(html).toMatch(/id="playerCueFailure"[^>]*role="alert"/);
    expect(html).toMatch(/id="playerCueRetry"/);
  });

  it("removes only the repeated Nova location from summaries across both memberships", () => {
    const keys = Object.keys(manifest.records).filter((key) => key.startsWith('["nova"'));
    expect(keys).toHaveLength(10);
    for (const key of keys) {
      const record = manifest.records[key];
      for (const locale of ["he", "en"]) {
        expect(record[locale].summary || "").not.toMatch(/באזור הנובה|in the Nova area/i);
      }
    }
    expect(manifest.records['["nova",["nli.investigation_polygons","nli.lines"],492]'].he.summary).toBe("שבעה בני אדם נחטפו.");
    expect(manifest.records['["nova",["nli.investigation_polygons","nli.lines"],492]'].en.summary).toBe("Seven people were abducted.");
    expect(manifest.editorialEvidence.recordsSha256).toBe(recordsDigest);
    expect(manifest.editorialEvidence.status).toBe("source-checked");
  });
});
