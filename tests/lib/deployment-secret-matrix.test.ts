import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

/* eslint-disable security/detect-non-literal-fs-filename -- Deployment matrix tests inspect a fixed repository-local file set. */
/* eslint-disable security/detect-object-injection -- Deployment fixture keys come from the fixed repository-local manifests under test. */

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const runtimeSecretEnv = [
  'NEXTAUTH_SECRET',
  'API_KEY_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_KEYS',
  'ALLOW_INSECURE_SECRETS',
] as const;

const runtimeSecretFiles = [
  'NEXTAUTH_SECRET_FILE',
  'API_KEY_SECRET_FILE',
  'ENCRYPTION_KEY_FILE',
  'ENCRYPTION_KEYS_FILE',
  'ALLOW_INSECURE_SECRETS',
] as const;

type AnyMap = Record<string, any>;

function yaml(file: string): AnyMap {
  return parse(read(file)) as AnyMap;
}

function yamlDocs(file: string): AnyMap[] {
  return parseAllDocuments(read(file))
    .map(doc => doc.toJSON())
    .filter(Boolean) as AnyMap[];
}

function arrayEnv(container: AnyMap): Record<string, AnyMap> {
  const env = container.env ?? [];
  if (Array.isArray(env)) {
    return Object.fromEntries(env.map((entry: AnyMap) => [entry.name, entry]));
  }
  return Object.fromEntries(Object.keys(env).map(key => [key, { name: key, value: env[key] }]));
}

function objectEnv(service: AnyMap): Record<string, string> {
  return service.environment ?? {};
}

function expectComposeRole(service: AnyMap) {
  const env = objectEnv(service);
  for (const key of runtimeSecretEnv) {
    expect(env, `missing ${key}`).toHaveProperty(key);
  }
  expect(env.ENCRYPTION_KEY).toBe('${ENCRYPTION_KEY:-}');
  expect(env.ENCRYPTION_KEYS).toBe('${ENCRYPTION_KEYS:-}');
  expect(env.ALLOW_INSECURE_SECRETS).toBe('${ALLOW_INSECURE_SECRETS:-false}');
}

function expectSwarmRole(service: AnyMap) {
  const env = objectEnv(service);
  for (const key of runtimeSecretFiles) {
    expect(env, `missing ${key}`).toHaveProperty(key);
  }
  expect(env.ALLOW_INSECURE_SECRETS).toBe('${ALLOW_INSECURE_SECRETS:-false}');
  const secretSources = (service.secrets ?? []).map((secret: AnyMap) => secret.source);
  for (const source of [
    'opsknight_nextauth_secret',
    'opsknight_api_key_secret',
    'opsknight_encryption_key',
    'opsknight_encryption_keys',
  ]) {
    expect(secretSources).toContain(source);
  }
}

function expectKubernetesRole(doc: AnyMap) {
  const container = doc.kind === 'Job'
    ? doc.spec.template.spec.containers[0]
    : doc.spec.template.spec.containers[0];
  const envFrom = container.envFrom ?? [];
  expect(envFrom).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ configMapRef: expect.any(Object) }),
      expect.objectContaining({ secretRef: expect.any(Object) }),
    ])
  );
}

function expectHelmRenderedRole(doc: AnyMap) {
  const container = doc.spec.template.spec.containers[0];
  const env = arrayEnv(container);
  const envFrom = container.envFrom ?? [];
  expect(envFrom).toEqual(
    expect.arrayContaining([expect.objectContaining({ configMapRef: expect.any(Object) })])
  );
  if (doc.kind === 'Job') {
    // Pre-install hook Jobs run before the chart ConfigMap exists.
    const configMapRef = envFrom.find((source: AnyMap) => source.configMapRef)?.configMapRef;
    expect(configMapRef?.optional).toBe(true);
  }
  for (const key of ['NEXTAUTH_SECRET', 'API_KEY_SECRET', 'ENCRYPTION_KEY']) {
    expect(env, `missing ${key}`).toHaveProperty(key);
    expect(env[key].valueFrom.secretKeyRef).toBeTruthy();
  }
  expect(env.ENCRYPTION_KEY.valueFrom.secretKeyRef.optional).toBe(true);
  if (env.ENCRYPTION_KEYS) {
    expect(env.ENCRYPTION_KEYS.valueFrom.secretKeyRef.optional).toBe(true);
  }
}

