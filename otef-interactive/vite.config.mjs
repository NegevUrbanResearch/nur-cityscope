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
        remote: path.resolve(rootDir, "frontend/remote-controller.html"),
        curation: path.resolve(rootDir, "frontend/curation.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
    },
  },
});
