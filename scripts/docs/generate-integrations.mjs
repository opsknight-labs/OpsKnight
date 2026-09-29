#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';
import { inspectApi } from './inspect-api.mjs';
import { inspectIntegrations } from './inspect-integrations.mjs';

const categories = {
  monitoring: ['appdynamics', 'datadog', 'dynatrace', 'elastic', 'grafana', 'honeycomb', 'icinga', 'manageengine', 'nagios', 'newrelic', 'prometheus', 'sentry', 'splunk-observability', 'splunk-oncall', 'zabbix'],
  cloud: ['azure', 'cloudwatch', 'google-cloud-monitoring'],
  uptime: ['better-uptime', 'pingdom', 'uptime-kuma', 'uptimerobot'],
  webhooks: ['bitbucket', 'github', 'gitlab', 'pagerduty', 'vercel', 'webhook'],
};
const displayNames = {
  appdynamics: 'AppDynamics', datadog: 'Datadog', dynatrace: 'Dynatrace', elastic: 'Elastic',
  grafana: 'Grafana', honeycomb: 'Honeycomb', icinga: 'Icinga', manageengine: 'ManageEngine',
  nagios: 'Nagios', newrelic: 'New Relic', prometheus: 'Prometheus Alertmanager', sentry: 'Sentry',
  'splunk-observability': 'Splunk Observability', 'splunk-oncall': 'Splunk On-Call', zabbix: 'Zabbix',
  azure: 'Azure Monitor', cloudwatch: 'Amazon CloudWatch', 'google-cloud-monitoring': 'Google Cloud Monitoring',
  'better-uptime': 'Better Uptime', pingdom: 'Pingdom', 'uptime-kuma': 'Uptime Kuma', uptimerobot: 'UptimeRobot',
  bitbucket: 'Bitbucket', github: 'GitHub', gitlab: 'GitLab', pagerduty: 'PagerDuty Events API',
  vercel: 'Vercel', webhook: 'Generic webhook',
};

const categoryFor = id => Object.entries(categories).find(([, names]) => names.includes(id))?.[0] ?? 'webhooks';
const apiContracts = new Map(inspectApi().map(contract => [contract.route, contract]));
const providers = [];
for (const discovered of inspectIntegrations()) {
    const id = discovered.provider;
    const category = categoryFor(id);
    const source = `src/lib/integrations/${id}.ts`;
    const route = `src/app/api/integrations/${id}/route.ts`;
    if (!exists(source) || !exists(route)) throw new Error(`Provider ${id} is missing source or route evidence`);
    const adapterSource = readRepositoryFile(source);
    const routeSource = readRepositoryFile(route);
    const sharedHandler = routeSource.includes('createIntegrationHandler');
    const actions = ['trigger', 'acknowledge', 'resolve'].filter(action =>
      new RegExp(`['"]${action}['"]`, 'i').test(adapterSource)
    );
    const signatureProvider = routeSource.match(/signatureProvider:\s*['"]([^'"]+)['"]/)?.[1];
    const headers = [...new Set([...routeSource.matchAll(/headers?\.get\(['"]([^'"]+)['"]\)/gi)]
      .map(match => match[1].toLowerCase()))];
    const api = apiContracts.get(`/api/integrations/${id}`);
    const requestSchema = routeSource.match(/schema:\s*([A-Za-z][A-Za-z0-9]+Schema)\b/)?.[1] ??
      routeSource.match(/IntegrationSchemas\.([A-Z][A-Z0-9_]*)/)?.[1] ?? 'shared provider schema';
    providers.push({
      id,
      title: displayNames[id] ?? id,
      category,
      direction: 'inbound',
      protocol: 'webhook',
      endpoint: `/api/integrations/${id}`,
      handler: sharedHandler ? 'shared' : 'custom',
      tier: ['datadog', 'prometheus', 'grafana', 'cloudwatch', 'azure', 'google-cloud-monitoring'].includes(id) ? 1 : id === 'webhook' ? 3 : 2,
      acceptedActions: actions,
      authentication: api?.authentication ?? (sharedHandler ? ['integration-key'] : []),
      request: {
        method: api?.methods?.[0] ?? 'POST',
        schema: requestSchema,
        bodyLimitBytes: api?.bodyLimited ? 1024 * 1024 : 'unknown',
        rateLimit: api?.rateLimited ? { requests: 100, windowSeconds: 60 } : 'unknown',
        integrationId: 'query parameter',
        integrationKey: sharedHandler ? ['Authorization: Bearer', 'Authorization: Token token=', 'x-integration-key', 'x-api-key', 'integrationKey query parameter'] : [],
      },
      signatureVerification: {
        mode: routeSource.includes('signatureSecret') || sharedHandler ? 'conditional-when-secret-configured' : 'not-declared',
        provider: signatureProvider ?? (sharedHandler ? 'generic' : id),
        headers: headers.filter(header => /signature|token/.test(header)),
      },
      deliveryIdentity: headers.filter(header => /delivery|request-id|event-id/.test(header)),
      source,
      route,
      sharedContracts: [
        'src/lib/integrations/handler.ts',
        'src/lib/integrations/request-security.ts',
        'src/lib/integrations/rate-limiter.ts',
      ],
      errors: sharedHandler ? [
        { status: 400, meaning: 'Invalid request or payload validation failed' },
        { status: 401, meaning: 'Integration is disabled, mismatched, or unauthorized' },
        { status: 404, meaning: 'Integration record was not found' },
        { status: 413, meaning: 'Payload exceeds the one MiB body limit' },
        { status: 429, meaning: 'Per-integration request rate exceeded' },
        { status: 503, meaning: 'A matching delivery is already being processed' },
      ] : [],
    });
}

