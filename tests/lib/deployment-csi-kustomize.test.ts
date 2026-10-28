/* eslint-disable @typescript-eslint/no-explicit-any, security/detect-non-literal-fs-filename -- Parsed Kubernetes fixtures have heterogeneous shapes; temporary overlay paths come from mkdtemp. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseAllDocuments, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve('deploy/kubernetes/kustomize');
function render(directory: string): any[] {
  return parseAllDocuments(execFileSync('kubectl', ['kustomize', directory], { encoding: 'utf8' }))
    .map(doc => {
      expect(doc.errors).toEqual([]);
      return doc.toJSON();
    })
    .filter(Boolean);
}
function overlay(profile: string | null, components: string[], patches: object[] = []): any[] {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'opsknight-csi-kustomize-')));
  try {
    copyFileSync(path.join(root, 'migration-job.yaml'), path.join(directory, 'migration-job.yaml'));
    writeFileSync(
      path.join(directory, 'kustomization.yaml'),
      stringify({
        apiVersion: 'kustomize.config.k8s.io/v1beta1',
        kind: 'Kustomization',
        resources: [
          ...(profile ? [path.relative(directory, path.join(root, 'profiles', profile))] : []),
          'migration-job.yaml',
        ],
        components: components.map(name =>
          path.relative(directory, path.join(root, 'components', name))
        ),
        patches,
      })
    );
    return render(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const workloads = (docs: any[]) => docs.filter(doc => ['Deployment', 'Job'].includes(doc.kind));
const appWorkloads = (docs: any[]) =>
  workloads(docs).filter(doc => !/-(agent|pgbouncer)$/.test(doc.metadata.name));
function expectMount(doc: any) {
  const pod = doc.spec.template.spec;
  expect(pod.serviceAccountName).toBe('opsknight-app');
  expect(pod.volumes).toContainEqual({
    name: 'external-secrets',
    csi: {
      driver: 'secrets-store.csi.k8s.io',
      readOnly: true,
      volumeAttributes: { secretProviderClass: 'opsknight-runtime' },
    },
  });
  expect(pod.containers[0].volumeMounts).toContainEqual({
    name: 'external-secrets',
    mountPath: '/mnt/opsknight-secrets',
    readOnly: true,
  });
  expect(
    pod.containers[0].volumeMounts.find((mount: any) => mount.name === 'external-secrets').subPath
  ).toBeUndefined();
}

describe('Kustomize Secrets Store CSI components', () => {
  for (const mode of ['integrated', 'split']) {
    it(`mounts every ${mode} role without rendering the externally owned Secret or bundled database`, () => {
      const docs = render(path.join(root, 'profiles', `${mode}-csi`));
      const deployments = workloads(docs);
      expect(deployments.length).toBe(mode === 'integrated' ? 1 : 7);
      for (const doc of deployments) {
        expectMount(doc);
        const container = doc.spec.template.spec.containers[0];
        expect(container.envFrom).toContainEqual({ secretRef: { name: 'opsknight-secrets' } });
        for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
          expect(
            container.env.find((entry: any) => entry.name === name).valueFrom.secretKeyRef.name
          ).toBe('opsknight-secrets');
        }
      }
      expect(docs.some(doc => doc.kind === 'Secret' || doc.kind === 'SecretProviderClass')).toBe(
        false
      );
      expect(docs.some(doc => doc.metadata.name.startsWith('opsknight-postgres'))).toBe(false);
      expect(docs.some(doc => doc.kind === 'Job')).toBe(false);
    });

    it(`applies OpenShift security, identity labels and rotation annotations to ${mode} and its separate migration owner`, () => {
      const patches = [
        {
          target: {
            kind: 'Deployment',
            name: 'opsknight-(app|web|scheduler|general-worker|critical-worker|bulk-worker|runbook-worker|status-projector)',
          },
          patch: stringify({
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'unused' },
            spec: {
              template: {
                metadata: {
                  labels: { 'azure.workload.identity/use': 'true' },
                  annotations: { 'secrets.opsknight.com/revision': 'rotation-2' },
                },
              },
            },
          }),
        },
        {
          target: { kind: 'Job', name: 'opsknight-migration' },
          patch: stringify({
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: { name: 'unused' },
            spec: { template: { metadata: { labels: { 'azure.workload.identity/use': 'true' } } } },
          }),
        },
      ];
      const docs = overlay(`${mode}-csi`, ['secrets-store-csi', 'openshift'], patches);
      const apps = appWorkloads(docs);
      expect(apps.length).toBe(mode === 'integrated' ? 2 : 8);
      for (const doc of apps) {
        expectMount(doc);
        const pod = doc.spec.template.spec;
        expect(pod.securityContext.runAsUser).toBeUndefined();
        expect(pod.securityContext.runAsGroup).toBeUndefined();
        expect(pod.securityContext.fsGroup).toBeUndefined();
        expect(pod.securityContext.seccompProfile.type).toBe('RuntimeDefault');
        expect(pod.containers[0].securityContext.runAsUser).toBeUndefined();
        expect(pod.containers[0].securityContext.allowPrivilegeEscalation).toBe(false);
        expect(doc.spec.template.metadata.labels['azure.workload.identity/use']).toBe('true');
        if (doc.kind === 'Deployment')
          expect(doc.spec.template.metadata.annotations['secrets.opsknight.com/revision']).toBe(
            'rotation-2'
          );
      }
      const job = apps.find(doc => doc.kind === 'Job');
      expect(
        job.spec.template.spec.containers[0].env.find((entry: any) => entry.name === 'DATABASE_URL')
          .valueFrom.secretKeyRef.key
      ).toBe('DIRECT_DATABASE_URL');
    });
  }

  it('supports a migration-only render before runtime rollout', () => {
    const docs = overlay(null, ['secrets-store-csi', 'external-secrets', 'openshift']);
    expect(docs.length).toBe(1);
    expectMount(docs[0]);
    expect(docs[0].kind).toBe('Job');
  });

  it('keeps mounts independent of Secret ownership and merges other volumes', () => {
    const docs = overlay(
      'integrated',
      ['secrets-store-csi'],
      [
        {
          target: { kind: 'Deployment', name: 'opsknight-app' },
          patch: stringify({
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'opsknight-app' },
            spec: {
              template: {
                spec: {
                  containers: [
                    {
                      name: 'opsknight-app',
                      volumeMounts: [
                        {
                          name: 'database-tls',
                          mountPath: '/etc/opsknight-db-tls',
                          readOnly: true,
                        },
                      ],
                    },
                  ],
                  volumes: [{ name: 'database-tls', secret: { secretName: 'db-ca' } }],
                },
              },
            },
          }),
        },
      ]
    );
    expect(
      docs.some(doc => doc.kind === 'Secret' && doc.metadata.name === 'opsknight-secrets')
    ).toBe(true);
    for (const doc of appWorkloads(docs)) expectMount(doc);
    const app = docs.find(doc => doc.kind === 'Deployment');
    expect(app.spec.template.spec.volumes).toContainEqual({
      name: 'database-tls',
      secret: { secretName: 'db-ca' },
    });
    expect(app.spec.template.spec.containers[0].volumeMounts).toContainEqual({
      name: 'database-tls',
      mountPath: '/etc/opsknight-db-tls',
      readOnly: true,
    });
  });

  for (const profile of ['integrated-agent', 'split-agent', 'split-pgbouncer']) {
    it(`scopes CSI to application workloads when composed with ${profile}`, () => {
      const docs = overlay(profile, ['secrets-store-csi']);
      for (const doc of appWorkloads(docs)) expectMount(doc);
      for (const doc of workloads(docs).filter(doc =>
        /-(agent|pgbouncer)$/.test(doc.metadata.name)
      )) {
        expect(doc.spec.template.spec.volumes?.some((volume: any) => volume.csi)).toBeFalsy();
      }
    });
  }

  for (const profile of [
    'integrated',
    'split',
    'split-pgbouncer',
    'integrated-agent',
    'split-agent',
    'integrated-agent-kubernetes',
    'split-agent-kubernetes',
  ]) {
    it(`keeps CSI absent from the existing ${profile} profile`, () => {
      for (const doc of workloads(render(path.join(root, 'profiles', profile)))) {
        expect(doc.spec.template.spec.volumes?.some((volume: any) => volume.csi)).toBeFalsy();
      }
    });
  }
});
