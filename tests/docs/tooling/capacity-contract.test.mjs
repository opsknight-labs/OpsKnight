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

test('deployment planning profiles are generated from current fixture source', () => {
  assert.equal(contract.planningProfilesSource, 'tests/load/fixtures/users/index.ts');
  assert.deepEqual(contract.planningProfiles, [
    { profile: 'small', teams: 4, users: 40, services: 12, integrationsPerService: 2, schedules: 8, escalationPolicies: 8, baselineIncidents: 24, statusPageSubscribers: 1000, sseSessions: 100, apiKeys: 12 },
    { profile: 'medium', teams: 8, users: 120, services: 32, integrationsPerService: 4, schedules: 16, escalationPolicies: 16, baselineIncidents: 100, statusPageSubscribers: 10000, sseSessions: 500, apiKeys: 32 },
    { profile: 'large', teams: 12, users: 400, services: 80, integrationsPerService: 5, schedules: 32, escalationPolicies: 32, baselineIncidents: 300, statusPageSubscribers: 100000, sseSessions: 2500, apiKeys: 64 },
    { profile: 'storm', teams: 20, users: 1000, services: 200, integrationsPerService: 5, schedules: 50, escalationPolicies: 50, baselineIncidents: 500, statusPageSubscribers: 100000, sseSessions: 5000, apiKeys: 100 },
  ]);

  const planner = readFileSync('docs/v2.0.0/operate/capacity/choose-deployment.md', 'utf8');
  const loadReadme = readFileSync('tests/load/README.md', 'utf8');
  for (const profile of contract.planningProfiles) {
    const name = `${profile.profile[0].toUpperCase()}${profile.profile.slice(1)}`;
    assert.match(planner, new RegExp(`\\| ${name} \\| ${profile.users.toLocaleString('en-US')} \\| ${profile.services}`));
    assert.ok(loadReadme.includes(`| \`${profile.profile}\` | ${profile.teams.toLocaleString('en-US')} | ${profile.users.toLocaleString('en-US')} | ${profile.services}`));
  }
});