function helmTemplate(args: string[]) {
  const result = spawnSync('helm', ['template', 'secret-matrix', 'deploy/kubernetes/helm/opsknight', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return null;
  }
  expect(result.status, result.stderr).toBe(0);
  return parseAllDocuments(result.stdout)
    .map(doc => doc.toJSON())
    .filter(Boolean) as AnyMap[];
}

const oldKey = 'a'.repeat(64);
const newKey = 'b'.repeat(64);
const nextAuthSecret = 'nextauth-secret-value-32-characters';
const apiKeySecret = 'api-key-secret-value-32-characters';
const postgresPassword = 'not_the_default_postgres_password';

function runSwarmSecretPrep(extraEnv: Record<string, string>) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'production',
    OPSKNIGHT_DEPLOY_PREPARE_SECRETS_ONLY: 'true',
    OPSKNIGHT_IMAGE: 'ghcr.io/opsknight-labs/opsknight:2.0.0',
    ENVIRONMENT: 'production',
    POSTGRES_PASSWORD: postgresPassword,
    NEXTAUTH_SECRET: nextAuthSecret,
    API_KEY_SECRET: apiKeySecret,
    ALLOW_INSECURE_SECRETS: 'false',
    ...extraEnv,
  };
  if (!('ENCRYPTION_KEY' in extraEnv)) delete env.ENCRYPTION_KEY;
  if (!('ENCRYPTION_KEYS' in extraEnv)) delete env.ENCRYPTION_KEYS;

  const result = spawnSync('bash', ['deploy/swarm/scripts/deploy.sh'], {
    cwd: root,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
  const values = Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
  return { result, values };
}

describe('deployment secret matrix', () => {
  it('wires every Compose runtime role for legacy keys, keyrings, rotation, API secret, and insecure-secret override', () => {
    const integrated = yaml('deploy/compose/docker-compose.yml');
    expectComposeRole(integrated.services['opsknight-app']);

    const split = yaml('deploy/compose/docker-compose.split.yml');
    for (const role of [
      'opsknight-migration',
      'opsknight-web',
      'opsknight-scheduler',
      'opsknight-general-worker',
      'opsknight-critical-worker',
      'opsknight-bulk-worker',
      'opsknight-runbook-worker',
      'opsknight-status-projector',
    ]) {
      expectComposeRole(split.services[role]);
    }

    const pgbouncer = yaml('deploy/compose/docker-compose.pgbouncer.yml');
    expect(objectEnv(pgbouncer.services['opsknight-web']).DATABASE_URL).toContain('opsknight-pgbouncer');
  });

  it('wires every Swarm runtime role and migration runner through secret files', () => {
    const integrated = yaml('deploy/swarm/docker-stack.integrated.yml');
    expectSwarmRole(integrated.services['opsknight-app']);

    const split = yaml('deploy/swarm/docker-stack.yml');
    for (const role of [
      'opsknight-web',
      'opsknight-scheduler',
      'opsknight-general-worker',
      'opsknight-critical-worker',
      'opsknight-bulk-worker',
      'opsknight-runbook-worker',
      'opsknight-status-projector',
    ]) {
      expectSwarmRole(split.services[role]);
    }

    const migrationRunner = read('deploy/swarm/scripts/migrate.sh');
    for (const token of [
      'ALLOW_INSECURE_SECRETS="${ALLOW_INSECURE_SECRETS:-false}"',
      'API_KEY_SECRET_FILE=/run/secrets/opsknight_api_key_secret',
      'ENCRYPTION_KEYS_FILE=/run/secrets/opsknight_encryption_keys',
    ]) {
      expect(migrationRunner).toContain(token);
    }
  });

  it('keeps Prisma compatibility selectable without changing worker database routing', () => {
    const args = [
      '--set',
      'runtime.mode=split',
      '--set',
      'image.tag=2.0.0',
      '--set',
      'pgbouncer.enabled=true',
      '--set-string',
      'postgresql.password=isolated-pool-test',
    ];
    const native = helmTemplate([...args, '--set', 'pgbouncer.prismaCompatibilityMode=false']);
    const legacy = helmTemplate(args);
    if (!native || !legacy) {
      expect(read('deploy/kubernetes/helm/opsknight/templates/_helpers.tpl')).toContain(
        'if .Values.pgbouncer.prismaCompatibilityMode'
      );
      expect(
        yaml('deploy/kubernetes/helm/opsknight/values.yaml').pgbouncer.prismaCompatibilityMode
      ).toBe(true);
      return;
    }
    for (const [docs, compatibility] of [
      [native, false],
      [legacy, true],
    ] as const) {
      const secret = docs.find(doc => doc.kind === 'Secret' && doc.data?.WEB_DATABASE_URL);
      if (!secret) throw new Error('Rendered Helm chart is missing pooled application credentials');
      const url = new URL(Buffer.from(secret.data.WEB_DATABASE_URL, 'base64').toString());
      expect(url.hostname).toBe('secret-matrix-opsknight-pgbouncer');
      expect(url.searchParams.get('pgbouncer')).toBe(compatibility ? 'true' : null);
      const direct = new URL(Buffer.from(secret.data.DIRECT_DATABASE_URL, 'base64').toString());
      expect(direct.hostname).toBe('secret-matrix-opsknight-postgresql');
      expect(direct.searchParams.has('pgbouncer')).toBe(false);
    }
  });

  it('rejects native pooled Prisma connections when prepared-statement tracking is disabled', () => {
    const result = spawnSync(
      'helm',
      [
        'template',
        'native-pool',
        'deploy/kubernetes/helm/opsknight',
        '--set',
        'runtime.mode=split',
        '--set',
        'image.tag=2.0.0',
        '--set',
        'pgbouncer.enabled=true',
        '--set-string',
        'postgresql.password=isolated-pool-test',
        '--set',
        'pgbouncer.prismaCompatibilityMode=false',
        '--set',
        'pgbouncer.maxPreparedStatements=0',
      ],
      { cwd: root, encoding: 'utf8' }
    );
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      expect(read('deploy/kubernetes/helm/opsknight/templates/pgbouncer-configmap.yaml')).toContain(
        'requires maxPreparedStatements>0'
      );
      return;
    }
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires maxPreparedStatements>0');
  });

  it('renders or statically verifies Helm integrated, split, and migration secret delivery', () => {
    const helmRotation = `k2:${newKey}\\,k1:${oldKey}`;
    const integrated = helmTemplate([
      '--set-string',
      `secrets.encryptionKeys=${helmRotation}`,
      '--set-string',
      'secrets.encryptionKey=',
      '--set',
      'migrations.job.enabled=true',
    ]);
    const split = helmTemplate([
      '--set',
      'runtime.mode=split',
      '--set',
      'image.tag=2.0.0',
      '--set-string',
      `secrets.encryptionKeys=${helmRotation}`,
      '--set-string',
      'secrets.encryptionKey=',
      '--set',
      'migrations.job.enabled=true',
    ]);

    if (integrated && split) {
      for (const docs of [integrated, split]) {
        for (const doc of docs.filter(doc => ['Deployment', 'Job'].includes(doc.kind))) {
          if (doc.metadata.name.includes('postgres') || doc.metadata.name.includes('pgbouncer')) continue;
          expectHelmRenderedRole(doc);
        }
      }
      return;
    }

    for (const file of [
      'deploy/kubernetes/helm/opsknight/templates/deployment.yaml',
      'deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml',
      'deploy/kubernetes/helm/opsknight/templates/migration-job.yaml',
    ]) {
      const source = read(file);
      for (const token of ['NEXTAUTH_SECRET', 'API_KEY_SECRET', 'ENCRYPTION_KEY', 'ENCRYPTION_KEYS']) {
        expect(source).toContain(token);
      }
      expect(source).toContain('optional: true');
    }
    expect(read('deploy/kubernetes/helm/opsknight/templates/configmap.yaml')).toContain('ALLOW_INSECURE_SECRETS');
    const schema = JSON.parse(read('deploy/kubernetes/helm/opsknight/values.schema.json')) as AnyMap;
    expect(schema.properties.secrets.properties.apiKeySecret).toBeTruthy();
    expect(schema.properties.secrets.properties.encryptionKeys.pattern).toContain('64');
  });

  it('parses Kustomize integrated, split, and split-pgbouncer profiles with secret/config refs on every runtime role', () => {
    const integrated = yamlDocs('deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml');
    expectKubernetesRole(integrated.find(doc => doc.kind === 'Deployment')!);

    // The split migration Job is operator-applied (see the Kustomize install guide)
    // because Jobs are immutable under `kubectl apply -k` upgrades.
    const splitDocs = yamlDocs('deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml');
    for (const doc of splitDocs.filter(doc => doc.kind === 'Deployment')) {
      expectKubernetesRole(doc);
    }

    const splitPgbouncer = read('deploy/kubernetes/kustomize/profiles/split-pgbouncer/kustomization.yaml');
    expect(splitPgbouncer).toContain('../split');
    expect(read('deploy/kubernetes/kustomize/base/configmap.yaml')).toContain('ALLOW_INSECURE_SECRETS');
    for (const token of ['NEXTAUTH_SECRET', 'API_KEY_SECRET', 'ENCRYPTION_KEY', 'ENCRYPTION_KEYS']) {
      expect(read('deploy/kubernetes/kustomize/base/secret.yaml')).toContain(token);
    }
  });

  it('executes Swarm deploy.sh secret preparation for keyring-only, legacy, both-set, rotation, insecure override, and API independence', () => {
    const keyringOnly = runSwarmSecretPrep({ ENCRYPTION_KEYS: `k2:${newKey},k1:${oldKey}` });
    expect(keyringOnly.result.status, keyringOnly.result.stderr).toBe(0);
    expect(keyringOnly.values.ENCRYPTION_KEY).toBe(newKey);
    expect(keyringOnly.values.ENCRYPTION_KEYS).toBe(`k2:${newKey},k1:${oldKey}`);

    const legacy = runSwarmSecretPrep({ ENCRYPTION_KEY: oldKey });
    expect(legacy.result.status, legacy.result.stderr).toBe(0);
    expect(legacy.values.ENCRYPTION_KEY).toBe(oldKey);
    expect(legacy.values.ENCRYPTION_KEYS).toBe(`k1:${oldKey}`);
    expect(legacy.values.ENCRYPTION_KEYS).not.toContain('legacy:');

    const both = runSwarmSecretPrep({
      ENCRYPTION_KEY: oldKey,
      ENCRYPTION_KEYS: `k2:${newKey},k1:${oldKey}`,
    });
    expect(both.result.status, both.result.stderr).toBe(0);
    expect(both.values.ENCRYPTION_KEY).toBe(oldKey);
    expect(both.values.ENCRYPTION_KEYS).toBe(`k2:${newKey},k1:${oldKey}`);

    const insecure = runSwarmSecretPrep({
      ALLOW_INSECURE_SECRETS: 'true',
      ENCRYPTION_KEYS: `k2:${newKey},k1:${oldKey}`,
    });
    expect(insecure.result.status, insecure.result.stderr).toBe(0);
    expect(insecure.values.ALLOW_INSECURE_SECRETS).toBe('true');
    expect(insecure.values.API_KEY_SECRET).toBe(apiKeySecret);

    const invalidApi = runSwarmSecretPrep({
      API_KEY_SECRET: nextAuthSecret,
      ENCRYPTION_KEY: oldKey,
    });
    expect(invalidApi.result.status).not.toBe(0);
    expect(`${invalidApi.result.stderr ?? ''}${invalidApi.result.stdout ?? ''}`).toContain('API_KEY_SECRET');
  });
});
