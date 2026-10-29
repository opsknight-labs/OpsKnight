import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFeatureGraph } from '../../../scripts/docs/build-feature-graph.mjs';

const fixture = {
  apiRoutes: [{ route: '/api/events', file: 'src/app/api/events/route.ts', methods: ['POST'] }],
  uiRoutes: [{ route: '/incidents', file: 'src/app/(app)/incidents/page.tsx' }],
  database: { source: 'prisma/schema.prisma', models: ['Incident'], enums: ['IncidentStatus'] },
  configuration: [{ name: 'DATABASE_URL', secret: true, sources: ['src/lib/prisma.ts'] }],
  integrations: [{ provider: 'datadog', sources: ['src/lib/integrations/datadog.ts'] }],
  notificationProviders: [{ id: 'email.smtp', source: 'src/lib/notification-providers.ts' }],
  permissions: {
    capabilities: ['incident.read.all'],
    actions: ['incident.read'],
    apiScopes: ['incidents:read'],
    source: 'src/lib/authorization.ts',
    policySource: 'src/lib/authorization-policy.ts',
  },
  runtime: { workerLanes: ['critical'] },
  deployment: {
    runtimeRoles: [{ name: 'web', sources: ['deploy/compose/compose.yml'] }],
    topologies: [{ name: 'compose', files: ['deploy/compose/compose.yml'] }],
  },
  limits: [{ id: 'src/app/api/events/route.ts:RATE_LIMIT_MAX', source: 'src/app/api/events/route.ts' }],
};

describe('granular documentation feature graph', () => {
  it('classifies every discovered surface with ownership and provenance', () => {
    const graph = buildFeatureGraph(fixture);
    assert.equal(graph.unclassified.length, 0);
    assert.equal(graph.duplicateIds.length, 0);
    assert.equal(graph.nodes.find(node => node.id === 'api:/api/events')?.classification, 'PUBLIC_API');
    assert.ok(graph.nodes.every(node => node.owner && node.sources.length > 0));
  });
});
