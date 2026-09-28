#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const discovery = JSON.parse(readFileSync(resolve(root, 'generated/docs-discovery/current.json'), 'utf8'));
const graph = discovery.featureGraph;
if (!graph || graph.schemaVersion !== 1) throw new Error('Feature graph is missing or unsupported.');
if (graph.unclassified.length > 0) throw new Error(`Unclassified feature nodes:\n${graph.unclassified.join('\n')}`);
if (graph.duplicateIds.length > 0) throw new Error(`Duplicate feature node IDs:\n${graph.duplicateIds.join('\n')}`);
if (graph.unsupportedClaims.length > 0) throw new Error(`Unsupported generated claims:\n${graph.unsupportedClaims.join('\n')}`);
if (graph.undocumented.length > 0) throw new Error(`Supported feature nodes without documentation:\n${graph.undocumented.join('\n')}`);
if (graph.unresolvedSemanticContracts.length > 0) throw new Error(`Unresolved semantic contracts:\n${graph.unresolvedSemanticContracts.join('\n')}`);

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
for (const node of graph.nodes) {
  if (!node.claims?.length) throw new Error(`Feature node has no claim provenance: ${node.id}`);
  for (const claim of node.claims) {
    if (!claim.text || !claim.verification || !claim.evidence?.length) {
      throw new Error(`Incomplete claim provenance: ${claim.id}`);
    }
  }
  if (node.classification !== 'INTERNAL_IMPLEMENTATION') {
    const documentation = Object.values(node.documentation ?? {}).flat();
    if (documentation.length === 0) throw new Error(`Supported feature has no documentation: ${node.id}`);
    for (const path of documentation) {
      try { readFileSync(resolve(root, 'docs/v2.0.0', path)); }
      catch { throw new Error(`Feature documentation does not exist: ${node.id} -> ${path}`); }
    }
  }
}

console.log(`Feature graph contract passed: ${graph.nodes.length} classified nodes, ${graph.summary.documentedSupported}/${graph.summary.supported} supported nodes documented, and ${graph.summary.claims} evidence-backed claims.`);
