import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".sql", ".py", ".json"]);
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "outputs",
  ".dsh-filess",
  ".tmp",
  "local-data",
]);

let files = 0;
let bytes = 0;
let lines = 0;
const byExtension = {};

function isExcluded(relativePath, entryName) {
  if (excludedDirectories.has(entryName)) return true;
  return relativePath.replaceAll("\\", "/").startsWith("tools/vendor/");
}

function visit(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      if (!isExcluded(relativePath, entry.name)) visit(fullPath);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const extension = path.extname(entry.name).toLowerCase().slice(1);
    const content = fs.readFileSync(fullPath);
    files += 1;
    bytes += content.length;
    byExtension[extension] ??= { files: 0, bytes: 0, lines: 0 };
    byExtension[extension].files += 1;
    byExtension[extension].bytes += content.length;
    if (content.length > 0) {
      const text = content.toString("utf8");
      const fileLines = text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
      lines += fileLines;
      byExtension[extension].lines += fileLines;
    }
  }
}

visit(root);

const result = {
  files,
  bytes,
  mib: Number((bytes / 1024 / 1024).toFixed(2)),
  lines,
  scope: "js,mjs,cjs,html,css,sql,py,json",
  byExtension,
};

console.log(JSON.stringify(result, null, 2));
