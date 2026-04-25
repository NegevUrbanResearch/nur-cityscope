const { execSync } = require("child_process");

test("getFirstCoordinate is not defined in curation", () => {
  let out = "";
  try {
    out = execSync(
      'findstr /C:"function getFirstCoordinate" frontend\\src\\curation\\curation.js',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  expect(out.trim()).toBe("");
});
