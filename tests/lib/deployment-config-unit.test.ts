import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { calculateRuntimeCapacity } from '../../src/lib/runtime-capacity';

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- Deployment contract tests inspect a fixed repository-local file set. */

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

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
    expect(read('deploy/kubernetes/kustomize/base/configmap.yaml')).toContain('NEXT_PUBLIC_APP_URL');
    expect(read('deploy/kubernetes/helm/opsknight/templates/configmap.yaml')).toContain(
      'NEXT_PUBLIC_APP_URL'
    );
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
    expect(entrypoint).toContain(
      'Refusing to start without required indexes'
    );
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
  });

  it('models every split-runtime ownership lane in Helm and Kustomize', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helmDeployments = read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml');
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
    expect(
      read('deploy/kubernetes/helm/opsknight/templates/pgbouncer-deployment.yaml')
    ).toContain('whenUnsatisfiable: DoNotSchedule');
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
    expect(integratedKustomization).toContain('hpa.yaml');
  });

  it('keeps PgBouncer optional and separates web runtime from migration traffic', () => {
    const values = read('deploy/kubernetes/helm/opsknight/values.yaml');
    const helmPgBouncer = read(
      'deploy/kubernetes/helm/opsknight/templates/pgbouncer-configmap.yaml'
    );
    const rawWebPatch = read(
      'deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml'
    );
    const overlay = read(
      'deploy/kubernetes/kustomize/profiles/split-pgbouncer/kustomization.yaml'
    );
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
    expect(
      read('deploy/kubernetes/helm/opsknight/templates/pgbouncer-deployment.yaml')
    ).toContain('/usr/bin/pg_isready');
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
    const schema = JSON.parse(
      read('deploy/kubernetes/helm/opsknight/values.schema.json')
    ) as {
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
    const enterprise = read(
      'deploy/kubernetes/helm/opsknight/examples/values-enterprise-ha.yaml'
    );
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
    expect(
      read('deploy/kubernetes/helm/opsknight/templates/postgres-service.yaml')
    ).not.toContain('clusterIP: None');
  });

  it('keeps Compose host-safe and project-safe by default', () => {
    const compose = read('deploy/compose/docker-compose.yml');
    expect(compose).toContain('127.0.0.1:${POSTGRES_PORT:-5432}:5432');
    expect(compose).not.toContain('container_name:');
    expect(compose).not.toContain('com.docker.network.bridge.name');
  });

  it('keeps main builds fast and publishes multi-arch tagged releases with attestations', () => {
    const workflow = read('.github/workflows/docker-image.yml');
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
    expect(workflow).toContain('release-quality:');
    expect(workflow).toContain('needs: release-quality');
    expect(workflow).toContain('Upgrade from previous stable release');
    expect(workflow).toContain('Backup and restore contract');
    expect(workflow).toContain('docker exec "$POSTGRES_CONTAINER" pg_dump');
    expect(workflow).toContain('POSTGRES_CONTAINER="${{ job.services.postgres.id }}"');
    expect(workflow).toContain('Event, escalation, and notification contract');
  });

  it('keeps documentation capability coverage in CI and the release gate', () => {
    expect(read('package.json')).toContain('scripts/check-docs-capabilities.cjs');
    expect(read('.github/workflows/docs-links.yml')).toContain(
      'node scripts/check-docs-capabilities.cjs'
    );
    expect(read('.github/workflows/docker-image.yml')).toContain('npm run docs:capabilities');
    expect(read('docs/RELEASE_QUALITY_CONTRACT.md')).toContain(
      'Upgrade from the previous stable release'
    );
  });

  it('only accepts a new stable release tag matching package.json', () => {
    const script = path.join(root, 'scripts/validate-release-tag.cjs');
    const valid = spawnSync(process.execPath, [script, 'v1.4.0'], {
      cwd: root,
      env: { ...process.env, LATEST_RELEASE_TAG: 'v1.3.1' },
      encoding: 'utf8',
    });
    expect(valid.status).toBe(0);

    for (const [tag, latest] of [
      ['v1.4.0-beta.1', 'v1.3.1'],
      ['v1.3.1', 'v1.3.0'],
      ['v1.4.0', 'v1.4.0'],
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
    expect(split).toContain('opsknight-status-projector:');

    // Host port isolation: ONLY web publishes port 3000
    expect(split).toMatch(/opsknight-web:[\s\S]*?ports:\s*-\s*'\$\{APP_PORT:-3000\}:3000'/);
    expect(split).not.toMatch(/opsknight-scheduler:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-general-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-critical-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-bulk-worker:[\s\S]*?ports:/);
    expect(split).not.toMatch(/opsknight-status-projector:[\s\S]*?ports:/);

    // Security hardening
    expect(split).toContain('no-new-privileges:true');
    expect(split).toContain('cap_drop:\n      - ALL');
    expect(pgbouncer).toContain('no-new-privileges:true');

    // Split Compose requires explicit compatible release image
    expect(split).toContain('${OPSKNIGHT_IMAGE:?Set OPSKNIGHT_IMAGE to a tested release image with split-runtime support');

    // PgBouncer 1.26.0 security update and dynamic entrypoint
    expect(pgbouncer).toContain('ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75');
    expect(pgbouncer).toContain('../images/pgbouncer/entrypoint.sh:/docker-entrypoint.sh:ro');
    expect(pgbouncer).toContain('/usr/bin/psql -h 127.0.0.1 -p 6432');
    expect(pgbouncer).toContain('SELECT 1');
    expect(pgbouncer).toContain('@opsknight-pgbouncer:6432/${PGBOUNCER_DB_NAME:-${POSTGRES_DB:-opsknight_db}}?sslmode=disable&pgbouncer=true');
    expect(pgbouncer).toContain('DIRECT_DATABASE_URL:');
    expect(split).toContain(
      'DATABASE_URL: ${DIRECT_DATABASE_URL:-${OPSKNIGHT_DATABASE_URL:-postgresql://'
    );

    // Helm PgBouncer aligns on 1.26.0 security update
    const helm = read('deploy/kubernetes/helm/opsknight/values.yaml');
    expect(helm).toContain("tag: '1.26.0'");
    expect(helm).toContain("digest: 'sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75'");

    // Dedicated one-shot migration contract
    expect(entrypoint).toContain('OPSKNIGHT_MIGRATION_ONLY');
    expect(split).toContain('OPSKNIGHT_MIGRATION_ONLY: "true"');
    expect(split).toContain('condition: service_completed_successfully');

    // External DB overlay disables bundled database cleanly
    expect(external).toContain('profiles:\n      - bundled-database');
  });

  it('validates runtime database connection capacity budgets across topologies', () => {
    // Default split capacity within budget
    const defaultSplit = calculateRuntimeCapacity({ OPSKNIGHT_RUNTIME_MODE: 'split' });
    expect(defaultSplit.safe).toBe(true);
    expect(defaultSplit.totalDemand).toBe(29);
    expect(defaultSplit.headroom).toBe(51);

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
    expect(overflow.headroom).toBe(-4);

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
    expect(pgbouncerBounded.totalDemand).toBe(34);

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
    expect(stack).toContain('replicas: ${SWARM_REPLICAS_STATUS_PROJECTOR:-2}');

    // HA Swarm capacity preflight without PgBouncer (2 replicas each)
    const swarmHa = calculateRuntimeCapacity({
      OPSKNIGHT_RUNTIME_MODE: 'split',
      SWARM_REPLICAS_WEB: '2',
      SWARM_REPLICAS_SCHEDULER: '2',
      SWARM_REPLICAS_GENERAL_WORKER: '2',
      SWARM_REPLICAS_CRITICAL_WORKER: '2',
      SWARM_REPLICAS_BULK_WORKER: '2',
      SWARM_REPLICAS_STATUS_PROJECTOR: '2',
    });
    expect(swarmHa.safe).toBe(true);
    expect(swarmHa.totalDemand).toBe(58);
    expect(swarmHa.headroom).toBe(22);

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
      SWARM_REPLICAS_STATUS_PROJECTOR: '2',
    });
    expect(swarmHaPgBouncer.safe).toBe(true);
    expect(swarmHaPgBouncer.totalDemand).toBe(68);
    expect(swarmHaPgBouncer.headroom).toBe(12);

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
  });
});

