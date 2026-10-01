import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const artifact = JSON.parse(readFileSync('artifacts/load-certification/certification-summary.json', 'utf8'));
const contract = JSON.parse(readFileSync('generated/docs-contracts/capacity.json', 'utf8'));
const supportedTopologyIds = [
  'compose_integrated_bundled_db', 'compose_integrated_external_db',
  'compose_split_bundled_db', 'compose_split_pgbouncer',
  'compose_split_pgbouncer_external_db_ca', 'swarm_single_node_split',
  'swarm_ha_split', 'kind_helm_split_pgbouncer',
  'kind_kustomize_split_pgbouncer', 'phase6_compose_integrated',
  'phase6_compose_split', 'phase6_compose_split_pgbouncer',
  'phase6_swarm_integrated', 'phase6_swarm_split',
  'phase6_swarm_split_pgbouncer', 'phase6_swarm_ha_split_pgbouncer',
  'phase6_helm_integrated', 'phase6_helm_split',
  'phase6_helm_split_pgbouncer', 'phase6_kustomize_integrated',
  'phase6_kustomize_split', 'phase6_kustomize_split_pgbouncer',
];

test('capacity documentation remains evidence driven', () => {
  assert.equal(contract.source.path, 'artifacts/load-certification/certification-summary.json');
  assert.equal(contract.source.sourceRevision, artifact.sourceRevision);
  assert.equal(contract.source.testHarnessRevision, artifact.testHarnessRevision);
  assert.deepEqual(contract.topologies.map(topology => topology.topologyId), supportedTopologyIds);

  const evidenceByTopology = new Map(artifact.results.map(item => [item.topologyId, item]));
  for (const topology of contract.topologies) {
    const evidence = evidenceByTopology.get(topology.topologyId);
    const expectedStatus = !evidence ? 'NOT TESTED'
      : evidence.certified === true ? 'CERTIFIED'
        : evidence.certified === false ? 'NOT CERTIFIED'
          : evidence.scenarios?.length ? 'MEASURED' : 'NOT TESTED';
    assert.equal(topology.status, expectedStatus);
    if (topology.status === 'CERTIFIED') assert.ok(topology.certifiedCapacity);
    else assert.equal(topology.certifiedCapacity, null);
  }
});
