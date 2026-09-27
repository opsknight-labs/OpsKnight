#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectApi } from './inspect-api.mjs';
import { inspectConfig } from './inspect-config.mjs';
import { inspectPermissions } from './inspect-permissions.mjs';
import { repositoryRoot } from './discovery-lib.mjs';

const root = resolve(repositoryRoot, 'docs/v2.0.0/reference');
const date = new Date().toISOString().slice(0, 10);
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

## API scopes

${permissions.apiScopes.map(scope => `- \`${scope}\``).join('\n')}
`;

const variables = inspectConfig();
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

${variables.map(variable => `## \`${variable.name}\`\n\n- Required: ${variable.required ? 'yes' : 'no or conditionally required'}\n- Secret: ${variable.secret ? 'yes' : 'no'}\n- Scope: ${variable.scopes.join(', ')}\n- Static default: ${variable.secret ? 'not displayed' : variable.defaults.length ? variable.defaults.map(value => `\`${value}\``).join(', ') : 'none discovered'}\n- Sources: ${variable.sources.map(source => `\`${source}\``).join(', ')}\n`).join('\n')}
`;

const routes = inspectApi();
const apiBody = `${frontmatter({
  title: 'API route inventory',
  description: 'Generated inventory of implemented HTTP API route modules.',
  area: 'api',
  evidence: ['src/app/api/'],
})}

# API route inventory

This page lists route modules implemented under \`src/app/api\`. It is an
implementation inventory, not a stability promise. Authentication, request,
response, and error contracts require dedicated schema-backed pages.

${routes.map(route => `- \`${route.methods.join(', ') || 'method resolved at runtime'} ${route.route}\` — \`${route.file}\``).join('\n')}
`;

mkdirSync(resolve(root, 'api'), { recursive: true });
mkdirSync(resolve(root, 'configuration'), { recursive: true });
writeFileSync(resolve(root, 'permissions.md'), permissionBody);
writeFileSync(resolve(root, 'configuration/README.md'), configurationBody);
writeFileSync(resolve(root, 'api/README.md'), apiBody);
console.log(`Generated ${routes.length} API routes, ${variables.length} configuration entries, and ${permissions.capabilities.length} capabilities.`);