const platformIntegrations = [
  { id: 'slack-chatops', title: 'Slack ChatOps', category: 'collaboration', direction: 'bidirectional', sources: ['src/lib/chatops', 'src/app/api/settings/integrations/slack'] },
  { id: 'microsoft-teams', title: 'Microsoft Teams', category: 'collaboration', direction: 'bidirectional', sources: ['src/lib/microsoft-teams', 'src/app/api/settings/integrations/microsoft-teams'] },
  { id: 'jira', title: 'Jira', category: 'work-management', direction: 'bidirectional', sources: ['src/lib/jira-sync.ts', 'src/app/api/jira'] },
  { id: 'outbound-webhooks', title: 'Outbound webhooks', category: 'automation', direction: 'outbound', sources: ['src/lib/webhooks', 'src/app/api/webhooks'] },
  { id: 'email', title: 'Email notifications', category: 'notification-delivery', direction: 'outbound', sources: ['src/lib/email.ts', 'src/lib/notification-providers.ts'] },
  { id: 'sms', title: 'SMS notifications', category: 'notification-delivery', direction: 'outbound', sources: ['src/lib/notification-providers.ts', 'src/app/api/webhooks/notifications'] },
  { id: 'whatsapp', title: 'WhatsApp notifications', category: 'notification-delivery', direction: 'outbound', sources: ['src/lib/notification-providers.ts', 'src/app/api/webhooks/notifications'] },
  { id: 'voice', title: 'Voice notifications', category: 'notification-delivery', direction: 'outbound', sources: ['src/lib/notification-providers.ts', 'src/app/api/webhooks/notifications/twilio/voice'] },
  { id: 'push', title: 'Push notifications', category: 'notification-delivery', direction: 'outbound', sources: ['src/lib/push-notifications.ts', 'src/lib/notification-providers.ts'] },
  { id: 'oidc', title: 'OpenID Connect', category: 'identity', direction: 'bidirectional', sources: ['src/lib/auth/oidc.ts', 'src/app/api/auth/oidc'] },
  { id: 'scim', title: 'SCIM 2.0', category: 'identity', direction: 'bidirectional', sources: ['src/lib/scim', 'src/app/api/scim'] },
];
for (const integration of platformIntegrations) {
  integration.sources = integration.sources.filter(exists);
  if (!integration.sources.length) throw new Error(`Platform integration ${integration.id} has no source evidence`);
}
const catalog = { schemaVersion: 2, generated: true, providers, integrations: [...providers, ...platformIntegrations] };
const publicDocsRoot = resolve(repositoryRoot, 'docs/v2.0.0/integrations');
// Generated provider prose is a reviewer snapshot, never the published page.
const docsRoot = resolve(repositoryRoot, 'generated/docs-reference/integrations');
const verifiedAt = execFileSync(
  'git',
  ['log', '-1', '--format=%cs', '--', 'src/lib/integrations', 'src/app/api/integrations'],
  { cwd: repositoryRoot, encoding: 'utf8' }
).trim();
writeFileSync(resolve(publicDocsRoot, 'catalog.yaml'), YAML.stringify(catalog));
mkdirSync(resolve(repositoryRoot, 'generated/docs-contracts'), { recursive: true });
writeFileSync(resolve(repositoryRoot, 'generated/docs-contracts/integrations.json'), `${JSON.stringify({ schemaVersion: 1, providers }, null, 2)}\n`);

