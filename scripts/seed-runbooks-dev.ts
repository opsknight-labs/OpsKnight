/**
 * Local-only demo data for the runbook UI: library, versions, service rules,
 * agents/pools and executions in every interesting state.
 *
 * Usage: npm run seed:runbooks:dev   (requires `prisma db seed` first)
 */
import { PrismaClient, type Prisma, type RunbookExecutionStatus } from '@prisma/client';
import { computeDefinitionChecksum } from '@/lib/runbooks/definition';
import { runbookTemplate, runbookTemplateInputs } from '@/lib/runbooks/builder';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed-runbooks-dev must not run in production.');
}

const prisma = new PrismaClient();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const json = (value: unknown) => value as Prisma.InputJsonValue;

const environmentInput: RunbookInputInput = {
  key: 'environment',
  label: 'Environment',
  type: 'SELECT',
  required: true,
  defaultValue: 'production',
  description: 'Which environment this run targets',
  sequence: 0,
  options: ['production', 'staging', 'development'],
};

async function createRunbook(input: {
  slug: string;
  name: string;
  description: string;
  definition: RunbookDefinition;
  inputs: RunbookInputInput[];
  actorId: string;
  publish: boolean;
  draftChange?: (definition: RunbookDefinition) => RunbookDefinition;
  archived?: boolean;
}) {
  const existing = await prisma.runbook.findUnique({ where: { slug: input.slug } });
  if (existing?.publishedVersionId || existing?.draftVersionId) return existing;
  if (existing) await prisma.runbook.delete({ where: { id: existing.id } });

  const inputRows = input.inputs.map((item, sequence) => ({
    key: item.key,
    label: item.label,
    type: item.type,
    required: item.required,
    defaultValue: item.defaultValue,
    description: item.description,
    sequence,
    options: item.options ?? [],
  }));
  return prisma.$transaction(async tx => {
    const runbook = await tx.runbook.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        createdById: input.actorId,
        archivedAt: input.archived ? minutesAgo(60 * 24 * 3) : null,
      },
    });
    // Inputs are immutable once published (DB trigger), so publish after creating them.
    const v1 = await tx.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        definition: json(input.definition),
        checksum: computeDefinitionChecksum(input.definition),
        createdById: input.actorId,
        inputs: { createMany: { data: inputRows } },
      },
    });
    if (input.publish) {
      await tx.runbookVersion.update({
        where: { id: v1.id },
        data: {
          state: 'PUBLISHED',
          publishedById: input.actorId,
          publishedAt: minutesAgo(60 * 24 * 7),
        },
      });
    }
    let draftVersionId: string | null = input.publish ? null : v1.id;
    if (input.publish && input.draftChange) {
      const next = input.draftChange(input.definition);
      const v2 = await tx.runbookVersion.create({
        data: {
          runbookId: runbook.id,
          version: 2,
          state: 'DRAFT',
          definition: json(next),
          checksum: computeDefinitionChecksum(next),
          createdById: input.actorId,
          inputs: { createMany: { data: inputRows } },
        },
      });
      draftVersionId = v2.id;
    }
    return tx.runbook.update({
      where: { id: runbook.id },
      data: { publishedVersionId: input.publish ? v1.id : null, draftVersionId },
    });
  });
}

