import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { evaluateEnrichment as before } from './helpers/enrichment-baseline';
import { evaluateEnrichment as candidate } from '../../src/lib/automation/evaluator/enrich';
const results = [];
for (const [fieldCount, ruleCount, actionCount] of [
  [4, 4, 1],
  [64, 100, 8],
]) {
  const fields = Array.from({ length: fieldCount }, (_, i) => ({
    fieldId: `field-${i}`,
    key: `field_${i}`,
    label: `Field ${i}`,
    type: 'NUMBER' as const,
    caseSensitive: false,
    aliases: {},
    mappings: [],
  }));
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    id: `rule-${i}`,
    name: `Rule ${i}`,
    phase: 'ENRICH' as const,
    enabled: true,
    conditions: [],
    actions: Array.from({ length: actionCount }, (_, a) => ({
      type: 'SET_CONTEXT' as const,
      fieldKey: `field_${(i + a) % fieldCount}`,
      value: i + a,
    })),
  }));
  const version = { schemaVersion: 1 as const, fields, rules };
  if (
    JSON.stringify(before(version, {}, () => {})) !==
    JSON.stringify(candidate(version, {}, () => {}))
  )
    throw Error('Semantic mismatch');
  for (let i = 0; i < 1000; i++) {
    before(version, {}, () => {});
    candidate(version, {}, () => {});
  }
  const samples = { before: [] as number[], candidate: [] as number[] };
  for (let repetition = 0; repetition < 10; repetition++) {
    for (const name of repetition % 2 ? ['candidate', 'before'] : ['before', 'candidate']) {
      const fn = name === 'before' ? before : candidate;
      const started = performance.now();
      for (let i = 0; i < 1000; i++) fn(version, {}, () => {});
      samples[name as keyof typeof samples].push((performance.now() - started) / 1000);
    }
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  results.push({
    fieldCount,
    ruleCount,
    actionCount,
    iterationsPerSample: 1000,
    samples,
    medianBeforeMs: median(samples.before),
    medianCandidateMs: median(samples.candidate),
  });
}
const report = {
  scope:
    'Whole enrichment evaluation; isolated no-op deadline guard, not HTTP capacity certification',
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  sourceRevision: process.env.AUTOMATION_BENCHMARK_SOURCE_REVISION ?? null,
  results,
};
writeFileSync(
  process.env.AUTOMATION_BENCHMARK_OUTPUT ?? 'docs/automation/enrichment-benchmark-results.json',
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report));
