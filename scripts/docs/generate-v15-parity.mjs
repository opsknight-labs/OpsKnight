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

const review = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/internal/certification/v1.5-to-v2-parity.yaml'), 'utf8'));
const inventoryIds = new Set(topics.map(topic => topic.id));
const reviewed = review.dispositions.filter(item => inventoryIds.has(item.id));
const counts = Object.fromEntries(['PORT', 'UPDATED', 'NO_LONGER_APPLICABLE', 'INTERNAL'].map(status => [status, reviewed.filter(item => item.status === status).length]));
const report = `# v1.5 to 2.0.0 knowledge review\n\nThis is a human-review tracker, not a documentation-completeness certificate. The generated inventory contains ${topics.length} headings from ${sourceFiles.length} v1.5 pages. A disposition is counted only after a reviewer checks current 2.0 code and records the destination or evidence manually.\n\n- Inventory topics: ${topics.length}\n- Manually reviewed: ${reviewed.length}\n${Object.entries(counts).map(([status, count]) => `- ${status}: ${count}`).join('\n')}\n- Awaiting human review: ${topics.length - reviewed.length}\n`;
writeFileSync(resolve(repositoryRoot, 'generated/docs-certification/v15-parity-report.md'), report);
console.log(`Generated ${topics.length} v1.5 topic inventory entries; ${reviewed.length} have manual dispositions.`);
