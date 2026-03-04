const { execSync } = require("child_process");

test("getFirstCoordinate is not defined in projection-layer-manager or curation", () => {
  let out = "";
  try {
    out = execSync(
      'findstr /C:"function getFirstCoordinate" frontend\\src\\projection\\projection-layer-manager.js frontend\\src\\curation\\curation.js',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  expect(out.trim()).toBe("");
});
