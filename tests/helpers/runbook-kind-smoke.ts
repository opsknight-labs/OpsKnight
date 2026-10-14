import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import { testPrisma } from './test-db';

const run = promisify(execFile);
/** Opt-in only; operates exclusively on the disposable rbe-engine-cert cluster. */
export async function smokeRunbookKind(directory: string, actorId: string, endpoint: string) {
  const context = 'kind-rbe-engine-cert';
  const kubectl = (args: string[]) =>
    run('kubectl', ['--context', context, ...args], { timeout: 120_000 });
  const evidence: Record<string, unknown>[] = [];
  for (const topology of ['helm', 'kustomize']) {
    const namespace = `rbe-${topology}`;
    await kubectl(['create', 'namespace', namespace]);
    try {
      const enrollment = await createAgentEnrollment({ name: `Kind ${topology}`, actorId });
      await writeFile(join(directory, `${topology}-token`), enrollment.token, { mode: 0o600 });
      await kubectl([
        '-n',
        namespace,
        'create',
        'secret',
        'generic',
        'opsknight-agent-enrollment',
        `--from-file=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=${join(directory, `${topology}-token`)}`,
        `--from-file=enrollment-token=${join(directory, `${topology}-token`)}`,
        `--from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY=${enrollment.executionPublicKey}`,
      ]);
      await kubectl([
        '-n',
        namespace,
        'create',
        'secret',
        'generic',
        'rbe-ca',
        `--from-file=tls.crt=${join(directory, 'tls.crt')}`,
      ]);
      const deployment = topology === 'helm' ? 'rbe-agent-agent' : 'opsknight-agent';
      if (topology === 'helm') {
        await run(
          'helm',
          [
            'upgrade',
            '--install',
            'rbe-agent',
            'deploy/kubernetes/helm/opsknight-agent',
            '--kube-context',
            context,
            '-n',
            namespace,
            '--set-string',
            'fullnameOverride=rbe-agent',
            '--set-string',
            'agent.image.repository=opsknight-agent',
            '--set-string',
            'agent.image.tag=rbe-local',
            '--set-string',
            `agent.url=${endpoint}`,
            '--set-string',
            'agent.enrollmentToken.existingSecret=opsknight-agent-enrollment',
          ],
          { timeout: 60_000 }
        );
      } else {
        const overlay = join(directory, 'kustomize');
        await mkdir(overlay);
        for (const file of ['deployment.yaml', 'policy.yaml', 'service-account.yaml', 'pvc.yaml'])
          await copyFile(
            `deploy/kubernetes/kustomize/components/agent/${file}`,
            join(overlay, file)
          );
        await writeFile(
          join(overlay, 'kustomization.yaml'),
          JSON.stringify({
            apiVersion: 'kustomize.config.k8s.io/v1beta1',
            kind: 'Kustomization',
            namespace,
            resources: ['deployment.yaml', 'policy.yaml', 'service-account.yaml', 'pvc.yaml'],
            images: [
              {
                name: 'ghcr.io/opsknight-labs/opsknight-agent',
                newName: 'opsknight-agent',
                newTag: 'rbe-local',
              },
            ],
            patches: [
              {
                target: { kind: 'Deployment', name: 'opsknight-agent' },
                patch: JSON.stringify([
                  {
                    op: 'replace',
                    path: '/spec/template/spec/containers/0/env/0/value',
                    value: endpoint,
                  },
                  {
                    op: 'replace',
                    path: '/spec/template/spec/containers/0/imagePullPolicy',
                    value: 'IfNotPresent',
                  },
                ]),
              },
            ],
          })
        );
        await kubectl(['apply', '-k', overlay]);
      }
      // Environment-specific private CA overlay, preserving certificate verification.
      const patch = {
        spec: {
          template: {
            spec: {
              volumes: [{ name: 'rbe-ca', secret: { secretName: 'rbe-ca' } }],
              containers: [
                {
                  name: 'agent',
                  env: [{ name: 'NODE_EXTRA_CA_CERTS', value: '/etc/rbe/tls.crt' }],
                  volumeMounts: [{ name: 'rbe-ca', mountPath: '/etc/rbe', readOnly: true }],
                },
              ],
            },
          },
        },
      };
      await kubectl([
        '-n',
        namespace,
        'patch',
        'deployment',
        deployment,
        '--type=strategic',
        '-p',
        JSON.stringify(patch),
      ]);
      await kubectl([
        '-n',
        namespace,
        'rollout',
        'status',
        `deployment/${deployment}`,
        '--timeout=120s',
      ]);
      const inspect = async () =>
        JSON.parse((await kubectl(['-n', namespace, 'get', 'pods', '-o', 'json'])).stdout) as {
          items: Array<{
            metadata: { name: string };
            status: { containerStatuses: Array<{ restartCount: number; ready: boolean }> };
          }>;
        };
      const before = await inspect();
      if (!before.items[0]?.status.containerStatuses[0]?.ready)
        throw new Error(`${topology} Agent is not ready.`);
      const agent = await testPrisma.runbookAgent.findUniqueOrThrow({
        where: { id: enrollment.agent.id },
      });
      if (!['ONLINE', 'DEGRADED'].includes(agent.status) || !agent.publicKey)
        throw new Error(`${topology} Agent did not enroll.`);
      const exec = (args: string[]) =>
        kubectl(['-n', namespace, 'exec', `deployment/${deployment}`, '--', ...args]);
      // A deliberate drain must fail readiness while liveness stays healthy.
      await exec([
        'node',
        '-e',
        'require("fs").writeFileSync("/var/lib/opsknight-agent/drain", "test")',
      ]);
      await new Promise(resolve => setTimeout(resolve, 20_000));
      await exec(['node', '/usr/local/bin/opsknight-agent-healthcheck.mjs', 'liveness']);
      let readinessBlocked = false;
      try {
        await exec(['node', '/usr/local/bin/opsknight-agent-healthcheck.mjs', 'readiness']);
      } catch {
        readinessBlocked = true;
      }
      if (!readinessBlocked) throw new Error(`${topology} draining Agent remained ready.`);
      const drained = await inspect();
      if (
        drained.items[0]?.status.containerStatuses[0]?.restartCount !==
        before.items[0]?.status.containerStatuses[0]?.restartCount
      )
        throw new Error(`${topology} draining Agent restarted.`);
      await exec(['node', '-e', 'require("fs").unlinkSync("/var/lib/opsknight-agent/drain")']);
      await kubectl(['-n', namespace, 'rollout', 'restart', `deployment/${deployment}`]);
      await kubectl([
        '-n',
        namespace,
        'rollout',
        'status',
        `deployment/${deployment}`,
        '--timeout=120s',
      ]);
      const identity = await exec([
        'node',
        '-e',
        'process.stdout.write(JSON.parse(require("fs").readFileSync("/var/lib/opsknight-agent/identity.json")).agentId)',
      ]);
      if (identity.stdout !== enrollment.agent.id)
        throw new Error(`${topology} lost Agent identity.`);
      evidence.push({
        topology,
        enrollment: 'PASS',
        readiness: 'PASS',
        drainBlocksReadiness: 'PASS',
        drainPreservesLiveness: 'PASS',
        restartIdentity: 'PASS',
      });
    } finally {
      await kubectl(['delete', 'namespace', namespace, '--wait=false']);
    }
  }
  await writeFile(
    'test-results/runbook-engine/live-kind.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        context,
        evidence,
        limitations: [
          'Locally built arm64 candidate',
          'No published image pull, real ingress, application HA or physical host certification',
        ],
      },
      null,
      2
    )
  );
}
