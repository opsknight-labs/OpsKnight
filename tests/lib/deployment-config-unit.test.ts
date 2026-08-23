import fs from 'node:fs';
import path from 'node:path';
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

  it('uses portable namespace labels and permits external postgres egress', () => {
    const raw = read('k8s/network-policy.yaml');
    const helm = read('helm/opsknight/templates/networkpolicy.yaml');
    expect(raw).toContain('kubernetes.io/metadata.name: ingress-nginx');
    expect(helm).toContain('ingressNamespaceLabels');
    expect(raw).toContain('port: 5432');
    expect(helm).toContain('.Values.postgresql.port');
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
  });

  it('does not allocate an unused standalone postgres PVC', () => {
    expect(read('k8s/kustomization.yaml')).not.toContain('postgres-pvc.yaml');
    expect(fs.existsSync(path.join(root, 'k8s/postgres-pvc.yaml'))).toBe(false);
  });

  it('supports explicit database URL overrides for Compose and Helm', () => {
    expect(read('docker-compose.yml')).toContain('OPSKNIGHT_DATABASE_URL');
    expect(read('helm/opsknight/values.yaml')).toContain('database:\n  url:');
    expect(read('helm/opsknight/templates/secret.yaml')).toContain('DATABASE_URL:');
  });
});
