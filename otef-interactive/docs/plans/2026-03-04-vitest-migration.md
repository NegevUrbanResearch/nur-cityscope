# Vitest Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the frontend testing suite from Jest and Babel to Vitest, bringing testing perfectly in line with the Vite build ecosystem.

**Architecture:**
We will remove all Jest, Babel, and experimental Node flag configurations since Vitest natively understands ES Modules and TypeScript using the exact same `vite.config.mjs` resolution logic as the dev server. The `test` script will be updated to use Vitest, and the test syntax will be transitioned from the `jest` global object to the `vi` object.

**Tech Stack:** Vitest, Vite, Bun (package manager), Node.js

---

### Task 1: Update Test Dependencies & Configuration

**Files:**
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\package.json`
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\vite.config.mjs`

**Step 1: Install Vitest and remove Jest/Babel**

Run the following command to update dependencies using Bun:
```bash
cd d:\Projects\Nur\nur-cityscope\otef-interactive
bun remove jest babel-jest @babel/core @babel/preset-env
bun add -d vitest @vitest/coverage-v8
```

**Step 2: Update the `test` script in `package.json`**

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build:frontend": "vite build",
    "dev:frontend": "vite"
  }
```

**Step 3: Update `vite.config.mjs` to enable test globals**

We need to add the `test` property to support globals so we don't have to import `describe`, `it`, `expect`, and `vi` in every single test file.

```javascript
export default defineConfig({
  root: rootDir,
  build: {
    outDir: path.resolve(rootDir, "frontend/dist"),
    emptyOutDir: true,
    rollupOptions: { /* ... */ }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
  }
});
```

**Step 4: Commit changes**

```bash
git add package.json vite.config.mjs bun.lockb
git commit -m "chore: swap jest/babel dependencies for vitest"
```

---

### Task 2: Remove Old Configuration Files

**Files:**
- Delete: `d:\Projects\Nur\nur-cityscope\otef-interactive\jest.config.cjs`
- Delete: `d:\Projects\Nur\nur-cityscope\otef-interactive\babel.config.cjs`

**Step 1: Delete the legacy Jest and Babel configuration files**

```bash
rm d:\Projects\Nur\nur-cityscope\otef-interactive\jest.config.cjs
rm d:\Projects\Nur\nur-cityscope\otef-interactive\babel.config.cjs
```
*(On Windows standard command prompt or PowerShell, use `del` or `Remove-Item` instead of `rm`, or just delete them directly).*

**Step 2: Commit changes**

```bash
git add jest.config.cjs babel.config.cjs
git commit -m "chore: remove legacy jest and babel configurations"
```

---

### Task 3: Migrate Test Syntax from Jest to Vitest

**Files:**
- Modify: All `.test.js` files in `d:\Projects\Nur\nur-cityscope\otef-interactive\tests\`

**Step 1: Search and replace Jest APIs across all tests**

Vitest is specifically designed to be highly compatible with Jest, but the global mocking object changes from `jest` to `vi`. Since we enabled `globals: true` in the Vite config, we do not need to import `vi`.

Run a find-and-replace across the entire `tests` directory:
- Replace `jest.fn(` with `vi.fn(`
- Replace `jest.spyOn(` with `vi.spyOn(`
- Replace `jest.mock(` with `vi.mock(`
- Replace `jest.resetModules(` with `vi.resetModules(`
- Replace `jest.clearAllMocks(` with `vi.clearAllMocks(`
- Replace `jest.mockResolvedValue(` with `vi.mockResolvedValue(` (wait, actually, `mockResolvedValue` is a method on the mock itself, so `global.fetch = vi.fn().mockResolvedValue(...)` is exactly identical and works natively).

You can run this PowerShell script to automatically perform the replacements:
```powershell
Get-ChildItem -Path "d:\Projects\Nur\nur-cityscope\otef-interactive\tests" -Filter "*.test.js" -Recurse | ForEach-Object {
    (Get-Content $_.FullName) -replace 'jest\.fn', 'vi.fn' `
                              -replace 'jest\.spyOn', 'vi.spyOn' `
                              -replace 'jest\.mock', 'vi.mock' `
                              -replace 'jest\.resetModules', 'vi.resetModules' `
                              -replace 'jest\.clearAllMocks', 'vi.clearAllMocks' | Set-Content $_.FullName
}
```

**Step 2: Run the test suite to verify passes**

```bash
cd d:\Projects\Nur\nur-cityscope\otef-interactive
bun run test
```
Expected output: All tests should pass beautifully and significantly faster, natively utilizing the ES module resolution.

**Step 3: Commit changes**

```bash
git add tests/
git commit -m "test: migrate jest APIs to vitest"
```
