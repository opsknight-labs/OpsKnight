/* eslint-disable @typescript-eslint/no-explicit-any, security/detect-non-literal-fs-filename -- Parsed Kubernetes fixtures have heterogeneous shapes; provider paths use a fixed two-item test matrix. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseAllDocuments, parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const chart = 'deploy/kubernetes/helm/opsknight';
const csi = [
  '--set',
  'externalSecrets.csi.enabled=true',
  '--set',
  'externalSecrets.csi.secretProviderClass=opsknight-runtime',
];
const external = ['--set', 'secrets.existingSecret=opsknight-runtime'];
function render(args: string[] = []): any[] {
  const output = execFileSync(
    'helm',
    [
      'template',
      'test',
      chart,
      '--namespace',
      'opsknight',
      '--set',
      'postgresql.enabled=false',
      '--set',
      'postgresql.host=db.example.internal',
      ...args,
    ],
    { encoding: 'utf8' }
  );
  return parseAllDocuments(output)
    .map(doc => {
      expect(doc.errors).toEqual([]);
      return doc.toJSON();
    })
    .filter(Boolean);
}
const pods = (docs: any[]) =>
  docs.filter(doc => ['Deployment', 'Job', 'StatefulSet'].includes(doc.kind));

function expectMount(doc: any) {
  const pod = doc.spec.template.spec;
  expect(pod.volumes).toEqual(
    expect.arrayContaining([
      {
        name: 'external-secrets',
        csi: {
          driver: 'secrets-store.csi.k8s.io',
          readOnly: true,
          volumeAttributes: { secretProviderClass: 'opsknight-runtime' },
        },
      },
    ])
  );
  expect(pod.containers[0].volumeMounts).toContainEqual({
    name: 'external-secrets',
    mountPath: '/mnt/opsknight-secrets',
    readOnly: true,
  });
  expect(pod.containers[0].volumeMounts.every((mount: any) => !mount.subPath)).toBe(true);
  expect(new Set(pod.volumes.map((volume: any) => volume.name)).size).toBe(pod.volumes.length);
}

describe('optional Secrets Store CSI integration', () => {
  it('keeps CSI absent by default and preserves chart-owned Secrets', () => {
    const docs = render();
    expect(docs.some(doc => doc.kind === 'Secret')).toBe(true);
    for (const doc of pods(docs)) {
      expect(doc.spec.template.spec.volumes?.some((volume: any) => volume.csi)).toBeFalsy();
    }
    expect(render(['--set', 'externalSecrets.csi.enabled=false'])).toEqual(docs);
  });

  for (const mode of ['integrated', 'split']) {
    it(`mounts every ${mode} runtime and migration job, preserving synchronized env references`, () => {
      const args =
        mode === 'split'
          ? [
              '--set',
              'runtime.mode=split',
              '--set',
              'scheduler.profile=maintenance',
              '--set',
              'image.tag=test',
            ]
          : [];
      const docs = render([
        ...csi,
        ...external,
        ...args,
        '--set',
        'migrations.job.enabled=true',
        '--set-string',
        'podLabels.azure\\.workload\\.identity/use=true',
        '--set',
        'serviceAccount.name=cloud-identity',
      ]);
      const workloads = pods(docs).filter(doc => doc.kind !== 'StatefulSet');
      expect(workloads.length).toBe(mode === 'split' ? 8 : 2);
      for (const doc of workloads) {
        expectMount(doc);
        expect(doc.spec.template.spec.serviceAccountName).toBe('cloud-identity');
        expect(doc.spec.template.metadata.labels['azure.workload.identity/use']).toBe('true');
        const env = doc.spec.template.spec.containers[0].env;
        for (const key of ['DATABASE_URL', 'NEXTAUTH_SECRET', 'API_KEY_SECRET']) {
          expect(env.find((entry: any) => entry.name === key).valueFrom.secretKeyRef).toEqual({
            name: 'opsknight-runtime',
            key,
          });
        }
      }
      expect(docs.some(doc => doc.kind === 'Secret')).toBe(false);
      expect(docs.some(doc => doc.kind === 'SecretProviderClass')).toBe(false);
    });
  }

  it('coexists with database TLS volumes without duplicate YAML keys', () => {
    const docs = render([
      ...csi,
      ...external,
      '--set',
      'postgresql.enabled=false',
      '--set',
      'postgresql.host=db.example.internal',
      '--set',
      'postgresql.tls.enabled=true',
      '--set',
      'postgresql.tls.existingSecret=db-ca',
      '--set',
      'migrations.job.enabled=true',
    ]);
    for (const doc of pods(docs)) {
      expectMount(doc);
      expect(
        doc.spec.template.spec.volumes.find((volume: any) => volume.name === 'database-tls').secret
          .secretName
      ).toBe('db-ca');
    }
  });

  it('allows mounts independently of synchronized credentials', () => {
    const docs = render(csi);
    expectMount(docs.find(doc => doc.kind === 'Deployment'));
    expect(docs.some(doc => doc.kind === 'Secret')).toBe(true);
  });

  it('changes every runtime template when the operator advances the rotation revision', () => {
    for (const mode of ['integrated', 'split']) {
      const args =
        mode === 'split'
          ? [
              '--set',
              'runtime.mode=split',
              '--set',
              'scheduler.profile=maintenance',
              '--set',
              'image.tag=test',
            ]
          : [];
      const before = pods(render([...csi, ...external, ...args]));
      const after = pods(
        render([
          ...csi,
          ...external,
          ...args,
          '--set-string',
          'podAnnotations.secrets\\.opsknight\\.com/revision=rotation-2',
        ])
      );
      for (const [index, doc] of after.entries()) {
        if (doc.kind !== 'Deployment') continue;
        expect(doc.spec.template.metadata.annotations['secrets.opsknight.com/revision']).toBe(
          'rotation-2'
        );
        expect(doc.spec.template).not.toEqual(before.at(index).spec.template);
        expect(doc.spec.template.metadata.annotations['checksum/secret']).toBeUndefined();
      }
    }
  });

  it('does not grant application CSI access to agents or PgBouncer', () => {
    const docs = render([
      ...csi,
      ...external,
      '--set',
      'pgbouncer.enabled=true',
      '--set',
      'pgbouncer.existingAuthSecret=pool-auth',
      '--set',
      'postgresql.tls.enabled=true',
      '--set',
      'postgresql.tls.existingSecret=db-ca',
      '--set',
      'runtime.mode=split',
      '--set',
      'scheduler.profile=maintenance',
      '--set',
      'image.tag=test',
      '--set',
      'agent.enabled=true',
      '--set',
      'agent.image.tag=test',
      '--set',
      'agent.enrollmentToken.existingSecret=agent-enrollment',
    ]);
    for (const name of ['pgbouncer', 'agent']) {
      const workload = pods(docs).find(doc => doc.metadata.name.endsWith(`-${name}`));
      expect(workload).toBeDefined();
      expect(workload.spec.template.spec.volumes.some((volume: any) => volume.csi)).toBe(false);
    }
  });

  it('retains the CSI mount on pre-upgrade migration hooks', () => {
    const job = render([
      ...csi,
      ...external,
      '--set',
      'migrations.job.enabled=true',
      '--is-upgrade',
      '--set',
      'image.tag=test',
    ]).find(doc => doc.kind === 'Job' && doc.metadata.name.endsWith('-migration'));
    expectMount(job);
    expect(job.metadata.annotations['helm.sh/hook']).toBe('pre-upgrade');
  });

  for (const [key, value] of [
    ['secretProviderClass', ''],
    ['secretProviderClass', 'invalid/name'],
    ['mountPath', '/'],
    ['mountPath', 'relative'],
    ['mountPath', '/app'],
    ['mountPath', '/mnt/../app'],
    ['rotation.enabled', 'true'],
  ]) {
    it(`rejects invalid CSI configuration ${key}=${value}`, () => {
      const result = spawnSync(
        'helm',
        ['template', 'test', chart, ...csi, '--set', `externalSecrets.csi.${key}=${value}`],
        { encoding: 'utf8' }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('externalSecrets');
    });
  }

  for (const provider of ['aws', 'azure']) {
    it(`checks ${provider} example aliases against synchronized Secret keys`, () => {
      const spc = parse(
        readFileSync(`${chart}/examples/secretproviderclass-${provider}.yaml`, 'utf8')
      );
      expect(spc.metadata.namespace).toBe('opsknight');
      expect(spc.metadata.name).toBe('opsknight-runtime');
      expect(spc.spec.provider).toBe(provider);
      const objects = parse(spc.spec.parameters.objects);
      const aliases =
        provider === 'aws'
          ? objects[0].jmesPath.map((entry: any) => entry.objectAlias)
          : objects.array.map((entry: string) => parse(entry).objectAlias);
      expect(spc.spec.secretObjects[0].secretName).toBe('opsknight-runtime');
      for (const entry of spc.spec.secretObjects[0].data)
        expect(aliases).toContain(entry.objectName);
      const docs = render(['-f', `${chart}/examples/values-external-secrets.yaml`]);
      expectMount(docs.find(doc => doc.kind === 'Deployment'));
      expect(docs.some(doc => doc.kind === 'Secret')).toBe(false);
    });
  }

  it('removes fixed application IDs with the OpenShift profile, including migrations', () => {
    const docs = render([
      ...csi,
      ...external,
      '-f',
      `${chart}/examples/values-openshift.yaml`,
      '--set',
      'migrations.job.enabled=true',
    ]);
    for (const doc of pods(docs)) {
      const pod = doc.spec.template.spec;
      expect(pod.securityContext.runAsUser).toBeUndefined();
      expect(pod.securityContext.runAsGroup).toBeUndefined();
      expect(pod.securityContext.fsGroup).toBeUndefined();
      expect(pod.securityContext.seccompProfile.type).toBe('RuntimeDefault');
      expect(pod.containers[0].securityContext.runAsUser).toBeUndefined();
      expectMount(doc);
    }
  });
});
