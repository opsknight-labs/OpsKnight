/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- Fixture-owned temporary paths and enumerated deployment methods; no external path or method input. */
import type { Prisma } from '@prisma/client';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSetupCommands } from '@/lib/runbooks/agent-setup-commands';
import { agentDeploymentIdentity } from '@/lib/runbooks/agent-deployment';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { testPrisma, createTestService } from './test-db';

const run = promisify(execFile);
async function until(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Fleet certification timed out: ${description}`);
}
async function script(text: string, input: string, env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', ['-c', text], {
      env,
      timeout: 180_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => {
      output = (output + data).slice(-8000);
    });
    child.stderr.on('data', data => {
      output = (output + data).slice(-8000);
    });
    child.stdin.end(input);
    child.on('error', reject);
    child.on('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`Generated fleet command failed (${code}): ${output}`))
    );
  });
}
/** Opt-in, disposable cluster only. The production UI and this fixture use the same generator. */
export async function smokeAgentFleet(
  directory: string,
  actorId: string,
  endpoint: string,
  baseImage: string
) {
  const context = 'kind-rbe-engine-cert';
  const image = `opsknight-agent:rbe-fleet-${process.pid}`;
  const caDirectory = join(directory, 'fleet-ca');
  await run('mkdir', ['-p', caDirectory]);
  await writeFile(join(caDirectory, 'tls.crt'), await readFile(join(directory, 'tls.crt')));
  await writeFile(
    join(caDirectory, 'Dockerfile'),
    `FROM ${baseImage}\nCOPY tls.crt /etc/rbe/tls.crt\nENV NODE_EXTRA_CA_CERTS=/etc/rbe/tls.crt\n`
  );
  await run('docker', ['build', '-t', image, caDirectory], { timeout: 120_000 });
  const kubeconfig = join(directory, 'fleet-kubeconfig');
  const config = await run('kind', ['get', 'kubeconfig', '--name', 'rbe-engine-cert']);
  await writeFile(kubeconfig, config.stdout, { mode: 0o600 });
  await run('kind', ['load', 'docker-image', '--name', 'rbe-engine-cert', image], {
    timeout: 120_000,
  });
  const kubectl = (args: string[]) =>
    run('kubectl', ['--context', context, '-n', 'opsknight', ...args], {
      env: { ...process.env, KUBECONFIG: kubeconfig },
      timeout: 120_000,
    });
  const nodeId = (await run('docker', ['info', '--format', '{{.Swarm.NodeID}}'])).stdout.trim();
  if (!nodeId) throw new Error('Fleet smoke requires a preconfigured disposable Swarm manager.');
  const network = `rbe-fleet-${crypto.randomUUID().slice(0, 8)}`;
  await run('docker', ['network', 'create', '--driver', 'overlay', '--attachable', network]);
  const evidence: unknown[] = [];
  try {
    for (const platform of ['swarm', 'helm', 'kustomize'] as const) {
      const enrollments = await Promise.all(
        [0, 1].map(index =>
          createAgentEnrollment({ name: `${platform} independent ${index}`, actorId })
        )
      );
      const env = {
        ...process.env,
        KUBECONFIG: kubeconfig,
        CURL_CA_BUNDLE: join(directory, 'tls.crt'),
        SWARM_NETWORK_NAME: network,
      };
      const names = enrollments.map(enrollment => agentDeploymentIdentity(enrollment.agent.id));
      try {
        for (const enrollment of enrollments) {
          const commands = agentSetupCommands({
            agentId: enrollment.agent.id,
            image,
            url: endpoint,
            executionPublicKey: enrollment.executionPublicKey,
            policyPath: 'agent/policy.container.json',
          });
          await script(commands[platform], `${enrollment.token}\n${nodeId}\n`, env);
        }
        await until(
          async () =>
            (await testPrisma.runbookAgent.count({
              where: {
                id: { in: enrollments.map(value => value.agent.id) },
                status: 'ONLINE',
                lastHeartbeatAt: { gt: new Date(Date.now() - 90_000) },
              },
            })) === 2,
          `${platform} both online`
        );
        const service = await createTestService(`Fleet ${platform}`);
        const definition = parseRunbookDefinition({
          steps: [
            {
              key: 'summary',
              name: 'Fleet read-only diagnostic',
              type: 'LINUX_DIAGNOSTICS',
              riskClass: 'READ_ONLY',
              config: { diagnostic: 'summary' },
            },
          ],
        });
        const workflow = await testPrisma.runbook.create({
          data: { name: `Fleet ${platform}`, slug: `fleet-${crypto.randomUUID()}` },
        });
        const version = await testPrisma.runbookVersion.create({
          data: {
            runbookId: workflow.id,
            version: 1,
            state: 'PUBLISHED',
            definition: definition as unknown as Prisma.InputJsonValue,
            checksum: computeDefinitionChecksum(definition),
            publishedAt: new Date(),
          },
        });
        await testPrisma.runbook.update({
          where: { id: workflow.id },
          data: { publishedVersionId: version.id },
        });
        const bindings = await Promise.all(
          enrollments.map(enrollment =>
            testPrisma.serviceAutomationRule.create({
              data: {
                serviceId: service.id,
                runbookId: workflow.id,
                runbookVersionId: version.id,
                versionStrategy: 'PINNED',
                defaultAgentId: enrollment.agent.id,
              },
            })
          )
        );
        const runFor = async (index: number) => {
          const request = {
            runbookId: workflow.id,
            runbookVersionId: version.id,
            serviceId: service.id,
            bindingId: bindings[index].id,
            triggeredByUserId: actorId,
          };
          const preview = await previewRunbookExecution(request);
          const execution = await startRunbookExecution({
            ...request,
            expectedPlanDigest: preview.digest,
            previewAuthorizationToken: preview.authorizationToken,
          });
          await until(
            async () =>
              (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } }))
                .status === 'SUCCEEDED',
            `${platform} execution ${index}`
          );
          const claimed = await testPrisma.runbookStepAttempt.findFirstOrThrow({
            where: { executionStep: { executionId: execution.id } },
          });
          if (claimed.claimedAgentId !== enrollments[index].agent.id)
            throw new Error('Fleet execution crossed Agent identities.');
        };
        await Promise.all([runFor(0), runFor(1)]);
        for (const enrollment of enrollments) {
          const commands = agentSetupCommands({
            agentId: enrollment.agent.id,
            image,
            url: endpoint,
            executionPublicKey: enrollment.executionPublicKey,
            policyPath: 'agent/policy.container.json',
            operation: 'upgrade',
          });
          await script(commands[platform], '', env);
        }
        if (platform === 'swarm')
          await run(
            'docker',
            ['service', 'update', '--force', `${names[0].name}_opsknight-agent`],
            { timeout: 120_000 }
          );
        else {
          const deployment = platform === 'helm' ? `${names[0].name}-agent` : names[0].name;
          await kubectl(['rollout', 'restart', `deployment/${deployment}`]);
          await kubectl(['rollout', 'status', `deployment/${deployment}`, '--timeout=120s']);
        }
        await until(
          async () =>
            (
              await testPrisma.runbookAgent.findUniqueOrThrow({
                where: { id: enrollments[0].agent.id },
              })
            ).status === 'ONLINE',
          `${platform} restarted identity`
        );
        await runFor(0);
        if (platform === 'swarm') await run('docker', ['stack', 'rm', names[0].name]);
        else if (platform === 'helm')
          await run('helm', ['uninstall', names[0].name, '-n', 'opsknight'], {
            env,
            timeout: 120_000,
          });
        else await script(`kubectl delete -k './${names[0].name}' --wait=true`, '', env);
        await runFor(1);
        evidence.push({
          platform,
          independentAgents: 2,
          distinctJobClaims: 'PASS',
          restartIdentity: 'PASS',
          upgradePreservesIdentity: 'PASS',
          removalIsolation: 'PASS',
        });
      } finally {
        for (const identity of names) {
          if (platform === 'swarm') {
            await run('docker', ['stack', 'rm', identity.name]).catch(() => undefined);
            await until(
              async () =>
                !(
                  await run('docker', [
                    'service',
                    'ls',
                    '--filter',
                    `label=com.docker.stack.namespace=${identity.name}`,
                    '--format',
                    '{{.ID}}',
                  ])
                ).stdout.trim(),
              'owned Swarm stack removal'
            ).catch(() => undefined);
            await run('docker', ['secret', 'rm', identity.enrollmentSecret]).catch(() => undefined);
            await run('docker', ['volume', 'rm', `${identity.name}_opsknight_agent_data`]).catch(
              () => undefined
            );
          } else if (platform === 'helm') {
            await run('helm', ['uninstall', identity.name, '-n', 'opsknight'], { env }).catch(
              () => undefined
            );
            await kubectl(['delete', 'secret', identity.enrollmentSecret, '--ignore-not-found']);
            await kubectl(['delete', 'pvc', `${identity.name}-agent`, '--ignore-not-found']);
          } else {
            await script(
              `kubectl delete -k './${identity.name}' --ignore-not-found`,
              '',
              env
            ).catch(() => undefined);
            await run('rm', ['-rf', `./${identity.name}`]);
          }
        }
      }
    }
  } finally {
    await run('docker', ['network', 'rm', network]).catch(() => undefined);
  }
  await writeFile(
    'test-results/runbook-engine/live-agent-fleet.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        evidence,
        limitations: [
          'Locally built candidate with a test CA',
          'Single-node disposable Swarm and Kind; physical HA and published distribution remain unqualified',
        ],
      },
      null,
      2
    )
  );
}
