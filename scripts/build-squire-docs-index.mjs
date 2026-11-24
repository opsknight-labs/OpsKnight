#!/usr/bin/env node
/**
 * Builds the product-docs index Squire answers "how do I…" questions from.
 *
 *   node scripts/build-squire-docs-index.mjs [docs/v2.3.0]
 *
 * Reads the docs folder of the release in development (default: the newest docs/vX.Y.Z), keeps each
 * page's title, description and up to 400 characters per `##` section, and writes
 * src/lib/intelligence/squire/docs-index.json. Re-run after a docs change; `--check` exits 1 when the
 * committed index is out of date. Released (frozen) docs folders are never written.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = 'src/lib/intelligence/squire/docs-index.json';
const SKIP = new Set(['develop', 'assets']);
const SECTION_CHARS = 400;

async function newestDocs() {
  const versions = (await readdir('docs')).filter(name => /^v\d+\.\d+\.\d+$/.test(name));
  versions.sort((a, b) =>
    a
      .slice(1)
      .split('.')
      .map(Number)
      .reduce((order, part, index) => order || part - Number(b.slice(1).split('.')[index]), 0)
  );
  return path.join('docs', versions.at(-1));
}

async function* markdown(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

const plain = text =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: source };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^(title|description):\s*(.+)$/);
    if (field) meta[field[1]] = field[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

export async function buildIndex(root) {
  const pages = [];
  for await (const file of markdown(root)) {
    const { meta, body } = frontmatter(await readFile(file, 'utf8'));
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const slug = relative.replace(/(?:^|\/)README\.md$/, '').replace(/\.md$/, '');
    const url = `https://opsknight.com/docs/latest/${slug}${slug ? '/' : ''}`;
    const title = meta.title ?? plain(body.match(/^#\s+(.+)$/m)?.[1] ?? slug);
    const sections = [];
    for (const part of body.split(/^##\s+/m).slice(1)) {
      const newline = part.indexOf('\n');
      const heading = plain(newline < 0 ? part : part.slice(0, newline));
      const text = plain(newline < 0 ? '' : part.slice(newline)).slice(0, SECTION_CHARS);
      if (heading && text) sections.push({ heading, text });
    }
    const intro = plain(body.split(/^##\s+/m)[0].replace(/^#\s+.+$/m, '')).slice(0, SECTION_CHARS);
    pages.push({ title, description: meta.description ?? '', url, intro, sections });
  }
  pages.sort((a, b) => a.url.localeCompare(b.url));
  return { source: root.replace(/\\/g, '/'), pages };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = args.find(arg => !arg.startsWith('--')) ?? (await newestDocs());
  const json = `${JSON.stringify(await buildIndex(root))}\n`;
  if (check) {
    const current = existsSync(OUT) ? await readFile(OUT, 'utf8') : '';
    if (current !== json) {
      console.error(`${OUT} is out of date; run node scripts/build-squire-docs-index.mjs`);
      process.exit(1);
    }
  } else {
    await writeFile(OUT, json);
    console.log(`Wrote ${OUT} from ${root} (${(json.length / 1024).toFixed(0)} KB)`);
  }
}
