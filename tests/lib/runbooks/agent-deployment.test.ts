import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { expect, it } from 'vitest';
import { agentDeploymentIdentity, agentKustomization } from '@/lib/runbooks/agent-deployment';

it('renders disjoint Kubernetes selectors, identities, policy, Secrets and PVC references for two enrollments', () => {
  const inventories: Set<string>[] = [];
  for (const agentId of ['cmv90000000000000000000001', 'cmv90000000000000000000002']) {
    const directory = mkdtempSync(join(tmpdir(), 'agent-isolation-'));
    try {
      for (const file of ['deployment.yaml', 'policy.yaml', 'service-account.yaml', 'pvc.yaml'])
        copyFileSync(`deploy/kubernetes/kustomize/components/agent/${file}`, join(directory, file));
      writeFileSync(
        join(directory, 'enrollment.yaml'),
        YAML.stringify({
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: 'opsknight-agent-enrollment', namespace: 'opsknight' },
          stringData: {
            'enrollment-token': 'fixture',
            OPSKNIGHT_EXECUTION_PUBLIC_KEY: 'public-pin',
          },
        })
      );
      writeFileSync(
        join(directory, 'kustomization.yaml'),
        JSON.stringify(
          agentKustomization(
            agentId,
            'https://ops.example.com',
            'registry.example.com/agent@sha256:' + 'a'.repeat(64)
          )
        )
      );
      const render = spawnSync('kubectl', ['kustomize', directory], { encoding: 'utf8' });
      expect(render.status, render.stderr).toBe(0);
      const documents = YAML.parseAllDocuments(render.stdout).map(document => document.toJSON());
      const identity = agentDeploymentIdentity(agentId);
      const deployment = documents.find(value => value.kind === 'Deployment');
      expect(deployment.metadata.name).toBe(identity.name);
      expect(deployment.spec.selector.matchLabels['app.kubernetes.io/instance']).toBe(
        identity.name
      );
      expect(deployment.spec.template.metadata.labels['app.kubernetes.io/instance']).toBe(
        identity.name
      );
      expect(
        deployment.spec.template.spec.volumes.find(
          (value: { name: string }) => value.name === 'enrollment'
        ).secret.secretName
      ).toBe(identity.enrollmentSecret);
      expect(
        deployment.spec.template.spec.volumes.find(
          (value: { name: string }) => value.name === 'data'
        ).persistentVolumeClaim.claimName
      ).toBe(identity.name);
      inventories.push(new Set(documents.map(value => `${value.kind}/${value.metadata.name}`)));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  expect([...inventories[0]].filter(name => inventories[1].has(name))).toEqual([]);
});
