import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('deployment configuration invariants', () => {
  it('keeps packaged deployment versions aligned with the application version', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const chart = read('helm/opsknight/Chart.yaml');
    const rawDeployment = read('k8s/deployment.yaml');
    expect(chart).toContain(`version: ${pkg.version}`);
    expect(chart).toContain(`appVersion: '${pkg.version}'`);
    expect(rawDeployment).toContain(`ghcr.io/opsknight-labs/opsknight:${pkg.version}`);
  });

  it('runs postgres:15-alpine with its uid/gid instead of uid 999', () => {
    const raw = read('k8s/postgres-statefulset.yaml');
    const helm = read('helm/opsknight/values.yaml');
    expect(raw).toContain('runAsUser: 70');
    expect(raw).toContain('runAsGroup: 70');
    expect(raw).not.toContain('runAsUser: 999');
    expect(helm).toContain('runAsUser: 70');
    expect(helm).not.toContain('runAsUser: 999');
  });

  it('does not ship the obsolete OpsSentinal postgres credentials', () => {
    const secret = read('k8s/secret.yaml');
    expect(secret).toContain('POSTGRES_USER: b3Bza25pZ2h0');
    expect(secret).not.toContain('T3BzU2VudGluYWw=');
    expect(secret).not.toContain('T3BzU2VudGluYWxfc2VjdXJlX3Bhc3N3b3JkX2NoYW5nZV9tZQ==');
  });

  it('uses portable network policies and isolates bundled postgres egress', () => {
    const raw = read('k8s/network-policy.yaml');
    const helm = read('helm/opsknight/templates/networkpolicy.yaml');
    expect(raw).toContain('kubernetes.io/metadata.name: ingress-nginx');
    expect(helm).toContain('ingressNamespaceLabels');
    expect(raw).toContain('port: 5432');
    expect(helm).toContain('.Values.database.port');
    expect(raw).toContain('PostgreSQL does not initiate network connections');
    expect(raw).toContain('egress: []');
    expect(helm).toContain('egress: []');
  });

  it('exposes the public app URL in Kubernetes and Helm', () => {
    expect(read('k8s/configmap.yaml')).toContain('NEXT_PUBLIC_APP_URL');
    expect(read('helm/opsknight/templates/configmap.yaml')).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('protects long migration starts and fails closed on migration failure', () => {
    expect(read('k8s/deployment.yaml')).toContain('startupProbe:');
    expect(read('helm/opsknight/templates/deployment.yaml')).toContain('startupProbe:');
    const entrypoint = read('docker-entrypoint.sh');
    expect(entrypoint).toContain('Refusing to start against an unknown database schema');
    expect(entrypoint).toMatch(/MIGRATION_SUCCESS=0[\s\S]*exit 1/);
    expect(entrypoint).toContain('scripts/dist/scripts/auto-recover-migrations.js');
    expect(read('package.json')).toContain(
      'scripts/auto-recover-migrations.ts --rootDir . --outDir scripts/dist'
    );
    expect(read('scripts/auto-recover-migrations.ts')).toContain('execFileSync');
    expect(read('scripts/auto-recover-migrations.ts')).not.toContain('execSync(');
  });

  it('does not allocate an unused standalone postgres PVC', () => {
    expect(read('k8s/kustomization.yaml')).not.toContain('postgres-pvc.yaml');
    expect(fs.existsSync(path.join(root, 'k8s/postgres-pvc.yaml'))).toBe(false);
  });

  it('supports explicit database URL overrides for Compose and Helm', () => {
    expect(read('docker-compose.yml')).toContain('OPSKNIGHT_DATABASE_URL');
    const external = read('docker-compose.external-db.yml');
    expect(external).toContain('depends_on: !reset {}');
    expect(external).toContain('profiles:');
    expect(read('helm/opsknight/values.yaml')).toContain('database:\n  url:');
    expect(read('helm/opsknight/templates/secret.yaml')).toContain(
      '.Values.secrets.keys.databaseUrl'
    );
  });

  it('supports digest-pinned images, external Secrets, and configuration rollouts in Helm', () => {
    const values = read('helm/opsknight/values.yaml');
    const helpers = read('helm/opsknight/templates/_helpers.tpl');
    const deployment = read('helm/opsknight/templates/deployment.yaml');
    expect(values).toContain("digest: ''");
    expect(values).toContain("existingSecret: ''");
    expect(helpers).toContain('printf "%s@%s"');
    expect(deployment).toContain('include "opsknight.image"');
    expect(deployment).toContain('checksum/config:');
    expect(deployment).toContain('checksum/secret:');
    expect(deployment).toContain('include "opsknight.secretName"');
  });

  it('preserves the existing postgres Service cluster-IP mode for upgrade safety', () => {
    expect(read('k8s/postgres-service.yaml')).not.toContain('clusterIP: None');
    expect(read('helm/opsknight/templates/postgres-service.yaml')).not.toContain('clusterIP: None');
  });

  it('keeps Compose host-safe and project-safe by default', () => {
    const compose = read('docker-compose.yml');
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
    expect(workflow).toMatch(
      /if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n\s+uses: docker\/setup-qemu-action@v[34]/
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
      'docker-compose.yml',
      'env.example',
      'helm/opsknight/values.yaml',
      'k8s/deployment.yaml',
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
});
