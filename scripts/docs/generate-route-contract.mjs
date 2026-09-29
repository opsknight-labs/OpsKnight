#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const discovery = JSON.parse(readFileSync(resolve(root, 'generated/docs-discovery/current.json'), 'utf8'));
const nodes = new Map(discovery.featureGraph.nodes.filter(node => node.kind === 'ui').map(node => [node.name, node]));
const hidden = new Set(['/settings/service-objectives']);
const internal = new Set(['/debug-mobile']);
const operator = /^\/(?:system-logs|health|settings\/system)/;
const admin = /^\/(?:audit|admin|users|teams|settings)/;

const routes = discovery.uiRoutes.map(route => {
  const node = nodes.get(route.route);
  const classification = hidden.has(route.route) ? 'HIDDEN'
    : internal.has(route.route) ? 'INTERNAL'
      : operator.test(route.route) ? 'OPERATOR_FEATURE'
        : admin.test(route.route) ? 'ADMIN_FEATURE' : 'PUBLIC_FEATURE';
  const documentation = node?.documentation ?? { concepts: [], guides: [], reference: [], troubleshooting: [] };
  return { ...route, classification, documentation, documentationMapping: node?.documentationMapping ?? 'unmapped' };
});
const contract = { schemaVersion: 1, routes };
const destination = resolve(root, 'generated/docs-contracts/routes.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`Generated route classifications for ${routes.length} UI routes.`);
