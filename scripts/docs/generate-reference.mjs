#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inspectApi } from './inspect-api.mjs';
import { inspectConfig } from './inspect-config.mjs';
import { inspectPermissions } from './inspect-permissions.mjs';
import { inspectRoutes } from './inspect-routes.mjs';
import { inspectDatabase } from './inspect-database.mjs';
import { inspectDeployment } from './inspect-deployment.mjs';
import { inspectIntegrations } from './inspect-integrations.mjs';
import { inspectRuntime } from './inspect-runtime.mjs';
import { inspectNotificationProviders } from './inspect-notification-providers.mjs';
import { inspectLimits } from './inspect-limits.mjs';
import { buildFeatureGraph } from './build-feature-graph.mjs';
import { repositoryRoot } from './discovery-lib.mjs';

const root = resolve(repositoryRoot, 'docs/v2.0.0/reference');
const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'src', 'deploy', 'prisma'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const frontmatter = ({ title, description, area, evidence }) => `---
title: ${title}
description: ${description}
type: reference
product_area: ${area}
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: ${date}
  evidence:
${evidence.map(item => `    - ${item}`).join('\n')}
---`;

const permissions = inspectPermissions();
const permissionBody = `${frontmatter({
  title: 'Permissions reference',
  description: 'Generated application roles, capabilities, and API scopes.',
  area: 'authorization',
  evidence: [permissions.source],
})}

# Permissions reference

This page is generated from \`${permissions.source}\`. Server-side policy and
resource scope remain authoritative.

## Roles

${permissions.roles.map(role => `- \`${role}\``).join('\n')}

## Capabilities

${permissions.capabilities.map(capability => `- \`${capability}\``).join('\n')}

## Authorization actions

${permissions.actions.map(action => `- \`${action}\``).join('\n')}

## API scopes

${permissions.apiScopes.map(scope => `- \`${scope}\``).join('\n')}
`;

const variables = inspectConfig();
const criticalConfiguration = {
  DATABASE_URL: ['PostgreSQL connection used by the web and worker runtime.', 'PostgreSQL URL', 'all runtime roles', 'restart required', 'secret'],
  DIRECT_DATABASE_URL: ['Direct PostgreSQL connection used for migrations and operations that must bypass a pooler.', 'PostgreSQL URL', 'migration/integrated runtime', 'restart required', 'secret'],
  NEXTAUTH_URL: ['Canonical externally reachable application URL used by authentication callbacks.', 'absolute URL', 'web', 'restart required', 'non-secret'],
  NEXT_PUBLIC_APP_URL: ['Public application origin embedded in browser-visible links and provider callbacks.', 'absolute URL', 'web/build', 'rebuild or restart required', 'non-secret'],
  NEXTAUTH_SECRET: ['Signs authentication state and may act as the voice callback fallback only when sufficiently long.', 'high-entropy string (32+ characters)', 'web', 'restart invalidates existing sessions', 'secret'],
  ENCRYPTION_KEY: ['Encrypts stored integration and provider credentials.', '64 hexadecimal characters', 'all roles accessing encrypted data', 'coordinated restart; rotate through the documented procedure', 'critical secret'],
  VOICE_CALLBACK_SIGNING_SECRET: ['Signs Twilio voice gather and status callback tokens independently of login sessions.', 'high-entropy string (32+ characters)', 'web and notification workers', 'restart required', 'secret'],
  PROMETHEUS_SCRAPE_TOKEN: ['Bearer token required by the metrics endpoint when configured.', 'opaque token', 'web', 'restart required', 'secret'],
  OPSKNIGHT_RUNTIME_ROLE: ['Selects integrated, web, scheduler, or worker process behavior in split deployments.', 'enumerated runtime role', 'each runtime deployment', 'restart required', 'non-secret'],
  OPSKNIGHT_WORKER_LANE: ['Selects the all, general, critical, bulk, or projector queue lane.', 'all | general | critical | bulk | projector', 'worker', 'restart required', 'non-secret'],
  TRUST_PROXY_HEADERS: ['Allows forwarded host and protocol headers from a trusted reverse proxy to define the external request origin.', 'boolean', 'web behind a trusted proxy', 'restart required', 'non-secret; enable only when untrusted clients cannot set forwarded headers'],
  SCIM_BEARER_TOKEN: ['Authenticates SCIM provisioning requests.', 'high-entropy bearer token', 'web', 'restart required; overlap old and new clients only through an intentional rotation window', 'secret'],
  OIDC_REQUIRE_EMAIL_VERIFIED_STRICT: ['Rejects OIDC identities whose provider does not assert a verified email.', 'boolean', 'web', 'restart required', 'non-secret'],
  OIDC_CONFIG_CACHE_TTL_MS: ['Controls how long resolved OIDC provider configuration remains in the process cache.', 'positive milliseconds', 'web', 'restart required', 'non-secret'],
  SLACK_BOT_TOKEN: ['Authorizes Slack Web API operations for the connected workspace.', 'Slack bot token', 'web and notification workers', 'restart required after secret replacement', 'secret'],
  SLACK_SIGNING_SECRET: ['Verifies inbound Slack request signatures.', 'Slack signing secret', 'web', 'restart required; coordinate rotation with Slack configuration', 'secret'],
  SLACK_CLIENT_SECRET: ['Authenticates the Slack OAuth client.', 'Slack OAuth client secret', 'web', 'restart required', 'secret'],
  OPSKNIGHT_WORKER_CONCURRENCY: ['Sets general worker parallelism when a lane-specific override is absent.', 'positive integer', 'worker', 'restart required; increase only after checking database and provider capacity', 'non-secret'],
  OPSKNIGHT_WORKER_BATCH_SIZE: ['Sets the general queue claim batch when a lane-specific override is absent.', 'positive integer', 'worker', 'restart required; keep aligned with concurrency and lease duration', 'non-secret'],
  OPSKNIGHT_WORKER_BUSY_POLL_MS: ['Sets the polling interval while general work is available.', 'positive milliseconds', 'worker', 'restart required', 'non-secret'],
  OPSKNIGHT_WORKER_IDLE_POLL_MS: ['Sets the polling interval while the general queue is idle.', 'positive milliseconds', 'worker', 'restart required', 'non-secret'],
};
const criticalBody = Object.entries(criticalConfiguration)
  .filter(([name]) => variables.some(variable => variable.name === name))
  .map(([name, [description, type, role, reload, sensitivity]]) => `### \`${name}\`\n\n${description}\n\n- Type and valid value: ${type}\n- Runtime role: ${role}\n- Apply behavior: ${reload}\n- Sensitivity: ${sensitivity}\n`)
  .join('\n');
