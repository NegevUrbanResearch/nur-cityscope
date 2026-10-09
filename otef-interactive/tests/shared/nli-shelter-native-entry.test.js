import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("loads shelter contact modules through the native browser resolver", () => {
  const entry = fileURLToPath(
    new URL(
      "../../frontend/src/shared/nli-shelter-contacts.js",
      import.meta.url,
    ),
  );
  const harness = `
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    import { SourceTextModule, createContext } from 'node:vm';
    const context = createContext({ console });
    const modules = new Map();
    function load(url) {
      if (!modules.has(url.href)) modules.set(url.href, new SourceTextModule(
        readFileSync(url, 'utf8'), { context, identifier: url.href },
      ));
      return modules.get(url.href);
    }
    const entry = load(pathToFileURL(process.argv[1]));
    await entry.link((specifier, parent) => {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error('Native browser cannot resolve: ' + specifier);
      }
      return load(new URL(specifier, parent.identifier));
    });
    await entry.evaluate();
    console.log(typeof entry.namespace.buildShelterContactIndex);
  `;
  expect(
    execFileSync(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--input-type=module",
        "-e",
        harness,
        entry,
      ],
      { encoding: "utf8" },
    ).trim(),
  ).toBe("function");
});
