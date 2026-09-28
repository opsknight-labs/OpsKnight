#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const input = resolve(root, 'artifacts/load-certification/certification-summary.json');
const contractPath = resolve(root, 'generated/docs-contracts/capacity.json');
const pagePath = resolve(root, 'docs/v2.0.0/operate/capacity/benchmark-results.md');
const artifact = JSON.parse(readFileSync(input, 'utf8'));

if (!artifact.generatedAt || !artifact.sourceRevision || !artifact.testHarnessRevision || !artifact.environment || !Array.isArray(artifact.results)) {
  throw new Error('Capacity artifact must contain generatedAt, sourceRevision, testHarnessRevision, environment, and results.');
}

const supportedTopologies = [
  ['compose_integrated_bundled_db', 'Compose: Integrated Runtime + Bundled PostgreSQL'],
  ['compose_integrated_external_db', 'Compose: Integrated Runtime + External PostgreSQL'],
  ['compose_split_bundled_db', 'Compose: Split Runtime + Bundled PostgreSQL'],
  ['compose_split_pgbouncer', 'Compose: Split Runtime + PgBouncer + Bundled PostgreSQL'],
  ['compose_split_pgbouncer_external_db_ca', 'Compose: Split Runtime + PgBouncer + External PostgreSQL with CA'],
  ['swarm_single_node_split', 'Swarm: Single Node + Split Runtime'],
  ['swarm_ha_split', 'Swarm: Multi-node HA + Split Runtime'],
  ['kind_helm_split_pgbouncer', 'Kubernetes: Helm + Split Runtime + PgBouncer'],
  ['kind_kustomize_split_pgbouncer', 'Kubernetes: Kustomize + Split Runtime + PgBouncer'],
];

const evidenceByTopology = new Map(artifact.results.map(item => [item.topologyId, item]));
const supportedIds = new Set(supportedTopologies.map(([id]) => id));
const unknownTopologies = artifact.results.filter(item => !supportedIds.has(item.topologyId));
if (unknownTopologies.length) throw new Error(`Capacity artifact contains unsupported topologies: ${unknownTopologies.map(item => item.topologyId).join(', ')}`);

const records = supportedTopologies.map(([topologyId, topologyName]) => {
  const item = evidenceByTopology.get(topologyId);
  if (!item) return {
    topologyId, topologyName, status: 'NOT TESTED', phase: null,
    startedAt: null, completedAt: null, testedLoadLevels: [], scenarioCount: 0,
    passedScenarios: 0, measuredPeakRps: null, measuredWorstP95Ms: null,
    peakActivePgConnections: null, peakOldestPendingJobAgeMs: null,
    invariantsPassed: null, certifiedCapacity: null,
  };

  const scenarios = item.scenarios || [];
  const status = item.certified === true ? 'CERTIFIED' : item.certified === false ? 'NOT CERTIFIED' : scenarios.length ? 'MEASURED' : 'NOT TESTED';
  const measuredPeakRps = scenarios.length ? Math.max(...scenarios.map(scenario => scenario.rps || 0)) : null;
  const measuredWorstP95Ms = scenarios.length ? Math.max(...scenarios.map(scenario => scenario.p95Ms || 0)) : null;
  const testedLoadLevels = [...new Set(scenarios.map(scenario => scenario.loadLevel))];
  return {
    topologyId, topologyName: item.topologyName || topologyName, status,
    phase: item.phase ?? null, startedAt: item.startedAt ?? null,
    completedAt: item.completedAt ?? null, testedLoadLevels,
    scenarioCount: scenarios.length,
    passedScenarios: scenarios.filter(scenario => scenario.thresholdsPassed).length,
    measuredPeakRps, measuredWorstP95Ms,
    peakActivePgConnections: item.peakActivePgConnections ?? null,
    peakOldestPendingJobAgeMs: item.peakOldestPendingJobAgeMs ?? null,
    invariantsPassed: item.verification?.passed === true,
    certifiedCapacity: item.certified === true ? { testedLoadLevels, measuredPeakRps, measuredWorstP95Ms } : null,
  };
});

const contract = {
  schemaVersion: 1,
  generatedAt: artifact.generatedAt,
  source: {
    path: 'artifacts/load-certification/certification-summary.json', pullRequest: 777,
    artifactGeneratedAt: artifact.generatedAt, sourceRevision: artifact.sourceRevision,
    testHarnessRevision: artifact.testHarnessRevision, environment: artifact.environment,
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

const rows = records.map(item => `| \`${item.topologyId}\` | ${item.testedLoadLevels.join(', ') || '—'} | ${item.scenarioCount ? `${item.passedScenarios}/${item.scenarioCount}` : '—'} | ${item.invariantsPassed === null ? '—' : item.invariantsPassed ? 'Passed' : 'Failed'} | **${item.status}** |`).join('\n');
const testedRecords = records.filter(item => item.startedAt || item.completedAt);
const testStart = testedRecords.map(item => item.startedAt).filter(Boolean).sort()[0] || 'unknown';
const testEnd = testedRecords.map(item => item.completedAt).filter(Boolean).sort().at(-1) || 'unknown';
const testedLevels = [...new Set(records.flatMap(item => item.testedLoadLevels))].join(', ') || 'unknown';
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
> Two supported variants were **NOT TESTED**. Some individual scenarios or
> correctness invariants passed, but no topology passed the complete suite.
> OpsKnight therefore publishes no certified alert, notification, user, SSE,
> or status-fanout envelope from this run.

## Certification summary

| Topology | Load levels | Scenarios passing | Invariants | Capacity status |
|---|---:|---:|---:|---|
${rows}

## Provenance

- Artifact: \`artifacts/load-certification/certification-summary.json\`
- Pull request: #777
- Artifact generated: ${artifact.generatedAt}
- Product source revision tested: \`${artifact.sourceRevision}\`
- Test harness revision recorded: \`${artifact.testHarnessRevision}\`
- Test window: ${testStart} through ${testEnd}
- Host profile: ${artifact.environment.cpu} CPU, ${artifact.environment.memory} RAM; Docker Engine ${artifact.environment.dockerEngine}; Kind ${artifact.environment.kind}
- Tested level: ${testedLevels}
- Database and runtime profiles: recorded in the source certification report and
  topology definitions; do not transpose these measurements to a different pool,
  replica, host, or provider configuration.

> The benchmark artifact was produced from product revision
> \`${artifact.sourceRevision}\`. The harness was later revised at
> \`${artifact.testHarnessRevision}\`, and the benchmark was not rerun after that
> harness change. The results remain historical evidence, not a certification of
> the later harness revision.

## How to use these results

Use the failures to choose what to observe and scale, not as sizing promises.
See [Scaling signals](./scaling-signals/) and [Certification methodology](./certification-methodology/).
Numeric production guidance will be published only after a topology reaches
**CERTIFIED** status.
`;
mkdirSync(dirname(pagePath), { recursive: true });
writeFileSync(pagePath, page);
console.log(`Generated ${records.length} supported capacity records from PR #777 evidence.`);
