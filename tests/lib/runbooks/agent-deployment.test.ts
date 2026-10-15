import {
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
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
      for (const name of ['OPSKNIGHT_EXECUTION_PUBLIC_KEY', 'OPSKNIGHT_EXECUTION_PUBLIC_KEYS']) {
        const variable = deployment.spec.template.spec.containers[0].env.find(
          (item: { name: string }) => item.name === name
        );
        expect(variable.valueFrom.secretKeyRef.name).toBe(identity.enrollmentSecret);
      }
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

it('passes the token file through Docker secret stdin without consuming the node prompt', async () => {
  const { agentSetupCommands } = await import('@/lib/runbooks/agent-setup-commands');
  const commands = agentSetupCommands({
    agentId: 'cmv90000000000000000000001',
    image: 'fixture:verified',
    url: 'https://ops.example.com',
    policyPath: 'agent/policy.container.json',
    executionPublicKey: 'public-pin',
  });
  const result = spawnSync(
    'bash',
    [
      '-c',
      `
curl() { return 0; }
docker() {
  if [ "$1 $2" = 'secret create' ]; then
    [ "$#" = 4 ] && [ "$4" = '-' ] || { printf 'secret file is required' >&2; return 1; }
    [ "$(cat)" = 'fixture-token' ] || return 1
    printf 'Token delivered through stdin\\n'
  elif [ "$1 $2" = 'stack deploy' ]; then
    [ "$OPSKNIGHT_AGENT_NODE_ID" = 'fixture-node' ] || return 1
    printf 'Node prompt preserved\\n'
  else return 1; fi
}
${commands.swarm}
[ ! -e "$agent_credential_dir/enrollment-token" ] || { printf 'Credential file retained' >&2; exit 1; }
`,
    ],
    { encoding: 'utf8', input: 'fixture-token\nfixture-node\n' }
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Token delivered through stdin');
  expect(result.stdout).toContain('Node prompt preserved');
  expect(result.stdout).not.toContain('fixture-token');
});

it('preserves the configured endpoint when Docker renders the Agent Swarm stack', () => {
  const endpoint = 'https://ops.example.com:8443';
  const environment = {
    ...process.env,
    OPSKNIGHT_AGENT_URL: endpoint,
    OPSKNIGHT_AGENT_IMAGE: 'fixture:verified',
    OPSKNIGHT_AGENT_NODE_ID: 'fixture-node',
  };
  const render = spawnSync(
    'docker',
    ['stack', 'config', '-c', 'deploy/swarm/docker-stack.agent.yml'],
    {
      env: environment,
      encoding: 'utf8',
      timeout: 10_000,
    }
  );
  expect(render.status, render.stderr).toBe(0);
  const stack = YAML.parse(render.stdout);
  expect(stack.services['opsknight-agent'].environment.OPSKNIGHT_URL).toBe(endpoint);
  expect(stack.services['opsknight-agent'].deploy.restart_policy.condition).toBe('any');
  expect(stack.services['opsknight-agent'].volumes).toContainEqual({
    type: 'tmpfs',
    target: '/tmp',
    tmpfs: { size: 16777216 },
  });
  expect(stack.services['opsknight-agent'].tmpfs).toBeUndefined();
  // The endpoint must still be required, including when explicitly empty.
  const missing = spawnSync(
    'docker',
    ['stack', 'config', '-c', 'deploy/swarm/docker-stack.agent.yml'],
    {
      env: { ...environment, OPSKNIGHT_AGENT_URL: '' },
      encoding: 'utf8',
      timeout: 10_000,
    }
  );
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain('OPSKNIGHT_AGENT_URL');
});

it('creates the Kustomize enrollment Secret separately and leaves only credential-free state outside the repository', async () => {
  const { agentSetupCommands } = await import('@/lib/runbooks/agent-setup-commands');
  const directory = mkdtempSync(join(tmpdir(), 'agent-state-test-'));
  const commands = agentSetupCommands({
    agentId: 'cmv90000000000000000000001',
    image: 'fixture:verified',
    url: 'https://ops.example.com',
    policyPath: 'agent/policy.container.json',
    executionPublicKey: 'public-pin',
  });
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
curl() { return 0; }
kubectl() {
  case "$*" in
    'create namespace '*) printf 'namespace-fixture';;
    'apply -f -') cat >/dev/null;;
    *'create secret generic '*)
      for arg in "$@"; do
        case "$arg" in --from-file=enrollment-token=*)
          [ "$(cat "\${arg#--from-file=enrollment-token=}")" = 'fixture-bootstrap-credential' ] || return 1;;
        esac
      done
      printf 'Secret created separately';;
    'apply -k '*) [ ! -e "$3/enrollment.yaml" ] || return 1;;
    *) return 1;;
  esac
}
${commands.kustomize}
[ ! -e "$agent_credential_dir/enrollment-token" ] || { printf 'Credential file retained' >&2; exit 1; }
`,
      ],
      {
        input: 'fixture-bootstrap-credential\n',
        encoding: 'utf8',
        env: { ...process.env, XDG_STATE_HOME: directory },
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain('fixture-bootstrap-credential');
    const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry =>
      entry.isFile()
    );
    expect(files.length).toBe(5);
    for (const file of files) {
      const content = readFileSync(join(file.parentPath, file.name), 'utf8');
      expect(content).not.toContain('fixture-bootstrap-credential');
      expect(content).not.toContain(Buffer.from('fixture-bootstrap-credential').toString('base64'));
      expect(content).not.toContain('kind: Secret');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