async function createExecution(input: {
  runbookId: string;
  serviceId: string;
  bindingId: string;
  incidentId: string | null;
  actorId: string;
  agentId: string;
  status: RunbookExecutionStatus;
  startedMinutesAgo: number;
  durationMinutes?: number;
  // Index of the step that is running / failed / awaiting approval.
  focusStep: number;
  failure?: string;
}) {
  const runbook = await prisma.runbook.findUniqueOrThrow({
    where: { id: input.runbookId },
    include: { publishedVersion: true },
  });
  const version = runbook.publishedVersion!;
  const definition = version.definition as unknown as RunbookDefinition;
  const startedAt = minutesAgo(input.startedMinutesAgo);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(input.status);
  const completedAt =
    terminal && input.durationMinutes !== undefined
      ? new Date(startedAt.getTime() + input.durationMinutes * 60_000)
      : null;

  const stepStatus = (index: number) => {
    if (input.status === 'SUCCEEDED') return 'SUCCEEDED' as const;
    if (index < input.focusStep) return 'SUCCEEDED' as const;
    if (index > input.focusStep)
      return input.status === 'FAILED' ? ('SKIPPED' as const) : ('PENDING' as const);
    if (input.status === 'FAILED') return 'FAILED' as const;
    if (input.status === 'WAITING_APPROVAL') return 'WAITING_APPROVAL' as const;
    return 'RUNNING' as const;
  };

  return prisma.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      serviceId: input.serviceId,
      bindingId: input.bindingId,
      incidentId: input.incidentId,
      status: input.status,
      startedAt,
      completedAt,
      deadlineAt: new Date(startedAt.getTime() + 3600_000),
      triggeredByType: 'USER',
      triggeredByUserId: input.actorId,
      failureCode: input.status === 'FAILED' ? 'STEP_FAILED' : null,
      failureMessage: input.failure ?? null,
      inputValues: json({ environment: 'production' }),
      definitionChecksum: version.checksum,
      resolvedTargetAgentId: input.agentId,
      steps: {
        create: definition.steps.map((step, index) => {
          const status = stepStatus(index);
          const stepStarted = new Date(startedAt.getTime() + index * 45_000);
          return {
            stepKey: step.key,
            sequence: index,
            name: step.name,
            type: step.type,
            riskClass: step.riskClass,
            requiresApproval: Boolean(step.requiresApproval),
            config: json(step.config),
            status,
            attemptCount: status === 'PENDING' || status === 'SKIPPED' ? 0 : 1,
            startedAt: status === 'PENDING' || status === 'SKIPPED' ? null : stepStarted,
            completedAt:
              status === 'SUCCEEDED' || status === 'FAILED'
                ? new Date(stepStarted.getTime() + 30_000)
                : null,
            outputPreview:
              status === 'SUCCEEDED'
                ? `${step.name} completed.\nload average: 0.42 0.38 0.35\nactive (running) since 2h`
                : null,
            errorCode: status === 'FAILED' ? 'EXIT_NON_ZERO' : null,
            errorMessage: status === 'FAILED' ? (input.failure ?? 'Step exited with code 1') : null,
          };
        }),
      },
    },
  });
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  if (!admin) throw new Error('Run `npx prisma db seed` first (admin@example.com not found).');
  const services = await prisma.service.findMany({ orderBy: { createdAt: 'asc' }, take: 3 });
  if (services.length === 0) throw new Error('No services found; run the base seed first.');

  const capabilities = ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES', 'HTTP', 'BASH'];
  const agentSeed = [
    { name: 'prod-api-01', hostname: 'ip-10-0-1-12', status: 'ONLINE' as const, heartbeat: 0.3 },
    { name: 'prod-api-02', hostname: 'ip-10-0-1-13', status: 'DEGRADED' as const, heartbeat: 4 },
    {
      name: 'staging-runner',
      hostname: 'stg-runner-1',
      status: 'OFFLINE' as const,
      heartbeat: 600,
    },
  ];
  const agents = [];
  for (const agent of agentSeed) {
    agents.push(
      (await prisma.runbookAgent.findFirst({ where: { name: agent.name } })) ??
        (await prisma.runbookAgent.create({
          data: {
            name: agent.name,
            hostname: agent.hostname,
            status: agent.status,
            enrolledAt: minutesAgo(60 * 24 * 14),
            lastHeartbeatAt: minutesAgo(agent.heartbeat),
            version: '2.1.0',
            platform: 'linux-arm64',
            labels: json({ environment: agent.name.startsWith('prod') ? 'production' : 'staging' }),
            capabilities: json(capabilities),
            createdById: admin.id,
          },
        }))
    );
  }
  const pool =
    (await prisma.runbookAgentPool.findFirst({ where: { name: 'Production Linux' } })) ??
    (await prisma.runbookAgentPool.create({
      data: {
        name: 'Production Linux',
        description: 'API hosts in the production VPC',
        matchLabels: json({ environment: 'production' }),
        createdById: admin.id,
        members: { create: agents.slice(0, 2).map(agent => ({ agentId: agent.id })) },
      },
    }));

  const recovery = await createRunbook({
    slug: 'linux-service-recovery',
    name: 'Linux service recovery',
    description: 'Capture diagnostics, restart a systemd unit with approval, then verify.',
    definition: runbookTemplate('service-recovery'),
    inputs: [environmentInput],
    actorId: admin.id,
    publish: true,
    draftChange: definition => ({
      ...definition,
      steps: definition.steps.map(step =>
        step.key === 'restart' ? { ...step, name: 'Restart service (graceful)' } : step
      ),
    }),
  });
  const kubernetes = await createRunbook({
    slug: 'kubernetes-deployment-restart',
    name: 'Kubernetes deployment restart',
    description: 'Inspect, rollout-restart and verify a deployment.',
    definition: runbookTemplate('kubernetes-recovery'),
    inputs: [...runbookTemplateInputs('kubernetes-recovery'), { ...environmentInput, sequence: 2 }],
    actorId: admin.id,
    publish: true,
  });
  const diagnostics = await createRunbook({
    slug: 'host-diagnostics',
    name: 'Host diagnostics',
    description: 'Read-only CPU, memory, disk and network snapshot.',
    definition: runbookTemplate('diagnostics'),
    inputs: [],
    actorId: admin.id,
    publish: true,
  });
  await createRunbook({
    slug: 'legacy-cache-flush',
    name: 'Legacy cache flush',
    description: 'Replaced by the Redis operator. Kept for audit history.',
    definition: runbookTemplate('empty'),
    inputs: [],
    actorId: admin.id,
    publish: true,
    archived: true,
  });
  await createRunbook({
    slug: 'database-failover',
    name: 'Database failover',
    description: 'Work in progress: promote the replica and repoint the API.',
    definition: runbookTemplate('empty'),
    inputs: [],
    actorId: admin.id,
    publish: false,
  });

  const [primary, secondary] = services;
  const existingRules = await prisma.serviceAutomationRule.count({
    where: { serviceId: primary.id },
  });
  if (existingRules > 0) {
    console.log('Runbook demo rules already exist; skipping rules and executions.');
    return;
  }

  const suggestedRule = await prisma.serviceAutomationRule.create({
    data: {
      serviceId: primary.id,
      runbookId: recovery.id,
      name: 'High-urgency API recovery',
      mode: 'SUGGESTED',
      enabled: true,
      defaultAgentPoolId: pool.id,
      inputValues: json({ environment: 'production' }),
      createdById: admin.id,
      triggers: {
        create: {
          event: 'INCIDENT_CREATED',
          conditionLogic: 'AND',
          createdById: admin.id,
          conditions: {
            create: { field: 'incident.urgency', operator: 'EQUALS', value: json('HIGH') },
          },
        },
      },
    },
  });
  const manualRule = await prisma.serviceAutomationRule.create({
    data: {
      serviceId: primary.id,
      runbookId: diagnostics.id,
      name: 'On-demand host snapshot',
      mode: 'MANUAL',
      enabled: true,
      defaultAgentId: agents[0].id,
      createdById: admin.id,
    },
  });
  await prisma.serviceAutomationRule.create({
    data: {
      serviceId: primary.id,
      runbookId: kubernetes.id,
      name: 'Auto-restart crashlooping deployment',
      mode: 'AUTOMATIC',
      enabled: false,
      versionStrategy: 'PINNED',
      runbookVersionId: (await prisma.runbook.findUniqueOrThrow({ where: { id: kubernetes.id } }))
        .publishedVersionId,
      defaultAgentPoolId: pool.id,
      inputValues: json({
        namespace: 'payments',
        deployment_name: 'api',
        environment: 'production',
      }),
      createdById: admin.id,
      triggers: {
        create: {
          event: 'INCIDENT_CREATED',
          createdById: admin.id,
          conditions: {
            create: {
              field: 'incident.title',
              operator: 'CONTAINS',
              value: json('CrashLoopBackOff'),
            },
          },
        },
      },
    },
  });
  if (secondary) {
    await prisma.serviceAutomationRule.create({
      data: {
        serviceId: secondary.id,
        runbookId: diagnostics.id,
        name: '',
        mode: 'MANUAL',
        enabled: true,
        defaultAgentId: agents[0].id,
        createdById: admin.id,
      },
    });
  }

  const incidents = await prisma.incident.findMany({
    where: { serviceId: primary.id },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: { id: true },
  });
  const incidentAt = (index: number) => incidents[index]?.id ?? null;
  const common = { serviceId: primary.id, actorId: admin.id, agentId: agents[0].id };

  await createExecution({
    ...common,
    runbookId: diagnostics.id,
    bindingId: manualRule.id,
    incidentId: incidentAt(0),
    status: 'SUCCEEDED',
    startedMinutesAgo: 180,
    durationMinutes: 1,
    focusStep: 0,
  });
  await createExecution({
    ...common,
    runbookId: recovery.id,
    bindingId: suggestedRule.id,
    incidentId: incidentAt(1),
    status: 'FAILED',
    startedMinutesAgo: 95,
    durationMinutes: 3,
    focusStep: 2,
    failure: 'systemctl restart api.service: Job for api.service failed (exit 1).',
  });
  await createExecution({
    ...common,
    runbookId: recovery.id,
    bindingId: suggestedRule.id,
    incidentId: incidentAt(2),
    status: 'WAITING_APPROVAL',
    startedMinutesAgo: 6,
    focusStep: 2,
  });
  await createExecution({
    ...common,
    runbookId: diagnostics.id,
    bindingId: manualRule.id,
    incidentId: incidentAt(3),
    status: 'RUNNING',
    startedMinutesAgo: 1,
    focusStep: 0,
  });

  console.log(
    `Runbook demo data ready: 5 runbooks, ${secondary ? 4 : 3} rules, 3 agents, 1 pool, 4 executions.`
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
