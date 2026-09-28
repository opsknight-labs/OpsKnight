const areaPatterns = [
  ['notification', /notification|provider|delivery|attempt|endpoint/i],
  ['incident', /incident|alert|event/i],
  ['on-call', /schedule|oncall|override|rotation/i],
  ['escalation', /escalation|policy/i],
  ['status-page', /status.?page|subscriber|announcement|uptime/i],
  ['chatops', /slack|microsoft.?teams|war.?room|meeting/i],
  ['identity', /auth|oidc|scim|session|user|invite|password/i],
  ['authorization', /permission|role|authorization|rbac/i],
  ['compliance', /compliance|control|framework|drift|evidence/i],
  ['privacy', /privacy|retention|erasure|subject/i],
  ['analytics', /analytic|report|metric|rollup|sla|objective/i],
  ['integration', /integration|webhook|jira/i],
  ['deployment', /deploy|runtime|worker|queue|scheduler|health/i],
];

const ownerFor = value => areaPatterns.find(([, pattern]) => pattern.test(value))?.[0] ?? 'platform';

function apiClassification(route) {
  if (/^\/api\/(?:events|incidents(?:\/\[id\])?)$/.test(route)) return 'PUBLIC_API';
  if (/^\/api\/(?:integrations|webhooks|scim)\//.test(route)) return 'PUBLIC_API';
  if (/^\/api\/(?:health|metrics)(?:\/|$)/.test(route)) return 'OPERATOR_FEATURE';
  if (/^\/api\/(?:status(?:\/|$)|status-page\/subscribe)/.test(route)) return 'PUBLIC_FEATURE';
  return 'INTERNAL_IMPLEMENTATION';
}

function uiClassification(route) {
  if (/^\/(?:login|forgot-password|reset-password|status)(?:\/|$)/.test(route) || route === '/') return 'PUBLIC_FEATURE';
  if (/^\/(?:settings|admin|users|teams|compliance)(?:\/|$)/.test(route)) return 'ADMIN_FEATURE';
  return 'PUBLIC_FEATURE';
}

export function buildFeatureGraph(discovery) {
  const nodes = [];
  const add = (kind, id, classification, owner, sources, contract = {}) => {
    const nodeId = `${kind}:${id}`;
    const evidence = [...new Set(sources)].sort();
    const claims = [{
      id: `${nodeId}:classification`,
      text: `${id} is classified as ${classification} and owned by ${owner}.`,
      evidence,
      verification: 'source',
    }];
    if (kind === 'api' && contract.methods?.length) claims.push({
      id: `${nodeId}:methods`,
      text: `${id} implements ${contract.methods.join(', ')}.`,
      evidence,
      verification: 'source',
    });
    if (kind === 'limit') claims.push({
      id: `${nodeId}:value`,
      text: `${contract.name} has the discovered numeric value ${contract.value}.`,
      evidence,
      verification: 'source',
    });
    nodes.push({
    id: nodeId,
    kind,
    name: id,
    owner,
    classification,
    sources: evidence,
    contract,
    claims,
  });
  };

  for (const route of discovery.apiRoutes) add('api', route.route, apiClassification(route.route), ownerFor(route.route), [route.file], route);
  for (const route of discovery.uiRoutes) add('ui', route.route, uiClassification(route.route), ownerFor(route.route), [route.file], route);
  for (const model of discovery.database.models) add('model', model, 'INTERNAL_IMPLEMENTATION', ownerFor(model), [discovery.database.source]);
  for (const value of discovery.database.enums) add('enum', value, 'INTERNAL_IMPLEMENTATION', ownerFor(value), [discovery.database.source]);
  for (const item of discovery.configuration) add('configuration', item.name, item.secret ? 'OPERATOR_FEATURE' : 'OPERATOR_FEATURE', ownerFor(item.name), item.sources, item);
  for (const item of discovery.integrations) add('integration', item.provider, 'PUBLIC_FEATURE', 'integration', item.sources, item);
  for (const item of discovery.notificationProviders) add('notification-provider', item.id, 'ADMIN_FEATURE', 'notification', [item.source], item);
  for (const action of discovery.permissions.capabilities) add('permission', action, 'ADMIN_FEATURE', ownerFor(action), [discovery.permissions.source]);
  for (const action of discovery.permissions.actions) add('authorization-action', action, 'ADMIN_FEATURE', ownerFor(action), [discovery.permissions.policySource]);
  for (const scope of discovery.permissions.apiScopes) add('api-scope', scope, 'PUBLIC_API', ownerFor(scope), [discovery.permissions.source]);
  for (const lane of discovery.runtime.workerLanes) add('worker-lane', lane, 'OPERATOR_FEATURE', 'deployment', ['src/lib/job-worker.ts']);
  for (const role of discovery.deployment.runtimeRoles) add('runtime-role', role.name, 'OPERATOR_FEATURE', 'deployment', role.sources);
  for (const topology of discovery.deployment.topologies) add('deployment-topology', topology.name, 'OPERATOR_FEATURE', 'deployment', topology.files);
  for (const limit of discovery.limits) add('limit', limit.id, 'OPERATOR_FEATURE', ownerFor(limit.source), [limit.source], limit);

  const duplicateIds = [...new Set(nodes.filter((node, index) => nodes.findIndex(candidate => candidate.id === node.id) !== index).map(node => node.id))];
  const unclassified = nodes.filter(node => !node.classification || !node.owner || node.sources.length === 0).map(node => node.id);
  const byKind = Object.fromEntries([...new Set(nodes.map(node => node.kind))].sort().map(kind => [kind, nodes.filter(node => node.kind === kind).length]));
  const byClassification = Object.fromEntries([...new Set(nodes.map(node => node.classification))].sort().map(value => [value, nodes.filter(node => node.classification === value).length]));
  const claims = nodes.flatMap(node => node.claims);
  const unsupportedClaims = claims.filter(claim => claim.evidence.length === 0);
  return {
    schemaVersion: 1,
    nodes,
    summary: {
      total: nodes.length,
      claims: claims.length,
      unsupportedClaims: unsupportedClaims.length,
      byKind,
      byClassification,
      unclassified: unclassified.length,
    },
    unclassified,
    duplicateIds,
    unsupportedClaims: unsupportedClaims.map(claim => claim.id),
  };
}
