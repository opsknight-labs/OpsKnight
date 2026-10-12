import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { expect, it } from 'vitest';

const helmAvailable = spawnSync('helm', ['version', '--short']).status === 0;
it.skipIf(!helmAvailable)(
  'renders only Agent resources with the selected URL/image and persistent identity',
  () => {
    const documents = YAML.parseAllDocuments(
      execFileSync(
        'helm',
        [
          'template',
          'remote-agent',
          'deploy/kubernetes/helm/opsknight-agent',
          '--set',
          'agent.url=https://ops.example.com',
          '--set',
          'agent.enrollmentToken.existingSecret=enrollment',
          '--set',
          'agent.image.repository=registry.example.com/agent',
          '--set',
          'agent.image.digest=sha256:abcd',
        ],
        { encoding: 'utf8' }
      )
    ).map(document => document.toJSON());
    expect(documents.map(document => document.kind).sort()).toEqual([
      'ConfigMap',
      'Deployment',
      'PersistentVolumeClaim',
      'ServiceAccount',
    ]);
    const deployment = documents.find(document => document.kind === 'Deployment');
    const container = deployment.spec.template.spec.containers[0];
    expect(container.image).toBe('registry.example.com/agent@sha256:abcd');
    expect(container.env.find((env: { name: string }) => env.name === 'OPSKNIGHT_URL').value).toBe(
      'https://ops.example.com'
    );
    expect(deployment.spec.replicas).toBe(1);
    expect(
      deployment.spec.template.spec.volumes.find(
        (volume: { name: string }) => volume.name === 'data'
      )
    ).toHaveProperty('persistentVolumeClaim');
  }
);
it('standalone Compose contains only the Agent and declares its network', () => {
  const compose = YAML.parse(readFileSync('deploy/compose/docker-compose.agent.yml', 'utf8'));
  expect(Object.keys(compose.services)).toEqual(['opsknight-agent']);
  expect(compose.networks).toHaveProperty('opsknight-network');
});
