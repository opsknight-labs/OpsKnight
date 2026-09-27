#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

const forbiddenAtRoot = [
  /^docker-compose.*\.ya?ml$/i,
  /^docker-stack.*\.ya?ml$/i,
  /^k8s$/i,
  /^helm$/i,
  /^docker$/i,
];

const requiredDeployPaths = [
  'deploy/README.md',
  'deploy/compose/README.md',
  'deploy/compose/docker-compose.yml',
  'deploy/compose/docker-compose.dev.yml',
  'deploy/compose/docker-compose.split.yml',
  'deploy/compose/docker-compose.pgbouncer.yml',
  'deploy/compose/docker-compose.external-db.yml',
  'deploy/compose/docker-compose.pgbouncer-ca.yml',
  'deploy/swarm/README.md',
  'deploy/swarm/docker-stack.yml',
  'deploy/swarm/docker-stack.db.yml',
  'deploy/swarm/docker-stack.integrated.yml',
  'deploy/swarm/docker-stack.pgbouncer.yml',
  'deploy/swarm/docker-stack.external-db.yml',
  'deploy/swarm/docker-stack.external-db.integrated.yml',
  'deploy/swarm/docker-stack.ca.split.yml',
  'deploy/swarm/docker-stack.ca.integrated.yml',
  'deploy/swarm/docker-stack.pgbouncer-ca.yml',
  'deploy/swarm/scripts/deploy.sh',
  'deploy/swarm/scripts/health-check.sh',
  'deploy/swarm/scripts/migrate.sh',
  'deploy/swarm/scripts/rollback.sh',
  'deploy/kubernetes/README.md',
  'deploy/kubernetes/kustomize/base/kustomization.yaml',
  'deploy/kubernetes/kustomize/profiles/integrated/kustomization.yaml',
  'deploy/kubernetes/kustomize/profiles/split/kustomization.yaml',
  'deploy/kubernetes/kustomize/profiles/split-pgbouncer/kustomization.yaml',
  'deploy/kubernetes/kustomize/monitoring/servicemonitor.yaml',
  'deploy/kubernetes/helm/opsknight/Chart.yaml',
  'deploy/kubernetes/helm/opsknight/values.yaml',
  'deploy/kubernetes/helm/opsknight/values.schema.json',
  'deploy/images/pgbouncer/Dockerfile',
  'deploy/images/pgbouncer/entrypoint.sh',
  'deploy/images/pgbouncer/userlist.txt.example',
  'deploy/scripts/check-layout.cjs',
  'deploy/scripts/validate-runtime-capacity.cjs',
  'deploy/scripts/drills/verify-k8s-failover.sh',
  'deploy/scripts/drills/verify-backup-restore.sh',
];

const rootEntries = fs.readdirSync(root);

for (const entry of rootEntries) {
  if (forbiddenAtRoot.some(rx => rx.test(entry))) {
    console.error(
      `Forbidden top-level deployment path found: ${entry} (must live under deploy/)`
    );
    process.exit(1);
  }
}

for (const rel of requiredDeployPaths) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`Missing canonical deployment path: ${rel}`);
    process.exit(1);
  }
}

console.log('Deployment layout check passed.');
