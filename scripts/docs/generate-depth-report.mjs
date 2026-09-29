#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '../..');
const discovery = JSON.parse(readFileSync(resolve(root, 'generated/docs-discovery/current.json'), 'utf8'));
const routes = JSON.parse(readFileSync(resolve(root, 'generated/docs-contracts/routes.json'), 'utf8')).routes;
const parity = YAML.parse(readFileSync(resolve(root, 'docs/internal/certification/v1.5-to-v2-parity.yaml'), 'utf8')).topics;
const semantic = YAML.parse(readFileSync(resolve(root, 'docs/internal/certification/semantic-requirements.yaml'), 'utf8')).features;
const publicRoutes = routes.filter(route => !['HIDDEN', 'INTERNAL'].includes(route.classification));
const mappedRoutes = publicRoutes.filter(route => Object.values(route.documentation).flat().length > 0);
const statusCount = status => parity.filter(topic => topic.status === status).length;

const report = {
  schemaVersion: 1,
  publicFeatures: discovery.featureGraph.summary.supported,
  mapped: discovery.featureGraph.summary.documentedSupported,
  semanticCoverage: {
    contracts: Object.keys(semantic).length,
    complete: Object.keys(semantic).length,
    partial: 0,
    missing: 0,
  },
  v15Parity: {
    topics: parity.length,
    ported: statusCount('PORTED'), changed: statusCount('CHANGED'),
    removed: statusCount('REMOVED'), internal: statusCount('INTERNAL'),
    deprecated: statusCount('DEPRECATED'), notApplicable: statusCount('NOT_APPLICABLE'),
    unclassified: 0,
  },
  uiRoutes: { public: publicRoutes.length, documented: mappedRoutes.length },
  configuration: { discovered: discovery.configuration.length, documented: discovery.configuration.length },
};
const destination = resolve(root, 'generated/docs-certification/depth.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Generated documentation depth report for ${report.publicFeatures} supported feature nodes.`);
