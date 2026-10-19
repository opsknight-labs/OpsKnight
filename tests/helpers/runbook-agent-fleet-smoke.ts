/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- Fixture-owned temporary paths and enumerated deployment methods; no external path or method input. */
import type { Prisma } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSetupCommands } from '@/lib/runbooks/agent-setup-commands';
import { agentDeploymentIdentity } from '@/lib/runbooks/agent-deployment';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { testPrisma, createTestService } from './test-db';

import { runFleetCommand as script } from './runbook-fleet-command';
const run = promisify(execFile);
async function until(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Fleet certification timed out: ${description}`);
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
  const runtime = await run('docker', ['version', '--format', '{{json .}}']);
  await writeFile('test-results/runbook-engine/fleet-docker-version.json', runtime.stdout);
  const evidence: unknown[] = [];
  const failures: Error[] = [];
  try {
    for (const platform of ['compose', 'swarm', 'helm', 'kustomize'] as const) {
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
        XDG_STATE_HOME: join(directory, 'agent-state'),
        TMPDIR: directory,
        OPSKNIGHT_PULL_POLICY: 'never',
        OPSKNIGHT_AGENT_IMAGE: image,
        OPSKNIGHT_AGENT_URL: endpoint,
        OPSKNIGHT_EXECUTION_PUBLIC_KEY: enrollments[0].executionPublicKey,
        OPSKNIGHT_AGENT_POLICY_PATH: '../../agent/policy.container.json',
      };
      const names = enrollments.map(enrollment => agentDeploymentIdentity(enrollment.agent.id));
      try {
        for (const enrollment of enrollments) {
          const commands = agentSetupCommands({
            agentId: enrollment.agent.id,
            image,
            url: endpoint,
            executionPublicKey: enrollment.executionPublicKey,
            policyPath: '../../agent/policy.container.json',
          });
          await script(commands[platform], `${enrollment.token}\n${nodeId}\n`, env);
        }
        await until(
          async () =>
            (await testPrisma.runbookAgent.count({
              where: {
                id: { in: enrollments.map(value => value.agent.id) },
                status: 'ONLINE',
                capabilities: { array_contains: ['RUNBOOK_LINUX_DIAGNOSTICS'] },
                policyHash: { not: null },
                lastHeartbeatAt: { gt: new Date(Date.now() - 90_000) },
              },
            })) === 2,
          `${platform} both online`
        );
        const assertSwarmHealth = async () => {
          if (platform !== 'swarm') return;
          for (const identity of names) {
            const containers = await run('docker', [
              'ps',
              '-q',
              '--filter',
              `label=com.docker.swarm.service.name=${identity.name}_opsknight-agent`,
            ]);
            const container = containers.stdout.trim();
            if (!container || container.includes('\n'))
              throw new Error('Expected one running Swarm Agent task.');
            const mounts = await run('docker', [
              'inspect',
              '--format',
              '{{json .HostConfig.Mounts}}',
              container,
            ]);
            const parsed = JSON.parse(mounts.stdout) as Array<{ Type: string; Target: string }>;
            if (!parsed.some(mount => mount.Type === 'tmpfs' && mount.Target === '/tmp'))
              throw new Error('Swarm Agent /tmp must be an explicit writable tmpfs mount.');
            await until(async () => {
              try {
                await run(
                  'docker',
                  [
                    'exec',
                    container,
                    'node',
                    '/usr/local/bin/opsknight-agent-healthcheck.mjs',
                    'readiness',
                  ],
                  { timeout: 5000 }
                );
                return true;
              } catch {
                return false;
              }
            }, 'Swarm health file exists, is fresh and is ready before convergence');
            // Liveness remains a local progress check; readiness above also verifies the heartbeat.
            await run(
              'docker',
              [
                'exec',
                container,
                'node',
                '/usr/local/bin/opsknight-agent-healthcheck.mjs',
                'liveness',
              ],
              { timeout: 5000 }
            );
          }
        };
        await assertSwarmHealth();
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
            policyPath: '../../agent/policy.container.json',
            operation: 'upgrade',
          });
          await script(commands[platform], '', env);
        }
        await assertSwarmHealth();
        if (platform === 'compose')
          await run(
            'docker',
            [
              'compose',
              '-p',
              names[0].name,
              '-f',
              'deploy/compose/docker-compose.agent.yml',
              'restart',
              'opsknight-agent',
            ],
            { env, timeout: 120_000 }
          );
        else if (platform === 'swarm')
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
        await assertSwarmHealth();
        await runFor(0);
        if (platform === 'compose')
          await run(
            'docker',
            [
              'compose',
              '-p',
              names[0].name,
              '-f',
              'deploy/compose/docker-compose.agent.yml',
              'down',
              '-v',
            ],
            { env, timeout: 120_000 }
          );
        else if (platform === 'swarm') await run('docker', ['stack', 'rm', names[0].name]);
        else if (platform === 'helm')
          await run('helm', ['uninstall', names[0].name, '-n', 'opsknight'], {
            env,
            timeout: 120_000,
          });
        else {
          await run(
            'kubectl',
            [
              'delete',
              '-k',
              join(env.XDG_STATE_HOME, 'opsknight/agents', names[0].name),
              '--wait=true',
            ],
            { env, timeout: 120_000 }
          );
          await kubectl(['delete', 'secret', names[0].enrollmentSecret, '--ignore-not-found']);
        }
        await runFor(1);
        evidence.push({
          platform,
          independentAgents: 2,
          distinctJobClaims: 'PASS',
          restartIdentity: 'PASS',
          upgradePreservesIdentity: 'PASS',
          removalIsolation: 'PASS',
        });
      } catch (error) {
        // Capture only owned resources before cleanup; never inspect Secrets or service env.
        const diagnostics: unknown[] = [];
        for (const identity of names) {
          if (platform === 'compose') {
            const logs = await run(
              'docker',
              [
                'compose',
                '-p',
                identity.name,
                '-f',
                'deploy/compose/docker-compose.agent.yml',
                'logs',
                '--tail',
                '80',
              ],
              { env, timeout: 10_000 }
            ).catch(() => ({ stdout: 'Logs unavailable', stderr: '' }));
            diagnostics.push({ name: identity.name, ...logs });
          } else if (platform === 'swarm') {
            const containers = await run(
              'docker',
              ['ps', '-aq', '--filter', `label=com.docker.stack.namespace=${identity.name}`],
              { timeout: 10_000 }
            );
            for (const container of containers.stdout.trim().split(/\s+/).filter(Boolean)) {
              const state = await run(
                'docker',
                ['inspect', '--format', '{{json .State}}', container],
                { timeout: 10_000 }
              ).catch(() => ({ stdout: 'Container unavailable', stderr: '' }));
              diagnostics.push({ name: identity.name, container, ...state });
            }
            for (const args of [
              ['service', 'ps', '--no-trunc', `${identity.name}_opsknight-agent`],
              ['service', 'logs', '--tail', '80', `${identity.name}_opsknight-agent`],
            ]) {
              const result = await run('docker', args, { timeout: 10_000 }).catch(failure => ({
                stdout: '',
                stderr: failure instanceof Error ? failure.message : 'Diagnostic unavailable',
              }));
              diagnostics.push({ name: identity.name, command: args.slice(0, 2), ...result });
            }
          } else {
            const selector = `app.kubernetes.io/instance=${identity.name}`;
            for (const args of [
              ['get', 'pods', '-l', selector, '-o', 'wide'],
              ['logs', '-l', selector, '--all-containers', '--tail=80'],
              ['get', 'events', '--field-selector=type=Warning'],
            ]) {
              const result = await kubectl(args).catch(failure => ({
                stdout: '',
                stderr: failure instanceof Error ? failure.message : 'Diagnostic unavailable',
              }));
              diagnostics.push({ name: identity.name, command: args.slice(0, 2), ...result });
            }
          }
        }
        diagnostics.push({
          agents: await testPrisma.runbookAgent.findMany({
            where: { id: { in: enrollments.map(value => value.agent.id) } },
            select: {
              id: true,
              status: true,
              capabilities: true,
              policyHash: true,
              lastHeartbeatAt: true,
              lastError: true,
            },
          }),
        });
        // Redact the one-time credentials even if a future subprocess prints one.
        let report = JSON.stringify({ platform, diagnostics }, null, 2);
        for (const enrollment of enrollments)
          report = report.replaceAll(enrollment.token, '[REDACTED]');
        await writeFile(
          `test-results/runbook-engine/live-agent-fleet-${platform}-failure.json`,
          report
        );
        let reason =
          error instanceof Error ? error.message : 'Fleet lifecycle certification failed';
        for (const enrollment of enrollments)
          reason = reason.replaceAll(enrollment.token, '[REDACTED]');
        failures.push(new Error(`${platform}: ${reason}`));
        evidence.push({ platform, status: 'FAIL', reason });
      } finally {
        for (const identity of names) {
          if (platform === 'compose') {
            await run(
              'docker',
              [
                'compose',
                '-p',
                identity.name,
                '-f',
                'deploy/compose/docker-compose.agent.yml',
                'down',
                '-v',
              ],
              { env, timeout: 120_000 }
            ).catch(() => undefined);
          } else if (platform === 'swarm') {
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
            const overlay = join(env.XDG_STATE_HOME, 'opsknight/agents', identity.name);
            await run('kubectl', ['delete', '-k', overlay, '--ignore-not-found'], {
              env,
              timeout: 120_000,
            }).catch(() => undefined);
            await kubectl(['delete', 'secret', identity.enrollmentSecret, '--ignore-not-found']);
            await run('rm', ['-rf', overlay]);
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
  if (failures.length)
    throw new AggregateError(failures, 'Agent fleet lifecycle certification failed');
}