for (const provider of providers) {
  const directory = resolve(docsRoot, provider.category);
  mkdirSync(directory, { recursive: true });
  const page = `---
title: ${provider.title}
description: Connect ${provider.title} alerts to OpsKnight incident ingestion.
type: integration
product_area: integrations
audience: [administrator, operator]
keywords: [${JSON.stringify(`${provider.title} webhook`)}, ${JSON.stringify(`connect ${provider.title}`)}, ${JSON.stringify(`${provider.title} alerts`)}, ${JSON.stringify(`${provider.title} integration`)}${provider.id === 'grafana' ? ', "Grafana contact point"' : ''}${provider.id === 'prometheus' ? ', "Alertmanager webhook"' : ''}]
verification:
  level: source
  verified_at: ${verifiedAt}
  evidence:
    - ${provider.source}
    - ${provider.route}
---

# ${provider.title}

## What it does

The ${provider.title} adapter accepts inbound webhook events at
\`${provider.endpoint}\`, validates them through its ${provider.handler} handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier${provider.authentication.includes('integration-key') ? ' and generated integration key' : ''}.
- Permission to configure webhooks in ${provider.title}.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In OpsKnight, open **Services → your service → Integrations**.
2. Select **Add integration → ${provider.title}**, then save the integration.
3. Copy the webhook URL and integration key shown by OpsKnight.
4. In ${provider.title}, create a webhook for the monitors or alerts you want to route.
5. Use \`${provider.request.method}\` and the URL generated by OpsKnight. Configure one of the supported key transports listed below.
6. Send a test alert, then verify the incident under **Incidents**.

Provider console labels can change independently of OpsKnight. Use the webhook
or notification configuration area in the provider rather than copying a URL
from another service. Treat keys and signature secrets as credentials; never
place them in logs or source control.

## Authentication and request verification

The endpoint requires the integration identifier${provider.authentication.includes('integration-key') ? ' and validates the integration key using a timing-safe comparison' : ''}.
Signature verification is **${provider.signatureVerification.mode}** using the
\`${provider.signatureVerification.provider}\` verification contract${provider.signatureVerification.headers.length ? ` and headers ${provider.signatureVerification.headers.map(header => `\`${header}\``).join(', ')}` : ''}.
The exact payload schema is defined by \`${provider.route}\` and \`${provider.source}\`.

- Method: \`${provider.request.method}\`
- Integration identifier: ${provider.request.integrationId}
- Integration key transports: ${provider.request.integrationKey.length ? provider.request.integrationKey.map(value => `\`${value}\``).join(', ') : 'not statically resolved'}
- Schema: \`${provider.request.schema}\`
- Body limit: ${typeof provider.request.bodyLimitBytes === 'number' ? `${provider.request.bodyLimitBytes} bytes (1 MiB)` : 'not statically resolved'}
- Rate limit: ${typeof provider.request.rateLimit === 'object' ? `${provider.request.rateLimit.requests} requests per ${provider.request.rateLimit.windowSeconds} seconds, per integration` : 'not statically resolved'}

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
${provider.acceptedActions.length ? provider.acceptedActions.map(action => `- \`${action}\``).join('\n') : '- No fixed lifecycle action literal is declared; inspect the adapter mapping.'}
Correlation depends on the provider identity selected by the adapter.

## Recovery and deduplication

${provider.deliveryIdentity.length ? `When signature verification runs, delivery identity is read from ${provider.deliveryIdentity.map(header => `\`${header}\``).join(', ')} and protected by the inbound-delivery fence.` : provider.handler === 'shared' ? 'When signature verification runs, the shared handler attempts provider-specific delivery identity before claiming the inbound-delivery fence.' : 'This route does not declare a durable provider delivery identifier.'}
Incident convergence still depends on the adapter correlation key. Failed
deliveries are recorded for operational inspection without exposing secrets.

## Limits and testing

Per-integration rate limiting protects the ingestion path. Send a representative
trigger and recovery pair in a non-production service, verify that one incident
is created, and confirm that recovery updates that incident rather than creating
another.

## Verify the connection

After the test alert, confirm all of the following:

- One incident appears for the selected OpsKnight service.
- The incident source identifies ${provider.title}.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event ${provider.acceptedActions.includes('resolve') ? 'resolves the correlated incident' : 'does not imply automatic resolution unless the adapter emits `resolve`'}.

## Error reference

${provider.errors.length ? provider.errors.map(error => `- \`${error.status}\` — ${error.meaning}.`).join('\n') : '- This custom route does not expose the shared integration error contract.'}

## Troubleshooting

1. Confirm the integration is enabled and belongs to the intended service.
2. Verify the integration ID in the URL and rotate any key that may have been exposed.
3. Inspect **Settings → Integrations → Failures** for validation or signature errors.
4. Check for \`413\` before changing payload templates and \`429\` before retrying rapidly.
5. Confirm the provider sends a state supported by the event mapping above.
6. Preserve the provider delivery identifier and timestamp when escalating.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
`;
  writeFileSync(resolve(directory, `${provider.id}.md`), page);
}

console.log(`Generated ${providers.length} provider records and pages.`);
