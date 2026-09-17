import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  build: {
    outDir: path.resolve(rootDir, "frontend/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        map: path.resolve(rootDir, "frontend/index.html"),
        projection: path.resolve(rootDir, "frontend/projection.html"),
        projectionConfig: path.resolve(rootDir, "frontend/projection-config.html"),
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
