import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("vite builds every OTEF entry and nginx preserves the application routes", () => {
  const vite = read("vite.config.mjs");
  const nginx = read("../nginx/default.conf.template");
  for (const entry of ["index.html", "projection.html", "projection-config.html", "launcher.html", "qr.html", "remote-controller.html", "nli-staff-remote.html", "curation.html"]) {
    expect(vite).toContain(`frontend/${entry}`);
  }
  expect(vite).toContain('launcher: path.resolve(rootDir, "frontend/launcher.html")');
  expect(vite).toContain('qr: path.resolve(rootDir, "frontend/qr.html")');
  expect(nginx).toContain("location = / {");
  expect(nginx).toContain("return 302 /otef-interactive/launcher.html;");
  for (const route of [
    "location = /otef-interactive/projection.html",
    "location = /otef-interactive/remote-controller.html",
    "location = /otef-interactive/nli-staff-remote.html",
    "location /otef-interactive/",
    "location /api/",
    "location /ws/",
  ]) expect(nginx).toContain(route);
  expect(nginx).toContain("proxy_pass http://nur-api:9900/api/;");
  expect(nginx).toContain("proxy_pass http://nur-api:9900/ws/;");
  expect(nginx).toContain('proxy_set_header Upgrade $http_upgrade;');
  expect(nginx).toContain('proxy_set_header Connection "upgrade";');
  expect(nginx).toContain("location ^~ /otef-interactive/runtime/");
  expect(nginx).toContain('add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";');
});

test("generated runtime metadata is ignored as a directory", () => {
  expect(read("../.gitignore")).toContain("otef-interactive/frontend/runtime/");
});
