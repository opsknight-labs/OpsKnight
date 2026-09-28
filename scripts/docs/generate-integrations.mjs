#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';

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

const providers = [];
for (const [category, names] of Object.entries(categories)) {
  for (const id of names) {
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
    providers.push({
      id,
      title: displayNames[id] ?? id,
      category,
      direction: 'inbound',
      protocol: 'webhook',
      endpoint: `/api/integrations/${id}`,
      handler: sharedHandler ? 'shared' : 'custom',
      acceptedActions: actions,
      authentication: sharedHandler ? ['integration-id', 'integration-key'] : ['integration-id'],
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
    });
  }
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
const catalog = { generated: true, providers, integrations: [...providers, ...platformIntegrations] };
const docsRoot = resolve(repositoryRoot, 'docs/v2.0.0/integrations');
const verifiedAt = execFileSync(
  'git',
  ['log', '-1', '--format=%cs', '--', 'src/lib/integrations', 'src/app/api/integrations'],
  { cwd: repositoryRoot, encoding: 'utf8' }
).trim();
writeFileSync(resolve(docsRoot, 'catalog.yaml'), YAML.stringify(catalog));

for (const provider of providers) {
  const directory = resolve(docsRoot, provider.category);
  mkdirSync(directory, { recursive: true });
  const page = `---
title: ${provider.title}
description: Connect ${provider.title} alerts to OpsKnight incident ingestion.
type: integration
product_area: integrations
audience: [administrator, operator]
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

Create the integration from the service integration settings. Configure the
provider to send events to the endpoint shown by OpsKnight. Treat the integration
key and any signature secret as credentials; do not place them in logs or source
control.

## Authentication and request verification

The endpoint requires the integration identifier${provider.authentication.includes('integration-key') ? ' and validates the integration key' : ''}.
Signature verification is **${provider.signatureVerification.mode}** using the
\`${provider.signatureVerification.provider}\` verification contract${provider.signatureVerification.headers.length ? ` and headers ${provider.signatureVerification.headers.map(header => `\`${header}\``).join(', ')}` : ''}.
The exact payload schema is defined by \`${provider.route}\` and \`${provider.source}\`.

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

## Troubleshooting

Check integration enabled state, key resolution, signature verification, rate
limits, payload validation, and the integration failure view. Preserve the
provider delivery identifier and timestamp when escalating a problem.

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
`;
  writeFileSync(resolve(directory, `${provider.id}.md`), page);
}

console.log(`Generated ${providers.length} provider records and pages.`);
