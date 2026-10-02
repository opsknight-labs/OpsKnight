#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';
import { inspectIntegrations } from './inspect-integrations.mjs';
import { inspectConfig } from './inspect-config.mjs';
import { inspectApi } from './inspect-api.mjs';
import { inspectRoutes } from './inspect-routes.mjs';

const legacyFiles = filesUnder('docs/v1.5', file => file.endsWith('.md'));
const currentDocFiles = filesUnder('docs/v2.0.0', file => file.endsWith('.md'));
const generatedContractFiles = [
  ...filesUnder('generated/docs-reference', file => file.endsWith('.md')),
  ...filesUnder('generated/docs-contracts', file => file.endsWith('.json')),
];
const legacy = legacyFiles.map(readRepositoryFile).join('\n');
const currentDocs = [...currentDocFiles, ...generatedContractFiles].map(readRepositoryFile).join('\n');

// Historical prose is not itself a release obligation. Only exact legacy
// contracts that remain present in current product source must map to v2 docs.
const activeEnvironmentNames = inspectConfig()
  .filter(item => item.semanticClassification !== 'INTERNAL_TOOLING' && legacy.includes(item.name))
  .map(item => item.name);
const activeRoutes = [...inspectApi().map(item => item.route), ...inspectRoutes().map(item => item.route)]
  .filter(route => legacy.includes(`\`${route}\``));
const activeProviders = inspectIntegrations()
  .map(item => item.provider)
  .filter(provider => legacy.toLowerCase().includes(provider.toLowerCase()));

const contracts = [
  ...activeEnvironmentNames.map(value => ({ kind: 'configuration', value })),
  ...activeRoutes.map(value => ({ kind: 'route', value })),
  ...activeProviders.map(value => ({ kind: 'integration', value })),
];
const gaps = contracts.filter(contract => !currentDocs.toLowerCase().includes(contract.value.toLowerCase()));
const report = {
  schemaVersion: 2,
  method: 'active-current-source-intersection',
  legacyFiles: legacyFiles.length,
  activeContracts: contracts.length,
  mappedContracts: contracts.length - gaps.length,
  gaps,
};
const destination = resolve(repositoryRoot, 'generated/docs-certification/v15-active-parity.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);

if (gaps.length) {
  console.error(`Active v1.5 knowledge parity failed (${gaps.length} gaps):`);
  gaps.forEach(gap => console.error(`  - ${gap.kind}: ${gap.value}`));
  process.exit(1);
}
console.log(`Active v1.5 knowledge parity passed: ${report.mappedContracts}/${report.activeContracts} still-supported contracts mapped.`);