const configurationBody = `${frontmatter({
  title: 'Configuration reference',
  description: 'Generated inventory of environment configuration used by source and deployment manifests.',
  area: 'configuration',
  evidence: ['src/', 'deploy/'],
})}

# Configuration reference

This generated inventory identifies configuration names found in current source
and deployment manifests. Required and default values are conservative static
inferences; the listed source remains authoritative for parsing and validation.

## Curated production contract

These critical settings have operator-reviewed semantics. Conditions and safe
rotation procedures in the linked deployment and security guides take precedence
over a scanner-inferred default.

${criticalBody}

## Complete discovered inventory

${variables.map(variable => `## \`${variable.name}\`\n\n- Type: ${variable.type}\n- Required: ${variable.required ? 'yes' : variable.requiredWhen}\n- Allowed values: ${variable.allowedValues.length ? variable.allowedValues.map(value => `\`${value}\``).join(', ') : 'not statically complete'}\n- Secret: ${variable.secret ? 'yes' : 'no'}\n- Runtime roles: ${variable.runtimeRoles.join(', ')}\n- Deployment support: ${variable.deploymentSupport.join(', ')}\n- Apply behavior: ${variable.restartRequired ? 'restart required' : 'runtime reload supported'}\n- Deprecated: ${variable.deprecated ? `yes; use \`${variable.replacement}\`` : 'no'}\n- Extraction confidence: ${variable.confidence}\n- Static default: ${variable.secret ? 'not displayed' : variable.defaults.length ? variable.defaults.map(value => `\`${value}\``).join(', ') : 'none discovered'}\n- Sources: ${variable.sources.map(source => `\`${source}\``).join(', ')}\n`).join('\n')}
`;

const routes = inspectApi();
const routeClass = route => {
  if (route.route.startsWith('/api/integrations/')) return 'Alert ingestion endpoints';
  if (route.route.startsWith('/api/webhooks/')) return 'Provider callback and webhook endpoints';
  if (route.route.startsWith('/api/scim/')) return 'Identity protocol endpoints';
  if (/^\/api\/(?:health|metrics)(?:\/|$)/.test(route.route)) return 'Operator health and metrics endpoints';
  return 'Application and internal UI endpoints';
};
const routeSections = [...new Set(routes.map(routeClass))]
  .map(section => `## ${section}\n\n${section === 'Application and internal UI endpoints' ? '> These routes support the OpsKnight UI and are not a supported external API contract. Do not build external automation against them unless a dedicated contract page says otherwise.\n\n' : ''}${routes.filter(route => routeClass(route) === section).map(route => `- \`${route.methods.join(', ') || 'method resolved at runtime'} ${route.route}\` — \`${route.file}\``).join('\n')}`)
  .join('\n\n');
