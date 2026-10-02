#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, repositoryRoot } from './discovery-lib.mjs';

const sourceFiles = filesUnder('docs/v1.5', file => file.endsWith('.md'));
const topics = [];
for (const source of sourceFiles) {
  const body = readFileSync(resolve(repositoryRoot, source), 'utf8');
  const headings = [...body.matchAll(/^(#{1,4})\s+(.+)$/gm)]
    .map(match => ({ level: match[1].length, title: match[2].replace(/[`*_]/g, '').trim() }));
  for (const [index, heading] of headings.entries()) {
    topics.push({
      id: `${source.replace(/^docs\/v1\.5\//, '').replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '_')}_${index + 1}`.toLowerCase(),
      source,
      level: heading.level,
      topic: heading.title,
    });
  }
}

const inventory = {
  schemaVersion: 1,
  purpose: 'Generated topic inventory only. It makes no claim that a topic was ported or reviewed.',
  sourceDigest: createHash('sha256')
    .update(sourceFiles.map(file => `${file}\0${readFileSync(resolve(repositoryRoot, file), 'utf8')}`).join('\0'))
    .digest('hex'),
  topics,
};
const inventoryPath = resolve(repositoryRoot, 'docs/internal/certification/v1.5-topic-inventory.yaml');
mkdirSync(dirname(inventoryPath), { recursive: true });
writeFileSync(inventoryPath, YAML.stringify(inventory, { lineWidth: 0 }));

const report = `# v1.5 knowledge inventory\n\nThe generated inventory contains ${topics.length} historical headings from ${sourceFiles.length} v1.5 pages. Historical headings are not release obligations. Release parity is calculated automatically by intersecting exact legacy configuration, route, and integration contracts with current product source and requiring every still-supported contract to map into the v2 documentation or generated contract set. See \`v15-active-parity.json\`.\n`;
writeFileSync(resolve(repositoryRoot, 'generated/docs-certification/v15-parity-report.md'), report);
console.log(`Generated ${topics.length} historical v1.5 topic inventory entries.`);
