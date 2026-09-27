#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, repositoryRoot } from './discovery-lib.mjs';

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
    providers.push({
      id,
      title: displayNames[id] ?? id,
      category,
      direction: 'inbound',
      protocol: 'webhook',
      endpoint: `/api/integrations/${id}`,
      authentication: ['integration-key', 'optional-provider-signature'],
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

const catalog = { generated: true, providers };
const docsRoot = resolve(repositoryRoot, 'docs/v2.0.0/integrations');
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
verified: true
verified_at: ${new Date().toISOString().slice(0, 10)}
evidence:
  - ${provider.source}
  - ${provider.route}
---

# ${provider.title}

## What it does

The ${provider.title} adapter accepts inbound webhook events at
\`${provider.endpoint}\`, validates them through the shared integration handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier and generated integration key.
- Permission to configure webhooks in ${provider.title}.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

Create the integration from the service integration settings. Configure the
provider to send events to the endpoint shown by OpsKnight. Treat the integration
key and any signature secret as credentials; do not place them in logs or source
control.

## Authentication and request verification

The shared handler resolves the integration, verifies the integration key,
applies per-integration rate limiting, and uses provider signature verification
when a signature secret and supported provider contract are configured. The
exact accepted headers and payload schema are defined by \`${provider.route}\`
and \`${provider.source}\`.

## Event mapping and incident lifecycle

The adapter maps provider states into normalized trigger, acknowledge, or resolve
events. Correlation depends on a stable provider identity; display names alone
are not reliable deduplication keys. Inspect the provider source before changing
its mapping contract.

## Recovery and deduplication

Deliveries with a genuine provider delivery identifier use the fenced inbound
delivery claim. Replayed events must converge on the same service and correlation
key. Failed deliveries are recorded for operational inspection without exposing
stored secrets.

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
