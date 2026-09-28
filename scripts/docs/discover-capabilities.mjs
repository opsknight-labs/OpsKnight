#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inspectApi } from './inspect-api.mjs';
import { inspectConfig } from './inspect-config.mjs';
import { inspectDatabase } from './inspect-database.mjs';
import { inspectDeployment } from './inspect-deployment.mjs';
import { inspectIntegrations } from './inspect-integrations.mjs';
import { inspectPermissions } from './inspect-permissions.mjs';
import { inspectRoutes } from './inspect-routes.mjs';
import { inspectRuntime } from './inspect-runtime.mjs';
import { inspectNotificationProviders } from './inspect-notification-providers.mjs';
import { inspectLimits } from './inspect-limits.mjs';
import { buildFeatureGraph } from './build-feature-graph.mjs';
import { repositoryRoot } from './discovery-lib.mjs';

const sourceRevision = process.env.GITHUB_SHA ?? execFileSync(
  'git',
  ['log', '-1', '--format=%H', '--', 'src', 'prisma', 'deploy', 'package.json'],
  { cwd: repositoryRoot, encoding: 'utf8' }
).trim();
const generatedAt = execFileSync(
  'git',
  ['show', '-s', '--format=%cI', sourceRevision],
  { cwd: repositoryRoot, encoding: 'utf8' }
).trim();

const report = {
  schemaVersion: 1,
  generatedAt,
  sourceRevision,
  uiRoutes: inspectRoutes(),
  apiRoutes: inspectApi(),
  configuration: inspectConfig(),
  integrations: inspectIntegrations(),
  permissions: inspectPermissions(),
  deployment: inspectDeployment(),
  database: inspectDatabase(),
  runtime: inspectRuntime(),
  notificationProviders: inspectNotificationProviders(),
  limits: inspectLimits(),
};
report.featureGraph = buildFeatureGraph(report);

const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  const destination = process.argv[outputIndex + 1];
  if (!destination) throw new Error('--output requires a repository-relative path');
  writeFileSync(resolve(repositoryRoot, destination), `${JSON.stringify(report, null, 2)}\n`);
  const contractsPath = resolve(repositoryRoot, 'generated/docs-contracts/current.json');
  mkdirSync(resolve(repositoryRoot, 'generated/docs-contracts'), { recursive: true });
  writeFileSync(contractsPath, `${JSON.stringify({
    schemaVersion: 1,
    sourceRevision,
    contracts: report.featureGraph.nodes.filter(node => node.classification !== 'INTERNAL_IMPLEMENTATION'),
  }, null, 2)}\n`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
