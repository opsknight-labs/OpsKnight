#!/usr/bin/env node
/**
 * Fail if relative Markdown links in the selected documentation tree do not resolve.
 * Skips http(s), mailto, and in-page hashes.
 */
const fs = require("fs");
const path = require("path");

const requestedRoot = process.argv[2] || "docs/v2.0.0";
const ROOT = path.resolve(path.join(__dirname, ".."), requestedRoot);

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`Documentation root does not exist: ${requestedRoot}`);
  process.exit(1);
}
const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.mdx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function existsAsDoc(resolved) {
  const candidates = [
    resolved,
    `${resolved}.md`,
    `${resolved}.mdx`,
    path.join(resolved, "README.md"),
    path.join(resolved, "index.md"),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

const files = walk(ROOT);
const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  let match;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(text))) {
    let href = match[1].trim();
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    const bare = href.split(/\s+/)[0];
    if (!bare || bare.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) continue;
    // Website/public assets: /screenshot.png — not files in this tree
    if (bare.startsWith("/")) continue;
    const noHash = bare.split("#")[0].split("?")[0];
    if (!noHash) continue;
    const target = path.resolve(path.dirname(file), noHash);
    if (!existsAsDoc(target)) {
      failures.push(`${path.relative(process.cwd(), file)} → ${bare}`);
    }
  }
}

if (failures.length) {
  console.error(`Broken relative docs links (${failures.length}):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Checked ${files.length} files in ${path.relative(process.cwd(), ROOT)} — relative links resolve.`);
