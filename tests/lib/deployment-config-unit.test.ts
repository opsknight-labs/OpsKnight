import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { calculateRuntimeCapacity } from '../../src/lib/runtime-capacity';

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- Deployment contract tests inspect a fixed repository-local file set. */

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const require = createRequire(import.meta.url);

describe('deployment configuration invariants', () => {
  it('keeps packaged deployment versions aligned with the application version', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const chart = read('deploy/kubernetes/helm/opsknight/Chart.yaml');
    const rawDeployment = read('deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml');
    expect(chart).toContain(`version: ${pkg.version}`);
    expect(chart).toMatch(new RegExp(`appVersion: '${pkg.version}(?:-hotfix)?'`));
    expect(rawDeployment).toMatch(
      new RegExp(`ghcr.io/opsknight-labs/opsknight:${pkg.version}(?:-hotfix)?`)
    );
  });

  it('runs postgres:15-alpine with its uid/gid instead of uid 999', () => {
    const raw = read('deploy/kubernetes/kustomize/base/postgres-statefulset.yaml');
    const helm = read('deploy/kubernetes/helm/opsknight/values.yaml');
    expect(raw).toContain('runAsUser: 70');
    expect(raw).toContain('runAsGroup: 70');
    expect(raw).not.toContain('runAsUser: 999');
    expect(helm).toContain('runAsUser: 70');
    expect(helm).not.toContain('runAsUser: 999');
  });

  it('does not ship the obsolete OpsSentinal postgres credentials', () => {
    const secret = read('deploy/kubernetes/kustomize/base/secret.yaml');
    expect(secret).toContain('POSTGRES_USER: b3Bza25pZ2h0');
    expect(secret).not.toContain('T3BzU2VudGluYWw=');
    expect(secret).not.toContain('T3BzU2VudGluYWxfc2VjdXJlX3Bhc3N3b3JkX2NoYW5nZV9tZQ==');
  });

  it('uses portable network policies and isolates bundled postgres egress', () => {
    const raw = read('deploy/kubernetes/kustomize/base/network-policy.yaml');
    const helm = read('deploy/kubernetes/helm/opsknight/templates/networkpolicy.yaml');
    expect(raw).toContain('kubernetes.io/metadata.name: ingress-nginx');
    expect(helm).toContain('ingressNamespaceLabels');
    expect(raw).toContain('port: 5432');
    expect(helm).toContain('.Values.database.port');
    expect(raw).toContain('PostgreSQL does not initiate network connections');
    expect(raw).toContain('egress: []');
    expect(helm).toContain('egress: []');
  });

  it('exposes the public app URL in Kubernetes and Helm', () => {
    expect(read('deploy/kubernetes/kustomize/base/configmap.yaml')).toContain(
      'NEXT_PUBLIC_APP_URL'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/configmap.yaml')).toContain(
      'NEXT_PUBLIC_APP_URL'
    );
  });

  it('keeps production secret and encryption-keyring contracts aligned across packages', () => {
    const compose = read('deploy/compose/docker-compose.yml');
    const composeSplit = read('deploy/compose/docker-compose.split.yml');
    const helmValues = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helmDeployment = read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml');
    const helmSplit = read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml');
    const kustomizeSecret = read('deploy/kubernetes/kustomize/base/secret.yaml');
    const swarmIntegrated = read('deploy/swarm/docker-stack.integrated.yml');
    const swarmSplit = read('deploy/swarm/docker-stack.yml');

    for (const artifact of [compose, composeSplit, helmValues, kustomizeSecret]) {
      expect(artifact).toContain('API_KEY_SECRET');
      expect(artifact).toContain('ENCRYPTION_KEYS');
    }
    for (const artifact of [helmDeployment, helmSplit]) {
      expect(artifact).toContain('name: API_KEY_SECRET');
      expect(artifact).toContain('name: ENCRYPTION_KEYS');
    }
    for (const artifact of [swarmIntegrated, swarmSplit]) {
      expect(artifact).toContain('API_KEY_SECRET_FILE: /run/secrets/opsknight_api_key_secret');
      expect(artifact).toContain('ENCRYPTION_KEYS_FILE: /run/secrets/opsknight_encryption_keys');
    }

    const entrypoint = read('docker-entrypoint.sh');
    expect(entrypoint).toContain('load_secret_file "API_KEY_SECRET_FILE" "API_KEY_SECRET"');
    expect(entrypoint).toContain('load_secret_file "ENCRYPTION_KEYS_FILE" "ENCRYPTION_KEYS"');
  });

  it('fails Helm rendering when ServiceMonitor authentication is missing', () => {
    const serviceMonitor = read('deploy/kubernetes/helm/opsknight/templates/servicemonitor.yaml');
    expect(serviceMonitor).toContain(
      'metrics.serviceMonitor.enabled requires metrics.scrapeTokenSecret.existingSecret'
    );
    expect(serviceMonitor).toContain('bearerTokenSecret:');
  });

  it('keeps the raw ServiceMonitor selector aligned with the application Service', () => {
    const service = read('deploy/kubernetes/kustomize/base/service.yaml');
    const serviceMonitor = read('deploy/kubernetes/kustomize/monitoring/servicemonitor.yaml');
    expect(service).toContain('app: opsknight-app');
    expect(serviceMonitor).toContain('app: opsknight-app');
    expect(serviceMonitor).not.toContain('app: opsknight\n');
  });

  it('protects long migration starts and fails closed on migration failure', () => {
    expect(read('deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml')).toContain(
      'startupProbe:'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml')).toContain(
      'startupProbe:'
    );
    const entrypoint = read('docker-entrypoint.sh');
    expect(entrypoint).toContain('Refusing to start against an unknown database schema');
    expect(entrypoint).toMatch(/MIGRATION_SUCCESS=0[\s\S]*exit 1/);
    expect(entrypoint).toContain('scripts/dist/scripts/auto-recover-migrations.js');
    expect(entrypoint).toContain('DIRECT_DATABASE_URL');
    expect(entrypoint).toMatch(
      /export DATABASE_URL="\$DIRECT_DATABASE_URL"[\s\S]*install_status_platform_indexes[\s\S]*export DATABASE_URL="\$RUNTIME_DATABASE_URL"/
    );
    expect(entrypoint).toMatch(
      /MIGRATION_SUCCESS[\s\S]*install_status_platform_indexes[\s\S]*Starting application/
    );
    expect(entrypoint).toContain('Refusing to start without required indexes');
    expect(read('.github/workflows/tests.yml')).toMatch(
      /prisma migrate deploy[\s\S]*prisma:indexes:status-platform/
    );
    expect(read('.github/workflows/docker-image.yml')).toMatch(
      /prisma migrate deploy[\s\S]*prisma:indexes:status-platform/
    );
    expect(read('package.json')).toContain(
      'prisma migrate deploy && npm run prisma:indexes:status-platform'
    );
    const onlineIndexes = read('scripts/create-status-platform-online-indexes.cjs');
    expect(onlineIndexes).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(onlineIndexes).toContain("searchParams.set('connection_limit', '1')");
    expect(onlineIndexes).toContain('pg_advisory_lock');
    expect(onlineIndexes).toContain('pg_advisory_unlock');
    expect(read('package.json')).toContain(
      'scripts/auto-recover-migrations.ts --rootDir . --outDir scripts/dist'
    );
    expect(read('scripts/auto-recover-migrations.ts')).toContain('execFileSync');
    expect(read('scripts/auto-recover-migrations.ts')).not.toContain('execSync(');
  });

  it('assigns Kubernetes schema changes to one migration owner', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const integrated = read('deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml');
    const split = read('deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml');
    const migration = read('deploy/kubernetes/kustomize/migration-job.yaml');

    expect(values).toMatch(/migrations:\n\s+job:\n\s+enabled: true/);
    expect(read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml')).not.toMatch(
      /if \.Values\.migrations\.job\.enabled[\s\S]{0,100}OPSKNIGHT_SKIP_MIGRATIONS/
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml')).not.toMatch(
      /if \$root\.Values\.migrations\.job\.enabled[\s\S]{0,100}OPSKNIGHT_SKIP_MIGRATIONS/
    );
    expect(integrated).toContain('name: OPSKNIGHT_SKIP_MIGRATIONS');
    expect(integrated).toContain('value: "true"');
    expect(split.match(/name: OPSKNIGHT_SKIP_MIGRATIONS/g)).toHaveLength(7);
    expect(migration).toContain('kind: Job');
    expect(migration).toContain('name: OPSKNIGHT_MIGRATION_ONLY');
    expect(migration).toContain('key: DIRECT_DATABASE_URL');
    expect(migration).toContain('imagePullPolicy: Always');
    expect(migration).not.toContain('OPSKNIGHT_SKIP_MIGRATIONS');
    const helmMigration = read('deploy/kubernetes/helm/opsknight/templates/migration-job.yaml');
    expect(helmMigration).toContain('.Release.IsInstall');
    expect(helmMigration).toContain('helm.sh/hook: pre-upgrade');
    expect(helmMigration).toContain('set -eu');
    expect(helmMigration).not.toContain('pre-install,pre-upgrade');
    const entrypoint = read('docker-entrypoint.sh');
    expect(entrypoint).toMatch(
      /OPSKNIGHT_SKIP_MIGRATIONS[\s\S]*scripts\/wait-for-database-ready\.cjs[\s\S]*exec node server\.js/
    );
    expect(entrypoint).toContain('Refusing to start application processes');
    expect(read('scripts/wait-for-database-ready.cjs')).toContain(
      'Database migrations and required online indexes are ready.'
    );
    const validation = read('.github/workflows/deployment-validation.yml');
    expect(validation).toContain('--is-upgrade');
    expect(validation).toContain('opsknight-helm-migration-upgrade-job.yaml');
  });

  it('allows LEGACY runtimes to become ready without the optional SLA scheduler index', async () => {
    const readiness = require('../../scripts/wait-for-database-ready.cjs') as {
      REQUIRED_INDEXES: string[];
      readinessProblem: (
        prisma: { $queryRawUnsafe: ReturnType<typeof vi.fn> },
        expectedMigrations: string[]
      ) => Promise<string | null>;
    };
    const expectedMigrations = ['20260101000000_initial'];
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          migration_name: expectedMigrations[0],
          finished_at: new Date(),
          rolled_back_at: null,
        },
      ])
      .mockResolvedValueOnce(readiness.REQUIRED_INDEXES.map(name => ({ name, valid: true })));

    expect(readiness.REQUIRED_INDEXES).not.toContain('idx_incident_next_sla_transition');
    await expect(
      readiness.readinessProblem({ $queryRawUnsafe: query }, expectedMigrations)
    ).resolves.toBeNull();
  });

  it('does not allocate an unused standalone postgres PVC', () => {
    expect(read('deploy/kubernetes/kustomize/base/kustomization.yaml')).not.toContain(
      'postgres-pvc.yaml'
    );
    expect(
      fs.existsSync(path.join(root, 'deploy/kubernetes/kustomize/base/postgres-pvc.yaml'))
    ).toBe(false);
  });

  it('supports explicit database URL overrides for Compose and Helm', () => {
    expect(read('deploy/compose/docker-compose.yml')).toContain('OPSKNIGHT_DATABASE_URL');
    const external = read('deploy/compose/docker-compose.external-db.yml');
    expect(external).toContain('depends_on: !reset {}');
    expect(external).toContain('profiles:');
    expect(read('deploy/kubernetes/helm/opsknight/values.yaml')).toContain('database:\n  url:');
    expect(read('deploy/kubernetes/helm/opsknight/templates/secret.yaml')).toContain(
      '.Values.secrets.keys.databaseUrl'
    );
    expect(read('deploy/kubernetes/helm/opsknight/values.yaml')).toContain(
      'directDatabaseUrl: DIRECT_DATABASE_URL'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/migration-job.yaml')).toContain(
      'key: {{ .Values.secrets.keys.directDatabaseUrl }}'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/migration-job.yaml')).toContain(
      'create-sla-scheduler-online-index.cjs'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml')).toContain(
      'key: {{ $root.Values.secrets.keys.directDatabaseUrl }}'
    );
  });

  it('models every split-runtime ownership lane in Helm and Kustomize', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helmDeployments = read(
      'deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml'
    );
    const rawDeployments = read(
      'deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml'
    );
    for (const role of [
      'web',
      'scheduler',
      'general-worker',
      'critical-worker',
      'bulk-worker',
      'status-projector',
    ]) {
      expect(helmDeployments).toContain(`"${role}"`);
      expect(rawDeployments).toContain(`opsknight-${role}`);
    }
    expect(values).toContain('profile: maintenance');
    expect(rawDeployments).toContain('OPSKNIGHT_SCHEDULER_PROFILE, value: maintenance');
    expect(read('deploy/kubernetes/helm/opsknight/templates/service.yaml')).toContain(
      'app.kubernetes.io/component: web'
    );
    expect(read('deploy/kubernetes/kustomize/profiles/split/web-service.yaml')).toContain(
      'opsknight-role: web'
    );
    expect(rawDeployments).toContain('opsknight:split-runtime-image-required');
    expect(rawDeployments).not.toContain('opsknight:1.4.0-hotfix');
    expect(helmDeployments).toContain('requires an explicit image.tag or image.digest');
    expect(helmDeployments).toContain('requires scheduler.profile=maintenance');
    expect(read('deploy/kubernetes/kustomize/profiles/split/kustomization.yaml')).not.toContain(
      'web-hpa.yaml'
    );
    expect(helmDeployments).toContain('$root.Values.podAnnotations');
    expect(helmDeployments).toContain('PROMETHEUS_SCRAPE_TOKEN');
    expect(helmDeployments).toContain('$root.Values.metrics.scrapeTokenSecret.existingSecret');
    expect(helmDeployments).toContain('whenUnsatisfiable: DoNotSchedule');
    expect(read('deploy/kubernetes/helm/opsknight/templates/pgbouncer-deployment.yaml')).toContain(
      'whenUnsatisfiable: DoNotSchedule'
    );
  });

  it('keeps all runtime deployment artifacts consolidated under deploy/', () => {
    const script = path.join(root, 'deploy/scripts/check-layout.cjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Deployment layout check passed.');

    const integratedKustomization = read(
      'deploy/kubernetes/kustomize/profiles/integrated/kustomization.yaml'
    );
    expect(integratedKustomization).toContain('../../base');
    expect(integratedKustomization).toContain('deployment.yaml');
    expect(integratedKustomization).not.toContain('hpa.yaml');
    expect(
      fs.existsSync(path.join(root, 'deploy/kubernetes/kustomize/profiles/integrated/hpa.yaml'))
    ).toBe(true);
  });

  it('keeps PgBouncer optional and separates web runtime from migration traffic', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helmPgBouncer = read(
      'deploy/kubernetes/helm/opsknight/templates/pgbouncer-configmap.yaml'
    );
    const rawWebPatch = read(
      'deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml'
    );
    const overlay = read('deploy/kubernetes/kustomize/profiles/split-pgbouncer/kustomization.yaml');
    const rawNetworkPolicy = read(
      'deploy/kubernetes/kustomize/profiles/split-pgbouncer/pgbouncer-network-policy.yaml'
    );
    expect(values).toContain('pgbouncer:\n  enabled: false');
    expect(helmPgBouncer).toContain('pool_mode = {{ .Values.pgbouncer.poolMode }}');
    expect(read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml')).toContain(
      '(eq $role.name "web") $root.Values.pgbouncer.enabled'
    );
    expect(rawWebPatch).toContain('key: WEB_DATABASE_URL');
    expect(rawWebPatch).toContain('DIRECT_DATABASE_URL');
    expect(rawWebPatch).toContain('key: DIRECT_DATABASE_URL');
    expect(read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml')).toContain(
      'name: DIRECT_DATABASE_URL'
    );
    expect(overlay).toContain('path: /spec/egress/0');
    expect(overlay).toContain('app: opsknight-pgbouncer');
    expect(overlay).toContain('port: 6432');
    expect(overlay).toContain('path: /spec/egress/1');
    expect(overlay).toContain('port: 5432');
    expect(overlay).not.toContain('web-pgbouncer-egress.yaml');
    expect(rawNetworkPolicy).toContain('port: 53');
    expect(rawNetworkPolicy).toContain('port: 5432');
    expect(
      read('deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml')
    ).not.toContain('@opsknight-pgbouncer:6432');
    expect(read('deploy/kubernetes/helm/opsknight/templates/pgbouncer-deployment.yaml')).toContain(
      '/usr/bin/pg_isready'
    );
    expect(
      read('deploy/kubernetes/kustomize/profiles/split-pgbouncer/pgbouncer-deployment.yaml')
    ).toContain('/usr/bin/pg_isready');
    expect(read('docker-entrypoint.sh')).toContain('OPSKNIGHT_SKIP_MIGRATIONS');
    expect(read('deploy/kubernetes/helm/opsknight/templates/migration-job.yaml')).toContain(
      'helm.sh/hook'
    );
  });

  it('ships bounded split-runtime database pools and a strict Helm schema', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const schema = JSON.parse(read('deploy/kubernetes/helm/opsknight/values.schema.json')) as {
      properties: Record<string, { $ref?: string }>;
      definitions: Record<string, { additionalProperties?: boolean }>;
    };
    expect(schema.properties.web?.$ref).toBe('#/definitions/webRole');
    expect(schema.properties.scheduler?.$ref).toBe('#/definitions/schedulerRole');
    expect(schema.properties.generalWorker?.$ref).toBe('#/definitions/workerRole');
    expect(schema.properties.criticalWorker?.$ref).toBe('#/definitions/workerRole');
    expect(schema.properties.bulkWorker?.$ref).toBe('#/definitions/workerRole');
    expect(schema.properties.statusProjector?.$ref).toBe('#/definitions/workerRole');
    expect(schema.properties.pgbouncer?.$ref).toBe('#/definitions/pgbouncer');
    expect(schema.definitions.webRole?.additionalProperties).toBe(false);
    expect(schema.definitions.schedulerRole?.additionalProperties).toBe(false);
    expect(schema.definitions.workerRole?.additionalProperties).toBe(false);
    expect(schema.definitions.pgbouncer?.additionalProperties).toBe(false);
    expect(values).toContain('defaultPoolSize: 10');
    expect(values).toContain('reservePoolSize: 5');
    expect(values).toContain('externalDatabaseCIDRs: []');
  });

  it('supports digest-pinned images, external Secrets, and configuration rollouts in Helm', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helpers = read('deploy/kubernetes/helm/opsknight/templates/_helpers.tpl');
    const deployment = read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml');
    expect(values).toContain("digest: ''");
    expect(values).toContain("existingSecret: ''");
    expect(helpers).toContain('printf "%s@%s"');
    expect(deployment).toContain('include "opsknight.image"');
    expect(deployment).toContain('checksum/config:');
    expect(deployment).toContain('checksum/secret:');
    expect(deployment).toContain('include "opsknight.secretName"');
  });

  it('ships an enterprise high-availability baseline and guarded recovery drills', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const deployment = read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml');
    const enterprise = read('deploy/kubernetes/helm/opsknight/examples/values-enterprise-ha.yaml');
    const failover = read('deploy/scripts/drills/verify-k8s-failover.sh');
    const restore = read('deploy/scripts/drills/verify-backup-restore.sh');

    expect(values).toContain('topologySpreadConstraints:');
    expect(deployment).toContain('maxUnavailable: 0');
    expect(deployment).toContain('terminationGracePeriodSeconds:');
    expect(enterprise).toContain('replicaCount: 3');
    expect(enterprise).toContain('minAvailable: 2');
    expect(enterprise).toContain('enabled: false');
    expect(failover).toContain('CONFIRM_OPSKNIGHT_CHAOS');
    expect(failover).toContain('ready_before < 2');
    expect(restore).toContain('opsknight-restore-drill-');
    expect(restore).toContain('trap cleanup EXIT');
  });

  it('preserves the existing postgres Service cluster-IP mode for upgrade safety', () => {
    expect(read('deploy/kubernetes/kustomize/base/postgres-service.yaml')).not.toContain(
      'clusterIP: None'
    );
    expect(read('deploy/kubernetes/helm/opsknight/templates/postgres-service.yaml')).not.toContain(
      'clusterIP: None'
    );
  });

  it('keeps Compose host-safe and project-safe by default', () => {
    const compose = read('deploy/compose/docker-compose.yml');
    expect(compose).toContain('127.0.0.1:${POSTGRES_PORT:-5432}:5432');
    expect(compose).not.toContain('container_name:');
    expect(compose).not.toContain('com.docker.network.bridge.name');
  });

  it('keeps main builds fast and publishes multi-arch tagged releases with attestations', () => {
    const workflow = read('.github/workflows/docker-image.yml');
    const workflowConfig = YAML.parse(workflow) as {
      jobs: Record<string, { needs?: string | string[]; if?: string }>;
    };
    const needsFor = (job: string) => {
      const needs = Reflect.get(workflowConfig.jobs, job).needs;
      return Array.isArray(needs) ? needs : needs ? [needs] : [];
    };
    const mainBuild = workflow.slice(
      workflow.indexOf('- name: Build + push (test channel - main)'),
      workflow.indexOf('- name: Build + push (release channel - version tag)')
    );
    const releaseBuild = workflow.slice(
      workflow.indexOf('- name: Build + push (release channel - version tag)')
    );
    expect(workflow).toContain(
      "if: startsWith(github.ref, 'refs/tags/v')\n        uses: docker/setup-qemu-action@v4"
    );
    expect(mainBuild).toContain('platforms: linux/amd64');
    expect(mainBuild).toContain('provenance: false');
    expect(mainBuild).toContain('sbom: false');
    expect(releaseBuild).toContain('platforms: linux/amd64,linux/arm64');
    expect(releaseBuild).toContain('provenance: mode=max');
    expect(releaseBuild).toContain('sbom: true');
    expect(workflow).toContain('scripts/validate-release-tag.cjs');
    expect(workflow).toContain('make_latest="$make_latest"');
    expect(workflow).toContain('releases/latest" --jq .tag_name');
    expect(workflow).toContain('release-quality:');
    expect(needsFor('release-quality')).toEqual(['validate-release-tag']);
    expect(needsFor('integration-certification')).toEqual(['validate-release-tag']);
    expect(needsFor('build')).toEqual(['release-quality', 'integration-certification']);
    expect(Reflect.has(workflowConfig.jobs, 'release-documentation')).toBe(false);
    expect(needsFor('sbom-provenance')).toEqual(['build']);
    expect(needsFor('pgbouncer-image')).toEqual(['sbom-provenance']);
    expect(needsFor('promote-release-tags')).toEqual(
      expect.arrayContaining(['build', 'pgbouncer-image'])
    );
    expect(needsFor('publish-github-release')).toEqual(
      expect.arrayContaining([
        'build',
        'sbom-provenance',
        'pgbouncer-image',
        'promote-release-tags',
      ])
    );
    expect(workflowConfig.jobs.build.if).toContain("needs.release-quality.result == 'success'");
    expect(workflowConfig.jobs.build.if).toContain(
      "needs.integration-certification.result == 'success'"
    );
    expect(workflowConfig.jobs.build.if).not.toContain('always()');
    expect(workflowConfig.jobs['publish-github-release'].if).toContain(
      "needs.promote-release-tags.result == 'success'"
    );
    expect(workflowConfig.jobs['publish-github-release'].if).not.toContain('always()');
    expect(workflow).toContain('type=raw,value=rc-${{ github.sha }}');
    expect(workflow).toContain("['buildx', 'imagetools', 'inspect', ref, '--format', format]");
    expect(workflow).toContain("inspectJson('SBOM', '{{ json .SBOM }}')");
    expect(workflow).toContain("inspectJson('Provenance', '{{ json .Provenance }}')");
    expect(workflow).toContain('docker buildx imagetools create -t "$tag" "$source_ref"');
    expect(workflow).toContain('test "$promoted_digest" = "$RELEASE_IMAGE_DIGEST"');
    expect(workflow).toContain(
      'summary.releaseImageIndexDigest = process.env.RELEASE_IMAGE_DIGEST'
    );
    expect(workflow).toContain('pgbouncerImageDigest');
    expect(workflow).toContain('Upgrade from previous stable release');
    expect(workflow).toContain('Backup and restore contract');
    expect(workflow).toContain('docker exec "$POSTGRES_CONTAINER" pg_dump');
    expect(workflow).toContain('POSTGRES_CONTAINER="${{ job.services.postgres.id }}"');
    expect(workflow).toContain('Event, escalation, and notification contract');
    expect(workflow).not.toContain('ALLOW_INSECURE_SECRETS');
    expect(workflow).toContain('export NEXTAUTH_SECRET="$(openssl rand -base64 48)"');
    expect(workflow).toContain('export API_KEY_SECRET="$(openssl rand -base64 48)"');
    expect(workflow).toContain('export ENCRYPTION_KEY="$(openssl rand -hex 32)"');
    expect(workflow).toContain('export ENCRYPTION_KEYS="ci:$(openssl rand -hex 32)"');
    expect(workflow).toContain('EXT_DB_PASSWORD="$(openssl rand -hex 24)"');
  });

  it('keeps documentation capability coverage in CI', () => {
    expect(read('package.json')).toContain('scripts/check-docs-capabilities.cjs');
    expect(read('.github/workflows/docs-links.yml')).toContain('npm run docs:certify:static');
    expect(read('scripts/docs/certify.mjs')).toContain('scripts/check-docs-capabilities.cjs');
    expect(read('docs/RELEASE_QUALITY_CONTRACT.md')).toContain(
      'Upgrade from the previous stable release'
    );
  });

  it('validates the 2.0 license boundary from authoritative release artifacts', () => {
    const workflow = read('.github/workflows/docker-image.yml');
    expect(workflow).toContain("require('./package.json').license");
    expect(workflow).toContain('LICENSE-TRANSITION.md');
    expect(workflow).toContain('LICENSES/Apache-2.0.txt');
    expect(workflow).toContain('OpsKnight 2.0.0 is the first stable release distributed under');
    expect(workflow).not.toContain("grep -q 'AGPL-3.0-only' docs/v1.5/licensing.md");
  });

  it('reports non-gating security scan findings as skipped in the PR summary', () => {
    const { sanitizeSecurityJunitContent } = require(
      path.join(root, 'scripts/ci/sanitize-security-junit.cjs')
    ) as {
      sanitizeSecurityJunitContent: (xml: string) => { content: string; converted: number };
    };
    const securityWorkflow = read('.github/workflows/security.yml');
    const junit = [
      '<?xml version="1.0"?>',
      '<testsuites tests="1" failures="1">',
      '  <testsuite name="Checkov" tests="1" failures="1">',
      '    <testcase name="CKV_NON_GATING" classname="checkov">',
      '      <failure message="policy finding">details</failure>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');

    const sanitized = sanitizeSecurityJunitContent(junit);

    expect(securityWorkflow).toContain('scripts/ci/sanitize-security-junit.cjs');
    expect(sanitized.converted).toBe(1);
    expect(sanitized.content).toContain('failures="0"');
    expect(sanitized.content).toContain('errors="0"');
    expect(sanitized.content).toContain('skipped="1"');
    expect(sanitized.content).toContain(
      '<skipped message="Advisory (non-gating) security finding: policy finding">'
    );
    expect(sanitized.content).not.toContain('<failure');
  });

  it('keeps integration certification seeded secrets encrypted with the compose key', () => {
    const workflow = read('.github/workflows/integration-certification.yml');
    const compose = read('tests/certification/docker-compose.yml');

    expect(compose).toMatch(/ENCRYPTION_KEY:\s*[0-9a-f]{64}/);
    expect(compose).not.toContain('ALLOW_INSECURE_SECRETS');
    expect(workflow).toContain("fs.readFileSync('tests/certification/docker-compose.yml', 'utf8')");
    expect(workflow).toContain('CERTIFICATION_ENCRYPTION_KEY');
    expect(workflow).not.toContain(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    );
  });

  it('keeps documentation quality manual-only while its checks are being improved', () => {
    const workflow = read('.github/workflows/docs-links.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s{2}(pull_request|push):/m);
  });

  it('certifies a single migration owner before multi-replica startup', () => {
    const workflow = read('.github/workflows/integration-certification.yml');
    const compose = read('tests/certification/docker-compose.yml');

    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain(
      'Run one migration owner, then start three web and three worker replicas'
    );
    expect(workflow).toContain('incident-meeting-concurrency.test.ts');
    expect(compose).toContain('migration:');
    expect(compose).toContain("OPSKNIGHT_MIGRATION_ONLY: 'true'");
    expect(compose.match(/OPSKNIGHT_SKIP_MIGRATIONS: 'true'/g)).toHaveLength(2);
    expect(compose.match(/condition: service_completed_successfully/g)).toHaveLength(2);
  });

  it('accepts matching release tags while keeping only stable tags latest-eligible', () => {
    const script = path.join(root, 'scripts/validate-release-tag.cjs');
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const releaseTag = `v${pkg.version}`;
    const valid = spawnSync(process.execPath, [script, releaseTag], {
      cwd: root,
      env: { ...process.env, LATEST_RELEASE_TAG: 'v1.4.0' },
      encoding: 'utf8',
    });
    expect(valid.status).toBe(0);

    const validPrerelease = spawnSync(process.execPath, [script, `${releaseTag}-rc.1`], {
      cwd: root,
      env: { ...process.env, LATEST_RELEASE_TAG: 'v1.4.0' },
      encoding: 'utf8',
    });
    expect(validPrerelease.status).toBe(0);
    expect(read('.github/workflows/docker-image.yml')).toContain('prerelease=true');
    expect(read('.github/workflows/docker-image.yml')).toContain('make_latest=false');

    for (const [tag, latest] of [
      ['v1.4.0', 'v1.3.1'],
      [releaseTag, releaseTag],
    ]) {
      const invalid = spawnSync(process.execPath, [script, tag], {
        cwd: root,
        env: { ...process.env, LATEST_RELEASE_TAG: latest },
        encoding: 'utf8',
      });
      expect(invalid.status).not.toBe(0);
    }
  });

  it('uses only the canonical lowercase GHCR image repositories', () => {
    const files = [
      'README.md',
      'CHANGELOG.md',
      'deploy/compose/docker-compose.yml',
      'env.example',
      'deploy/kubernetes/helm/opsknight/values.yaml',
      'deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml',
      'docs/v1/deployment/README.md',
      'docs/v1.1/deployment/README.md',
      'docs/v1.2/deployment/README.md',
      'docs/v1.3/deployment/docker.md',
      'docs/v1.3/deployment/helm.md',
    ];
    const content = files.map(read).join('\n');
    expect(content).not.toMatch(/ghcr\.io\/opsknight-labs\/OpsKnight/);
    expect(content).not.toMatch(/(?:^|\s)opsknight\/opsknight:/);
  });

  it('ships complete split-runtime and PgBouncer Docker Compose overlays', () => {
    const split = read('deploy/compose/docker-compose.split.yml');
    const pgbouncer = read('deploy/compose/docker-compose.pgbouncer.yml');
    const external = read('deploy/compose/docker-compose.external-db.yml');
    const entrypoint = read('docker-entrypoint.sh');

    // Split services and profile isolation
    expect(split).toContain('opsknight-app:\n    profiles:\n      - integrated-runtime');
    expect(split).toContain('opsknight-migration:');
    expect(split).toContain('opsknight-web:');
    expect(split).toContain('opsknight-scheduler:');
    expect(split).toContain('opsknight-general-worker:');
    expect(split).toContain('opsknight-critical-worker:');
    expect(split).toContain('opsknight-bulk-worker:');
    expect(split).toContain('opsknight-runbook-worker:');
    expect(split).toContain('opsknight-status-projector:');

    // Host port isolation: ONLY web publishes port 3000
    expect(split).toMatch(/opsknight-web:[\s\S]*?ports:\s*-\s*'\$\{APP_PORT:-3000\}:3000'/);
    expect(split).not.toMatch(/opsknight-scheduler:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-general-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-critical-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-bulk-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-runbook-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-status-projector:[\s\S]*?ports:/);

    // Security hardening
    expect(split).toContain('no-new-privileges:true');
    expect(split).toContain('cap_drop:\n      - ALL');
    expect(pgbouncer).toContain('no-new-privileges:true');

    // Split Compose requires explicit compatible release image
    expect(split).toContain(
      '${OPSKNIGHT_IMAGE:?Set OPSKNIGHT_IMAGE to a tested release image with split-runtime support'
    );

    // PgBouncer 1.26.0 security update and dynamic entrypoint
    expect(pgbouncer).toContain(
      'ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75'
    );
    expect(pgbouncer).toContain('../images/pgbouncer/entrypoint.sh:/docker-entrypoint.sh:ro');
    expect(pgbouncer).toContain('/usr/bin/psql -h 127.0.0.1 -p 6432');
    expect(pgbouncer).toContain('SELECT 1');
    expect(pgbouncer).toContain(
      '@opsknight-pgbouncer:6432/${PGBOUNCER_DB_NAME:-${POSTGRES_DB:-opsknight_db}}?sslmode=disable&pgbouncer=true'
    );
    expect(pgbouncer).toContain('DIRECT_DATABASE_URL:');
    expect(split).toContain(
      'DATABASE_URL: ${DIRECT_DATABASE_URL:-${OPSKNIGHT_DATABASE_URL:-postgresql://'
    );

    // Helm PgBouncer aligns on 1.26.0 security update
    const helm = read('deploy/kubernetes/helm/opsknight/values.yaml');
    expect(helm).toContain("tag: '1.26.0'");
    expect(helm).toContain(
      "digest: 'sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75'"
    );

    // Dedicated one-shot migration contract
    expect(entrypoint).toContain('OPSKNIGHT_MIGRATION_ONLY');
    expect(split).toContain("OPSKNIGHT_MIGRATION_ONLY: 'true'");
    expect(split).toContain('condition: service_completed_successfully');

    // External DB overlay disables bundled database cleanly without injecting PgBouncer into non-pooled topologies
    expect(external).toContain('profiles:\n      - bundled-database');
    expect(external).not.toContain('opsknight-pgbouncer');

    // Deployment READMEs and runbooks must not use pre-split 1.4.0 image for split runtime or bare docker compose commands
    const k8sReadme = read('deploy/kubernetes/README.md');
    const composeReadme = read('deploy/compose/README.md');
    const dockerDoc = read('docs/v1.5/deployment/docker.md');
    const contributing = read('CONTRIBUTING.md');
    const composeDev = read('deploy/compose/docker-compose.dev.yml');
    expect(k8sReadme).not.toContain('image.tag=1.4.0');
    expect(composeReadme).not.toContain('opsknight:1.4.0');
    expect(dockerDoc).not.toMatch(
      /^docker compose (?:exec|stop|start|pull|up|ps|logs|restart|down)\b/m
    );
    expect(composeDev).toContain('  opsknight-db:');
    expect(contributing).toContain(
      'docker compose -f deploy/compose/docker-compose.dev.yml up -d opsknight-db'
    );
    expect(contributing).not.toContain('up -d postgres');

    // Keep Kustomize split-pgbouncer web-database-patch aligned with base split web container hardening
    const splitDeployments = read(
      'deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml'
    );
    const webPatch = read(
      'deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml'
    );
    expect(webPatch).toContain(
      'image: ghcr.io/opsknight-labs/opsknight:split-runtime-image-required'
    );
    expect(splitDeployments).toContain(
      'image: ghcr.io/opsknight-labs/opsknight:split-runtime-image-required'
    );
    expect(webPatch).toContain('runAsUser: 1001');
    expect(webPatch).toContain('readOnlyRootFilesystem: true');
    expect(webPatch).toContain("path: '/api/health?mode=readiness'");
  });

  it('validates runtime database connection capacity budgets across topologies', () => {
    // Default split capacity within budget
    const defaultSplit = calculateRuntimeCapacity({ OPSKNIGHT_RUNTIME_MODE: 'split' });
    expect(defaultSplit.safe).toBe(true);
    expect(defaultSplit.totalDemand).toBe(32);
    expect(defaultSplit.headroom).toBe(48);

    // Integrated mode accounts for webReplicas * webPool
    const singleIntegrated = calculateRuntimeCapacity({ OPSKNIGHT_RUNTIME_MODE: 'integrated' });
    expect(singleIntegrated.safe).toBe(true);
    expect(singleIntegrated.totalDemand).toBe(10);
    expect(singleIntegrated.headroom).toBe(70);

    const multiIntegrated = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'integrated',
      WEB_REPLICAS: '3',
      DATABASE_POOL_SIZE_WEB: '10',
    });
    expect(multiIntegrated.safe).toBe(true);
    expect(multiIntegrated.totalDemand).toBe(30);
    expect(multiIntegrated.headroom).toBe(50);

    // Overflow budget triggers failure
    const overflow = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'split',
      DATABASE_MAX_CONNECTIONS: '25',
    });
    expect(overflow.safe).toBe(false);
    expect(overflow.headroom).toBe(-7);

    // PgBouncer bounds web connection demand
    const pgbouncerBounded = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'split',
      PGBOUNCER_ENABLED: 'true',
      WEB_REPLICAS: '12',
      PGBOUNCER_DEFAULT_POOL_SIZE: '10',
      PGBOUNCER_RESERVE_POOL_SIZE: '5',
      DATABASE_MAX_CONNECTIONS: '80',
    });
    expect(pgbouncerBounded.safe).toBe(true);
    expect(pgbouncerBounded.webConnections).toBe(15);
    expect(pgbouncerBounded.totalDemand).toBe(37);

    // Fail-closed input handling: reject malformed numbers, booleans, negative counts
    expect(() => calculateRuntimeCapacity({ WEB_REPLICAS: '100foo' })).toThrow(
      /not a valid non-negative integer/
    );
    expect(() => calculateRuntimeCapacity({ PGBOUNCER_ENABLED: 'invalid_bool' })).toThrow(
      /not a recognized boolean/
    );
    expect(() => calculateRuntimeCapacity({ DATABASE_POOL_SIZE_WEB: '-5' })).toThrow();

    // Consumes actual .env configuration via loadDotenvIfPresent and CLI
    const tempEnv = path.join(root, 'node_modules/.tmp-test.env');
    fs.mkdirSync(path.dirname(tempEnv), { recursive: true });
    fs.writeFileSync(tempEnv, 'DATABASE_MAX_CONNECTIONS=20\nOPSKNIGHT_RUNTIME_MODE=split\n');
    try {
      const cliScript = path.join(root, 'deploy/scripts/validate-runtime-capacity.cjs');
      const cliResult = spawnSync(process.execPath, [cliScript], {
        cwd: root,
        env: {
          ...process.env,
          DOTENV_CONFIG_PATH: tempEnv,
          DATABASE_MAX_CONNECTIONS: undefined,
          OPSKNIGHT_RUNTIME_MODE: undefined,
        },
        encoding: 'utf8',
      });
      expect(cliResult.status).toBe(1);
      expect(cliResult.stderr).toContain('FATAL CAPACITY MISMATCH');
    } finally {
      if (fs.existsSync(tempEnv)) {
        fs.unlinkSync(tempEnv);
      }
    }
  });

  it('enforces redundant 2-replica HA worker defaults and safe connection budgets for Swarm', () => {
    const stack = read('deploy/swarm/docker-stack.yml');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_WEB:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_SCHEDULER:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_GENERAL_WORKER:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_CRITICAL_WORKER:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_BULK_WORKER:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_RUNBOOK_WORKER:-2}');
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_STATUS_PROJECTOR:-2}');

    // HA Swarm capacity preflight without PgBouncer (2 replicas each)
    const swarmHa = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'split',
      SWARM_REPLICAS_WEB: '2',
      SWARM_REPLICAS_SCHEDULER: '2',
      SWARM_REPLICAS_GENERAL_WORKER: '2',
      SWARM_REPLICAS_CRITICAL_WORKER: '2',
      SWARM_REPLICAS_BULK_WORKER: '2',
      SWARM_REPLICAS_RUNBOOK_WORKER: '2',
      SWARM_REPLICAS_STATUS_PROJECTOR: '2',
    });
    expect(swarmHa.safe).toBe(true);
    expect(swarmHa.totalDemand).toBe(64);
    expect(swarmHa.headroom).toBe(16);

    // HA Swarm capacity preflight with PgBouncer (2 replicas each)
    const swarmHaPgBouncer = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'split',
      PGBOUNCER_ENABLED: 'true',
      SWARM_REPLICAS_WEB: '2',
      SWARM_REPLICAS_PGBOUNCER: '2',
      SWARM_REPLICAS_SCHEDULER: '2',
      SWARM_REPLICAS_GENERAL_WORKER: '2',
      SWARM_REPLICAS_CRITICAL_WORKER: '2',
      SWARM_REPLICAS_BULK_WORKER: '2',
      SWARM_REPLICAS_RUNBOOK_WORKER: '2',
      SWARM_REPLICAS_STATUS_PROJECTOR: '2',
    });
    expect(swarmHaPgBouncer.safe).toBe(true);
    expect(swarmHaPgBouncer.totalDemand).toBe(74);
    expect(swarmHaPgBouncer.headroom).toBe(6);

    // Swarm deploy.sh enforces fail-closed split image contract
    const deployScript = read('deploy/swarm/scripts/deploy.sh');
    expect(deployScript).toContain('SWARM_RUNTIME_MODE=split requires an explicit OPSKNIGHT_IMAGE');

    // Swarm docker-stack.yml enforces fail-closed split image contract directly against raw stack deploys
    expect(stack).toContain(
      '${OPSKNIGHT_IMAGE:?Set OPSKNIGHT_IMAGE to an explicit release image or immutable digest with split runtime support}'
    );

    // Kustomize external database CIDR patch provides targeted egress for split workers
    const cidrPatch = read(
      'deploy/kubernetes/kustomize/profiles/split/external-database-cidr-patch.yaml'
    );
    expect(cidrPatch).toContain('kind: NetworkPolicy');
    expect(cidrPatch).toContain('cidr: 10.24.0.0/16');
    expect(cidrPatch).toContain('opsknight-scheduler-network-policy');
    expect(cidrPatch).toContain('opsknight-general-worker-network-policy');
    expect(cidrPatch).toContain('opsknight-runbook-worker-network-policy');
  });

  it('packages the outbound Runbook Agent across deployment methods', () => {
    const compose = read('deploy/compose/docker-compose.agent.yml');
    const swarm = read('deploy/swarm/docker-stack.agent.yml');
    const helm = read('deploy/kubernetes/helm/opsknight/templates/agent.yaml');
    const kustomize = read('deploy/kubernetes/kustomize/components/agent/deployment.yaml');
    for (const artifact of [compose, swarm, helm, kustomize]) {
      expect(artifact).toContain('OPSKNIGHT_URL');
      expect(artifact).toContain('/var/lib/opsknight-agent');
      expect(artifact).toContain('policy.json');
    }
    expect(compose).toContain('OPSKNIGHT_AGENT_ENROLLMENT_TOKEN');
    expect(compose).toContain('read_only: true');
    expect(swarm).toContain('OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE');
    expect(swarm).toContain('read_only: true');
    expect(helm).toContain('agent.enrollmentToken.existingSecret is required');
    expect(helm).toContain('agent.networkPolicy.kubernetesApiCIDRs');
    expect(helm).toContain('seccompProfile:');
    expect(kustomize).toContain('readOnlyRootFilesystem: true');
    expect(kustomize).toContain('seccompProfile: { type: RuntimeDefault }');
    expect(read('deploy/kubernetes/kustomize/components/agent/kustomization.yaml')).not.toContain(
      'REPLACE_WITH_SINGLE_USE_TOKEN'
    );
    expect(read('deploy/kubernetes/kustomize/components/agent/network-policy.yaml')).not.toContain(
      'port: 443'
    );
    const setupUi = read('src/components/runbooks/AgentSetupInstructions.tsx');
    for (const method of ['Compose', 'Swarm', 'Helm', 'Kustomize', 'Linux']) {
      expect(setupUi).toContain(`>${method}<`);
    }
    expect(setupUi).toContain('OPSKNIGHT_AGENT_ENROLLMENT_TOKEN');
    expect(setupUi).toContain('OPSKNIGHT_AGENT_POLICY_PATH');
    expect(read('agent/Dockerfile')).toContain('USER opsknight-agent');
    expect(read('agent/Dockerfile')).toMatch(/apk add --no-cache[^\n]*\bbash\b/);
  });
});
