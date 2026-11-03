import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [
    {
      name: "nli-staff-web-app-assets",
      apply: "build",
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          const htmlAsset = bundle["frontend/nli-staff-remote.html"];
          if (!htmlAsset || htmlAsset.type !== "asset") {
            throw new Error("Built NLI staff remote HTML entry was not emitted");
          }
          const html = String(htmlAsset.source);
          const manifestLink = html.match(/<link\s+rel="manifest"\s+href="([^"]+)"\s*\/?\s*>/i);
          if (!manifestLink) {
            throw new Error("Built NLI staff remote is missing its manifest link");
          }
          const emittedManifest = manifestLink[1].replace(/^(?:\.\.\/|\/)/, "");
          delete bundle[emittedManifest];
          htmlAsset.source = html.replace(
            manifestLink[0],
            '<link rel="manifest" href="./nli-staff.webmanifest" />',
          );
          this.emitFile({
            type: "asset",
            fileName: "frontend/nli-staff.webmanifest",
            source: fs.readFileSync(path.resolve(rootDir, "frontend/nli-staff.webmanifest")),
          });
          this.emitFile({
            type: "asset",
            fileName: "frontend/nli-staff-icon.webp",
            source: fs.readFileSync(path.resolve(rootDir, "frontend/nli-staff-icon.webp")),
          });
        },
      },
    },
  ],
  build: {
    outDir: path.resolve(rootDir, "frontend/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        map: path.resolve(rootDir, "frontend/index.html"),
        projection: path.resolve(rootDir, "frontend/projection.html"),
        projectionReversed: path.resolve(rootDir, "frontend/projection-reversed.html"),
        projectionConfig: path.resolve(rootDir, "frontend/projection-config.html"),
        displayIdentify: path.resolve(rootDir, "frontend/display-identify.html"),
        launcher: path.resolve(rootDir, "frontend/launcher.html"),
        qr: path.resolve(rootDir, "frontend/qr.html"),
        remote: path.resolve(rootDir, "frontend/remote-controller.html"),
        nliStaffRemote: path.resolve(rootDir, "frontend/nli-staff-remote.html"),
        curation: path.resolve(rootDir, "frontend/curation.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    pool: "vmThreads",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
    },
  },
});
