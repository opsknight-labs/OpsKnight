#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const input = resolve(root, 'artifacts/load-certification/certification-summary.json');
const contractPath = resolve(root, 'generated/docs-contracts/capacity.json');
const pagePath = resolve(root, 'docs/v2.0.0/operate/capacity/benchmark-results.md');
const sourceRevision = 'e2cd6e280';
const raw = JSON.parse(readFileSync(input, 'utf8'));

const records = raw.map(item => {
  const scenarios = item.scenarios || [];
  const status = item.certified === true ? 'CERTIFIED' : item.certified === false ? 'NOT CERTIFIED' : scenarios.length ? 'MEASURED' : 'NOT TESTED';
  return {
    topologyId: item.topologyId,
    topologyName: item.topologyName,
    status,
    phase: item.phase,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    testedLoadLevels: [...new Set(scenarios.map(scenario => scenario.loadLevel))],
    scenarioCount: scenarios.length,
    passedScenarios: scenarios.filter(scenario => scenario.thresholdsPassed).length,
    measuredPeakRps: scenarios.length ? Math.max(...scenarios.map(scenario => scenario.rps || 0)) : null,
    measuredWorstP95Ms: scenarios.length ? Math.max(...scenarios.map(scenario => scenario.p95Ms || 0)) : null,
    peakActivePgConnections: item.peakActivePgConnections ?? null,
    peakOldestPendingJobAgeMs: item.peakOldestPendingJobAgeMs ?? null,
    invariantsPassed: item.verification?.passed === true,
    certifiedCapacity: item.certified === true ? { note: 'See the passing certification artifact for the certified envelope.' } : null,
  };
});

const contract = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    path: 'artifacts/load-certification/certification-summary.json',
    pullRequest: 777,
    sourceRevision,
  },
  statusDefinitions: {
    CERTIFIED: 'All required scenarios, thresholds, and correctness invariants passed for the stated profile.',
    MEASURED: 'Measurements exist, but the record does not declare a certification result.',
    'NOT CERTIFIED': 'The topology was tested but did not pass the complete certification contract.',
    'NOT TESTED': 'No benchmark artifact exists for the topology.',
  },
  topologies: records,
};

mkdirSync(dirname(contractPath), { recursive: true });
writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

const rows = records.map(item => `| \`${item.topologyId}\` | ${item.testedLoadLevels.join(', ') || '—'} | ${item.passedScenarios}/${item.scenarioCount} | ${item.invariantsPassed ? 'Passed' : 'Failed'} | **${item.status}** |`).join('\n');
const page = `---
title: Capacity benchmark results
description: Evidence-derived load measurements and certification status for supported deployment topologies.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [capacity benchmark, load test, certified capacity, alerts per second, deployment sizing]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [artifacts/load-certification/certification-summary.json, generated/docs-contracts/capacity.json]
---

# Capacity benchmark results

These results are generated from the PR #777 certification artifact. They are
measurements from one test profile, not universal production guarantees.

> **Capacity status:** Every tested topology in this artifact is **NOT CERTIFIED**.
> Some individual scenarios or correctness invariants passed, but no topology
> passed the complete suite. OpsKnight therefore publishes no certified alert,
> notification, user, SSE, or status-fanout envelope from this run.

## Certification summary

| Topology | Load levels | Scenarios passing | Invariants | Capacity status |
|---|---:|---:|---:|---|
${rows}

## Provenance

- Artifact: \`artifacts/load-certification/certification-summary.json\`
- Pull request: #777
- Source revision: \`${sourceRevision}\`
- Test window: ${records[0]?.startedAt || 'unknown'} through ${records.at(-1)?.completedAt || 'unknown'}
- Host profile: 10-core CPU, 16 GB RAM; Docker Engine 28.x; Kind v0.31.0
- Tested level: ${[...new Set(records.flatMap(item => item.testedLoadLevels))].join(', ') || 'unknown'}
- Database and runtime profiles: recorded in the source certification report and
  topology definitions; do not transpose these measurements to a different pool,
  replica, host, or provider configuration.

## How to use these results

Use the failures to choose what to observe and scale, not as sizing promises.
See [Scaling signals](./scaling-signals/) and [Certification methodology](./certification-methodology/).
Numeric production guidance will be published only after a topology reaches
**CERTIFIED** status.
`;
mkdirSync(dirname(pagePath), { recursive: true });
writeFileSync(pagePath, page);
console.log(`Generated ${records.length} capacity records from PR #777 evidence.`);
