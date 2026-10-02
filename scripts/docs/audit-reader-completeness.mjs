#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, repositoryRoot } from './discovery-lib.mjs';

const order = ['MAPPED', 'READER_COMPLETE', 'SOURCE_VERIFIED', 'RUNTIME_VERIFIED'];
const taskTypes = new Set(['how-to', 'tutorial', 'deployment', 'integration', 'troubleshooting']);
const pages = filesUnder('docs/v2.0.0', file => file.endsWith('.md')).map(file => {
  const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const metadata = match ? YAML.parse(match[1]) : {};
  const body = match?.[2] ?? source;
  const status = metadata.reader?.status ?? 'MAPPED';
  const sourceVerified = ['source', 'test', 'runtime'].includes(metadata.verification?.level) &&
    (metadata.verification?.evidence?.length ?? 0) > 0;
  return {
    page: file.replace('docs/v2.0.0/', ''),
    type: metadata.type ?? null,
    userTask: metadata.reader?.task ?? null,
    status,
    taskPage: taskTypes.has(metadata.type),
    screenshotCount: [...body.matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length,
    screenshotAssessment: metadata.reader?.evidence?.some(item => /\.(?:png|jpe?g|webp)$/i.test(item)) ? 'EVIDENCED' : 'UNASSESSED',
    sourceVerified: sourceVerified || order.indexOf(status) >= order.indexOf('SOURCE_VERIFIED'),
    runtimeVerified: status === 'RUNTIME_VERIFIED',
  };
});

const counts = Object.fromEntries(order.map(status => [status, pages.filter(page => page.status === status).length]));
const report = {
  schemaVersion: 1,
  purpose: 'Reader-completeness audit. Mapping and source verification do not imply task usability.',
  counts,
  taskPages: pages.filter(page => page.taskPage).length,
  readerCompleteTaskPages: pages.filter(page => page.taskPage && order.indexOf(page.status) >= order.indexOf('READER_COMPLETE')).length,
  sourceVerifiedTaskPages: pages.filter(page => page.taskPage && page.sourceVerified).length,
  runtimeVerifiedTaskPages: pages.filter(page => page.taskPage && page.runtimeVerified).length,
  pages,
};

const destination = resolve(repositoryRoot, 'generated/docs-certification/page-audit.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Reader audit: ${pages.length} pages; ${report.readerCompleteTaskPages}/${report.taskPages} task pages reader-complete; ${report.sourceVerifiedTaskPages} source-verified; ${report.runtimeVerifiedTaskPages} runtime-verified.`);
