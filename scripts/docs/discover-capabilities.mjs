#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectApi } from './inspect-api.mjs';
import { inspectConfig } from './inspect-config.mjs';
import { inspectDatabase } from './inspect-database.mjs';
import { inspectDeployment } from './inspect-deployment.mjs';
import { inspectIntegrations } from './inspect-integrations.mjs';
import { inspectPermissions } from './inspect-permissions.mjs';
import { inspectRoutes } from './inspect-routes.mjs';
import { inspectRuntime } from './inspect-runtime.mjs';
import { repositoryRoot } from './discovery-lib.mjs';

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRevision: process.env.GITHUB_SHA ?? null,
  uiRoutes: inspectRoutes(),
  apiRoutes: inspectApi(),
  configuration: inspectConfig(),
  integrations: inspectIntegrations(),
  permissions: inspectPermissions(),
  deployment: inspectDeployment(),
  database: inspectDatabase(),
  runtime: inspectRuntime(),
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  const destination = process.argv[outputIndex + 1];
  if (!destination) throw new Error('--output requires a repository-relative path');
  writeFileSync(resolve(repositoryRoot, destination), `${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