const apiBody = `${frontmatter({
  title: 'API route inventory',
  description: 'Generated inventory of implemented HTTP API route modules.',
  area: 'api',
  evidence: ['src/app/api/'],
})}

# API route inventory

This page classifies route modules implemented under \`src/app/api\`. It is an
implementation inventory, not a public stability promise. Alert-ingestion
contracts live in the provider pages; webhook, health, metrics, SCIM, and OIDC
surfaces use their dedicated references. Everything in the internal section is
explicitly unsupported for third-party automation.

Supported general-purpose contracts are documented separately:

- [Authentication](./authentication)
- [Events API v2](./events)
- [Incidents API](./incidents)
- [Responses and errors](./errors)

${routeSections}
`;

const limits = inspectLimits();
const limitsBody = `${frontmatter({
  title: 'Runtime limits',
  description: 'Generated limits, timeouts, rates, concurrency bounds, and retention constants.',
  area: 'configuration',
  evidence: ['generated/docs-discovery/current.json', 'src/'],
})}

# Runtime limits

This page is generated from named numeric constants and explicit maximum-value
messages in source. A discovered constant is not automatically a public promise;
use its source and owning feature to interpret scope. Scanner output is kept here
to prevent copied values from silently drifting.

${limits.filter(limit => limit.semanticClassification !== 'INTERNAL_IMPLEMENTATION' && limit.semanticClassification !== 'PROVIDER_CONSTRAINT').map(limit => `## \`${limit.name}\`\n\n- Classification: \`${limit.semanticClassification}\`\n- Value: \`${limit.value}\`\n- Source expression: \`${limit.expression.replaceAll('`', '')}\`\n- Source: \`${limit.source}\``).join('\n\n')}
`;

const discoveryForGraph = {
  apiRoutes: routes,
  uiRoutes: inspectRoutes(),
  configuration: variables,
  integrations: inspectIntegrations(),
  permissions,
  deployment: inspectDeployment(),
  database: inspectDatabase(),
  runtime: inspectRuntime(),
  notificationProviders: inspectNotificationProviders(),
  limits,
};
const graph = buildFeatureGraph(discoveryForGraph);
const featureBody = `${frontmatter({
  title: 'Product feature classification',
  description: 'Generated ownership and visibility classification for every discovered product surface.',
  area: 'platform',
  evidence: ['generated/docs-discovery/current.json', 'generated/docs-contracts/current.json'],
})}

# Product feature classification

Certification fails if any discovered node lacks an owner, classification, or
source. Public documentation is generated from public, administrator, and
operator contracts; internal nodes remain classified without becoming public
API promises.

- Total classified nodes: ${graph.summary.total}
- Unclassified nodes: ${graph.summary.unclassified}
- Evidence-backed generated claims: ${graph.summary.claims}
- Unsupported generated claims: ${graph.summary.unsupportedClaims}
- Supported product nodes: ${graph.summary.supported}
- Documented supported nodes: ${graph.summary.documentedSupported}
- Undocumented supported nodes: ${graph.summary.undocumentedSupported}
- Unresolved semantic contracts: ${graph.summary.unresolvedSemanticContracts}

${Object.entries(graph.summary.byKind).map(([kind, count]) => `- \`${kind}\`: ${count}`).join('\n')}

## Classification totals

${Object.entries(graph.summary.byClassification).map(([classification, count]) => `- \`${classification}\`: ${count}`).join('\n')}

The complete node-level contract, including provenance and extracted API
semantics, is stored in \`generated/docs-contracts/current.json\`.
`;

mkdirSync(resolve(root, 'api'), { recursive: true });
mkdirSync(resolve(root, 'configuration'), { recursive: true });
writeFileSync(resolve(root, 'permissions.md'), permissionBody);
writeFileSync(resolve(root, 'configuration/README.md'), configurationBody);
writeFileSync(resolve(root, 'api/README.md'), apiBody);
writeFileSync(resolve(root, 'limits.md'), limitsBody);
writeFileSync(resolve(root, 'features.md'), featureBody);
console.log(`Generated ${routes.length} API routes, ${variables.length} configuration entries, and ${permissions.capabilities.length} capabilities.`);
