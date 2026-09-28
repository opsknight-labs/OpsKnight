#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const discovery = JSON.parse(readFileSync(resolve(root, 'generated/docs-discovery/current.json'), 'utf8'));
const graph = discovery.featureGraph;
if (!graph || graph.schemaVersion !== 1) throw new Error('Feature graph is missing or unsupported.');
if (graph.unclassified.length > 0) throw new Error(`Unclassified feature nodes:\n${graph.unclassified.join('\n')}`);
if (graph.duplicateIds.length > 0) throw new Error(`Duplicate feature node IDs:\n${graph.duplicateIds.join('\n')}`);

const requiredKinds = [
  'api', 'ui', 'model', 'enum', 'configuration', 'integration', 'notification-provider',
  'permission', 'authorization-action', 'api-scope', 'worker-lane', 'runtime-role', 'deployment-topology', 'limit',
];
for (const kind of requiredKinds) {
  if (!graph.nodes.some(node => node.kind === kind)) throw new Error(`Feature graph has no ${kind} nodes.`);
}

const supportedApis = graph.nodes.filter(node => node.kind === 'api' && node.classification === 'PUBLIC_API');
for (const node of supportedApis) {
  if (!node.contract.methods?.length) throw new Error(`Public API has no discovered methods: ${node.name}`);
  if (!node.sources.length) throw new Error(`Public API has no provenance: ${node.name}`);
}

console.log(`Feature graph contract passed: ${graph.nodes.length} classified nodes, 0 unclassified.`);
