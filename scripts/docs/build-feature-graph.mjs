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

const catalog = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const documentationGroups = ['concepts', 'guides', 'reference', 'troubleshooting'];
const normalizeSource = value => value.replace(/\/$/, '');
const overlaps = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const documentationIndex = filesUnder('docs/v2.0.0', file => file.endsWith('.md')).flatMap(file => {
  const header = readRepositoryFile(file).match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!header) return [];
  const metadata = YAML.parse(header);
  return [{ path: file.replace('docs/v2.0.0/', ''), type: metadata.type, area: metadata.product_area }];
});

// UI coverage is intentionally route-specific. A broad product-area fallback made
// unrelated pages (for example deployment guides for /settings/api-keys) count as
// proof. Keep these rules ordered from specific to general and fail certification
// when a newly discovered UI route has no deliberate mapping.
const uiDocumentationRules = [
  [/^\/action-items$/, ['guides/incidents/action-items.md']],
  [/^\/(?:analytics|reports(?:\/.*)?)$/, ['concepts/analytics.md', 'reference/metrics.md']],
  [/^\/audit$/, ['guides/administration/audit-logs.md']],
  [/^\/events(?:\/test)?$/, ['reference/api/events.md', 'integrations/README.md']],
  [/^\/help$/, ['README.md', 'guides/README.md']],
  [/^\/$/, ['start/what-is-opsknight.md', 'start/README.md']],
  [/^\/incidents\/templates(?:\/create)?$/, ['guides/incidents/incident-templates.md']],
  [/^\/incidents\/create$/, ['guides/incidents/create.md']],
  [/^\/incidents(?:\/\[id\])?$/, ['concepts/incidents.md', 'concepts/incident-response.md', 'guides/incidents/acknowledge.md']],
  [/^\/policies(?:\/.*)?$/, ['concepts/escalation-policies.md', 'guides/escalation/configure-policy.md']],
  [/^\/postmortems(?:\/.*)?$/, ['concepts/postmortems.md', 'concepts/postmortem-workflow.md', 'guides/incidents/action-items.md']],
  [/^\/schedules(?:\/.*)?$/, ['concepts/schedules.md', 'guides/on-call/build-schedule.md', 'guides/on-call/overrides.md']],
  [/^\/services\/\[id\]\/integrations$/, ['concepts/services.md', 'integrations/README.md']],
  [/^\/services\/\[id\]\/notifications$/, ['concepts/services.md', 'guides/notifications/configure-routing.md']],
  [/^\/services\/\[id\]\/webhooks\/(?:new|\[webhookId\]\/edit)$/, ['concepts/services.md', 'integrations/webhooks/webhook.md']],
  [/^\/services(?:\/\[id\](?:\/settings)?)?$/, ['concepts/services.md', 'concepts/teams.md']],
  [/^\/settings\/api-keys$/, ['guides/administration/api-keys.md']],
  [/^\/settings\/chatops\/link$/, ['integrations/communication/slack/user-identity-linking.md']],
  [/^\/settings\/custom-fields$/, ['guides/administration/custom-fields.md']],
  [/^\/settings\/incident-sla$/, ['concepts/incident-sla.md']],
  [/^\/settings\/integrations\/microsoft-teams$/, ['integrations/communication/microsoft-teams/README.md', 'integrations/communication/microsoft-teams/connect.md']],
  [/^\/settings\/integrations\/slack$/, ['integrations/communication/slack/README.md', 'integrations/communication/slack/connect-with-oauth.md']],
  [/^\/settings\/integrations\/jira$/, ['integrations/issue-tracking/jira/README.md', 'integrations/issue-tracking/jira/connect.md']],
  [/^\/settings\/integrations\/chatops$/, ['concepts/chatops.md', 'guides/chatops/create-war-room.md']],
  [/^\/settings\/integrations$/, ['integrations/README.md']],
  [/^\/settings\/notifications\/history$/, ['guides/notifications/inspect-delivery.md']],
  [/^\/settings\/notifications\/operations$/, ['guides/notifications/inspect-delivery.md', 'concepts/notifications.md']],
  [/^\/settings\/notifications$/, ['guides/notifications/configure-routing.md', 'concepts/notifications.md']],
  [/^\/settings\/privacy-requests$/, ['concepts/privacy.md']],
  [/^\/settings\/profile$/, ['concepts/authentication.md', 'guides/administration/manage-users.md']],
  [/^\/settings\/security-compliance$/, ['concepts/compliance.md', 'operate/security/hardening.md']],
  [/^\/settings\/security$/, ['concepts/authentication.md', 'operate/security/hardening.md']],
  [/^\/settings\/service-objectives$/, ['concepts/analytics.md']],
  [/^\/settings\/status-page$/, ['concepts/status-pages.md', 'guides/status-pages/publish-update.md']],
  [/^\/settings\/status-pages(?:\/\[pageId\])?$/, ['concepts/status-pages.md', 'guides/status-pages/publish-update.md']],
  [/^\/settings\/system\/health$/, ['operate/reliability/health-center.md', 'reference/health.md']],
  [/^\/settings\/system\/performance$/, ['operate/reliability/scaling.md', 'operate/capacity/scaling-signals.md']],
  [/^\/settings\/system$/, ['operate/reliability/health-and-metrics.md', 'reference/configuration/README.md']],
  [/^\/settings$/, ['reference/configuration/README.md', 'guides/administration/manage-permissions.md']],
  [/^\/shortcuts$/, ['reference/features.md']],
  [/^\/system-logs$/, ['operate/reliability/system-logs.md']],
  [/^\/teams(?:\/\[id\])?$/, ['concepts/teams.md', 'concepts/services.md']],
  [/^\/users(?:\/\[id\])?$/, ['guides/administration/manage-users.md', 'concepts/permissions.md']],
  [/^\/m\/analytics$/, ['concepts/mobile.md', 'concepts/analytics.md']],
  [/^\/m\/incidents\/create$/, ['concepts/mobile.md', 'guides/incidents/create.md']],
  [/^\/m\/incidents(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/incidents.md']],
  [/^\/m\/policies(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/escalation-policies.md']],
  [/^\/m\/postmortems(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/postmortems.md']],
  [/^\/m\/schedules(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/schedules.md']],
  [/^\/m\/services(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/services.md']],
  [/^\/m\/status$/, ['concepts/mobile.md', 'concepts/status-pages.md']],
  [/^\/m\/teams(?:\/\[id\])?$/, ['concepts/mobile.md', 'concepts/teams.md']],
  [/^\/m\/users(?:\/\[id\])?$/, ['concepts/mobile.md', 'guides/administration/manage-users.md']],
  [/^\/m\/notifications$/, ['concepts/mobile.md', 'concepts/notifications.md']],
  [/^\/m\/(?:help|more)$/, ['concepts/mobile.md']],
  [/^\/m$/, ['concepts/mobile.md']],
  [/^\/status(?:\/.*)?$/, ['concepts/status-pages.md', 'guides/status-pages/publish-update.md']],
  [/^\/(?:login|forgot-password|reset-password|set-password|auth\/signout)$/, ['concepts/authentication.md']],
  [/^\/m\/(?:login|forgot-password)$/, ['concepts/mobile.md', 'concepts/authentication.md']],
  [/^\/setup$/, ['start/quickstart.md', 'start/production-install.md']],
  [/^\/logs$/, ['operate/reliability/system-logs.md']],
  [/^\/clear-desktop-preference$/, ['concepts/mobile.md']],
  [/^\/debug-mobile$/, ['develop/local-development.md']],
];

function documentationBuckets(paths) {
  const documentation = Object.fromEntries(documentationGroups.map(group => [group, []]));
  for (const path of paths) {
    const page = documentationIndex.find(candidate => candidate.path === path);
    if (!page) continue;
    if (page.type === 'concept') documentation.concepts.push(path);
    else if (page.type === 'troubleshooting') documentation.troubleshooting.push(path);
    else if (page.type === 'reference') documentation.reference.push(path);
    else documentation.guides.push(path);
  }
  return documentation;
}

function uiDocumentation(route) {
  const match = uiDocumentationRules.find(([pattern]) => pattern.test(route));
  return match ? documentationBuckets(match[1]) : null;
}

function documentationFor(kind, id, sources, owner) {
  if (kind === 'ui') {
    return uiDocumentation(id) ?? Object.fromEntries(documentationGroups.map(group => [group, []]));
  }
  let matched = Object.values(catalog.capabilities ?? {}).filter(capability =>
    (capability.sources ?? []).some(pattern => sources.some(source => overlaps(normalizeSource(source), normalizeSource(pattern))))
  );
  const documentation = Object.fromEntries(documentationGroups.map(group => [group, [...new Set(matched.flatMap(item => item[group] ?? []))]]));
  const areaAliases = {
    incident: ['incidents'], notification: ['notifications'], 'on-call': ['on-call'], escalation: ['escalation'],
    'status-page': ['status-pages'], chatops: ['chatops'], identity: ['identity'], authorization: ['authorization'],
    compliance: ['compliance'], privacy: ['privacy'], analytics: ['analytics'], integration: ['integrations', 'jira'],
    deployment: ['deployment', 'observability'], platform: ['getting-started', 'mobile'],
  };
  for (const page of documentationIndex.filter(page => (areaAliases[owner] ?? []).includes(page.area))) {
    if (page.type === 'troubleshooting') documentation.troubleshooting.push(page.path);
  }
  if (kind === 'configuration') documentation.reference.push('reference/configuration/README.md');
  if (kind === 'limit') documentation.reference.push('reference/limits.md');
  if (['permission', 'authorization-action', 'api-scope'].includes(kind)) documentation.reference.push('reference/permissions.md');
  if (kind === 'api') documentation.reference.push('reference/api/README.md');
  if (kind === 'integration') {
    const entry = `integrations/${id === 'webhook' ? 'webhooks' : id === 'pagerduty' ? 'webhooks' : 'monitoring'}/${id}.md`;
    if (exists(`docs/v2.0.0/${entry}`)) documentation.reference.push(entry);
    documentation.reference.push('integrations/README.md');
  }
  if (kind === 'notification-provider') documentation.concepts.push('concepts/notifications.md');
  return Object.fromEntries(Object.entries(documentation).map(([group, paths]) => [group, [...new Set(paths)].sort()]));
}

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
    const documentation = documentationFor(kind, id, evidence, owner);
    nodes.push({
    id: nodeId,
    kind,
    name: id,
    owner,
    classification,
    sources: evidence,
    contract,
    documentation,
    documentationMapping: kind === 'ui' ? (uiDocumentation(id) ? 'explicit-route-rule' : 'unmapped') : 'capability-source',
    tests: [...new Set(Object.values(catalog.capabilities ?? {}).filter(capability =>
      (capability.sources ?? []).some(pattern => evidence.some(source => overlaps(normalizeSource(source), normalizeSource(pattern))))
    ).flatMap(capability => capability.tests ?? []))].sort(),
    runtimeEvidence: [...new Set(Object.values(catalog.capabilities ?? {}).filter(capability =>
      (capability.sources ?? []).some(pattern => evidence.some(source => overlaps(normalizeSource(source), normalizeSource(pattern))))
    ).flatMap(capability => capability.evidence ?? []))].sort(),
    introducedVersion: 'unknown',
    availability: 'unknown',
    claims,
  });
  };

  for (const route of discovery.apiRoutes) add('api', route.route, apiClassification(route.route), ownerFor(route.route), route.sources ?? [route.file], route);
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
  for (const limit of discovery.limits) add('limit', limit.id,
    limit.semanticClassification === 'INTERNAL_IMPLEMENTATION' || limit.semanticClassification === 'PROVIDER_CONSTRAINT'
      ? 'INTERNAL_IMPLEMENTATION'
      : limit.semanticClassification === 'OPERATOR_TUNABLE' ? 'OPERATOR_FEATURE' : 'PUBLIC_FEATURE',
    ownerFor(limit.source), [limit.source], limit);

  const duplicateIds = [...new Set(nodes.filter((node, index) => nodes.findIndex(candidate => candidate.id === node.id) !== index).map(node => node.id))];
  const unclassified = nodes.filter(node => !node.classification || !node.owner || node.sources.length === 0).map(node => node.id);
  const byKind = Object.fromEntries([...new Set(nodes.map(node => node.kind))].sort().map(kind => [kind, nodes.filter(node => node.kind === kind).length]));
  const byClassification = Object.fromEntries([...new Set(nodes.map(node => node.classification))].sort().map(value => [value, nodes.filter(node => node.classification === value).length]));
  const claims = nodes.flatMap(node => node.claims);
  const unsupportedClaims = claims.filter(claim => claim.evidence.length === 0);
  const supported = nodes.filter(node => node.classification !== 'INTERNAL_IMPLEMENTATION');
  for (const node of supported) {
    node.relatedFeatures = supported
      .filter(candidate => candidate.id !== node.id && candidate.owner === node.owner)
      .slice(0, 12)
      .map(candidate => candidate.id);
  }
  const undocumented = supported.filter(node => !Object.values(node.documentation).some(paths => paths.length > 0));
  const uiRoutesWithoutExplicitDocumentation = supported
    .filter(node => node.kind === 'ui' && node.documentationMapping !== 'explicit-route-rule')
    .map(node => node.id);
  const unresolvedSemanticContracts = supported.filter(node =>
    node.kind === 'notification-provider' && (node.contract.enabledCondition === 'unknown' || node.contract.discovery !== 'implementation')
  );
  return {
    schemaVersion: 1,
    nodes,
    summary: {
      total: nodes.length,
      claims: claims.length,
      unsupportedClaims: unsupportedClaims.length,
      supported: supported.length,
      documentedSupported: supported.length - undocumented.length,
      undocumentedSupported: undocumented.length,
      unresolvedSemanticContracts: unresolvedSemanticContracts.length,
      uiRoutesWithoutExplicitDocumentation: uiRoutesWithoutExplicitDocumentation.length,
      byKind,
      byClassification,
      unclassified: unclassified.length,
    },
    unclassified,
    duplicateIds,
    unsupportedClaims: unsupportedClaims.map(claim => claim.id),
    undocumented: undocumented.map(node => node.id),
    uiRoutesWithoutExplicitDocumentation,
    unresolvedSemanticContracts: unresolvedSemanticContracts.map(node => node.id),
  };
}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';
