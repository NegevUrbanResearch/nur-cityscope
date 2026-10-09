import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function collectFiles(frontendRoot) {
  const files = [];
  const addTree = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await addTree(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  };

  await addTree(path.join(frontendRoot, "src"));
  await addTree(path.join(frontendRoot, "css"));
  const rootEntries = await readdir(frontendRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      files.push(path.join(frontendRoot, entry.name));
    }
  }
  const manifestPath = path.join(frontendRoot, "nli-staff.webmanifest");
  try {
    files.push(manifestPath);
    await readFile(manifestPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    files.pop();
  }
  return files.sort((a, b) => {
    const left = path.relative(frontendRoot, a).split(path.sep).join("/");
    const right = path.relative(frontendRoot, b).split(path.sep).join("/");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export async function writeFrontendVersion({ frontendRoot }) {
  const root = path.resolve(frontendRoot);
  const files = await collectFiles(root);
  const hash = createHash("sha256");
  for (const filePath of files) {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const relativeBytes = Buffer.from(relativePath, "utf8");
    const contents = await readFile(filePath);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(relativeBytes.length));
    hash.update(length).update(relativeBytes);
    length.writeBigUInt64BE(BigInt(contents.length));
    hash.update(length).update(contents);
  }
  const buildId = `frontend-${hash.digest("hex").slice(0, 16)}`;
  const outputPath = path.join(root, "runtime", "frontend-version.js");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `export const FRONTEND_BUILD_ID = "${buildId}";\n`);
  return { buildId, outputPath };
}

function parseFrontendRoot(args) {
  const index = args.indexOf("--frontend-root");
  if (index < 0 || !args[index + 1]) {
    return path.resolve(scriptDirectory, "../frontend");
  }
  return path.resolve(args[index + 1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await writeFrontendVersion({ frontendRoot: parseFrontendRoot(process.argv.slice(2)) });
    process.stdout.write(`${result.buildId}\n`);
  } catch (error) {
    process.stderr.write(`Failed to publish frontend version: ${error.message}\n`);
    process.exitCode = 1;
  }
}
