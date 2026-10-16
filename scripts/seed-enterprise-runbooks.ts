/**
 * Enterprise seed script for Runbooks, Services, Agents, Rules and Executions.
 * Creates rich multi-version runbooks (v1, v2, v3, Draft, Published, Retired, Archived),
 * live running agents, realistic service bindings, and multi-state execution logs.
 */
import { PrismaClient, type Prisma, type RunbookExecutionStatus } from '@prisma/client';
import { computeDefinitionChecksum } from '@/lib/runbooks/definition';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed-enterprise-runbooks must not run in production.');
}

const prisma = new PrismaClient();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000);
const json = (value: unknown) => value as Prisma.InputJsonValue;

type VersionPlan = {
  version: number;
  state: 'PUBLISHED' | 'DRAFT' | 'RETIRED';
  definition: RunbookDefinition;
  inputs?: RunbookInputInput[];
  publishedDaysAgo?: number;
};

async function seedEnterpriseRunbook(params: {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  ownerTeamId?: string | null;
  actorId: string;
  archived?: boolean;
  versions: VersionPlan[];
}) {
  const existing = await prisma.runbook.findUnique({
    where: { slug: params.slug },
    include: { publishedVersion: true, draftVersion: true },
  });
  if (existing) {
    const updated = await prisma.runbook.update({
      where: { id: existing.id },
      data: {
        name: params.name,
        description: params.description,
        tags: params.tags,
        ownerTeamId: params.ownerTeamId ?? null,
      },
      include: {
        publishedVersion: true,
        draftVersion: true,
        versions: { orderBy: { version: 'desc' } },
      },
    });
    return updated;
  }

  return prisma.$transaction(async tx => {
    const runbook = await tx.runbook.create({
      data: {
        slug: params.slug,
        name: params.name,
        description: params.description,
        tags: params.tags,
        ownerTeamId: params.ownerTeamId ?? null,
        createdById: params.actorId,
        archivedAt: params.archived ? daysAgo(14) : null,
      },
    });

    let publishedVersionId: string | null = null;
    let draftVersionId: string | null = null;

    for (const vPlan of params.versions) {
      const inputRows = (vPlan.inputs ?? []).map((inp, seq) => ({
        key: inp.key,
        label: inp.label,
        type: inp.type,
        required: inp.required,
        defaultValue: inp.defaultValue,
        description: inp.description,
        sequence: seq,
        options: inp.options ?? [],
      }));

      const checksum = computeDefinitionChecksum(vPlan.definition);
      const isPublished = vPlan.state === 'PUBLISHED';
      const isDraft = vPlan.state === 'DRAFT';
      const isRetired = vPlan.state === 'RETIRED';

      const created = await tx.runbookVersion.create({
        data: {
          runbookId: runbook.id,
          version: vPlan.version,
          state: 'DRAFT',
          definition: json(vPlan.definition),
          checksum,
          createdById: params.actorId,
          inputs: { createMany: { data: inputRows } },
        },
      });

      if (isPublished) {
        await tx.runbookVersion.update({
          where: { id: created.id },
          data: {
            state: 'PUBLISHED',
            publishedById: params.actorId,
            publishedAt: daysAgo(vPlan.publishedDaysAgo ?? 5),
          },
        });
        publishedVersionId = created.id;
      } else if (isRetired) {
        await tx.runbookVersion.update({
          where: { id: created.id },
          data: {
            state: 'PUBLISHED',
            publishedById: params.actorId,
            publishedAt: daysAgo(vPlan.publishedDaysAgo ?? 30),
          },
        });
        await tx.runbookVersion.update({
          where: { id: created.id },
          data: { state: 'RETIRED' },
        });
      } else if (isDraft) {
        draftVersionId = created.id;
      }
    }

    return tx.runbook.update({
      where: { id: runbook.id },
      data: {
        publishedVersionId,
        draftVersionId,
      },
      include: {
        publishedVersion: true,
        draftVersion: true,
        versions: { orderBy: { version: 'desc' } },
      },
    });
  });
}

async function main() {
  console.log('Seeding enterprise runbooks and services...');
  const admin = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  if (!admin) throw new Error('Run `npx prisma db seed` first (admin@example.com not found).');

  // 1. Ensure Enterprise Teams
  const teamNames = [
    'Platform Engineering',
    'Site Reliability Engineering',
    'Database Operations',
    'Core Payments',
    'Security Operations',
  ];
  const teamsMap = new Map<string, string>();
  for (const name of teamNames) {
    let team = await prisma.team.findFirst({ where: { name } });
    if (!team) {
      team = await prisma.team.create({
        data: {
          name,
          description: `Responsible for ${name.toLowerCase()} enterprise infrastructure and recovery.`,
        },
      });
    }
    teamsMap.set(name, team.id);
  }

  // 2. Ensure Enterprise Agents & Pools (Active / Online)
  const agentConfigs = [
    {
      name: 'k8s-prod-us-east-worker-01',
      hostname: 'ip-10-0-4-88',
      status: 'ONLINE' as const,
      heartbeatMin: 0.1,
      platform: 'linux-x86_64',
      version: '2.4.1',
      labels: { environment: 'production', cluster: 'us-east-1', tier: 'kubernetes' },
    },
    {
      name: 'db-replica-us-east-pg02',
      hostname: 'ip-10-0-12-19',
      status: 'ONLINE' as const,
      heartbeatMin: 0.2,
      platform: 'linux-x86_64',
      version: '2.4.1',
      labels: { environment: 'production', role: 'db-replica', tier: 'database' },
    },
    {
      name: 'edge-proxy-eu-west-ingress',
      hostname: 'ip-10-2-8-44',
      status: 'ONLINE' as const,
      heartbeatMin: 0.3,
      platform: 'linux-arm64',
      version: '2.4.0',
      labels: { environment: 'production', region: 'eu-west-1', tier: 'edge' },
    },
    {
      name: 'payments-runner-isolated',
      hostname: 'ip-10-10-1-5',
      status: 'ONLINE' as const,
      heartbeatMin: 0.15,
      platform: 'linux-x86_64',
      version: '2.4.1',
      labels: { environment: 'production', pci: 'enclave', tier: 'payments' },
    },
  ];

  const agentIds: string[] = [];
  for (const ac of agentConfigs) {
    let agent = await prisma.runbookAgent.findFirst({ where: { name: ac.name } });
    if (!agent) {
      agent = await prisma.runbookAgent.create({
        data: {
          name: ac.name,
          hostname: ac.hostname,
          status: ac.status,
          enrolledAt: daysAgo(30),
          lastHeartbeatAt: minutesAgo(ac.heartbeatMin),
          version: ac.version,
          platform: ac.platform,
          labels: json(ac.labels),
          capabilities: json([
            'LINUX_DIAGNOSTICS',
            'SYSTEMD',
            'DOCKER',
            'KUBERNETES',
            'HTTP',
            'BASH',
          ]),
          createdById: admin.id,
        },
      });
    } else {
      agent = await prisma.runbookAgent.update({
        where: { id: agent.id },
        data: {
          status: 'ONLINE',
          lastHeartbeatAt: minutesAgo(ac.heartbeatMin),
        },
      });
    }
    agentIds.push(agent.id);
  }

  // Ensure pools
  let k8sPool = await prisma.runbookAgentPool.findFirst({
    where: { name: 'Production Kubernetes Cluster' },
  });
  if (!k8sPool) {
    k8sPool = await prisma.runbookAgentPool.create({
      data: {
        name: 'Production Kubernetes Cluster',
        description: 'Auto-scaled workers running Kubernetes node agents.',
        matchLabels: json({ tier: 'kubernetes' }),
        createdById: admin.id,
        members: { create: [{ agentId: agentIds[0] }] },
      },
    });
  }

  let dbPool = await prisma.runbookAgentPool.findFirst({ where: { name: 'Core Database Fleet' } });
  if (!dbPool) {
    dbPool = await prisma.runbookAgentPool.create({
      data: {
        name: 'Core Database Fleet',
        description: 'High-availability PostgreSQL replica host agents.',
        matchLabels: json({ tier: 'database' }),
        createdById: admin.id,
        members: { create: [{ agentId: agentIds[1] }] },
      },
    });
  }

  // Common input definitions
  const envInput: RunbookInputInput = {
    key: 'environment',
    label: 'Target Environment',
    type: 'SELECT',
    required: true,
    defaultValue: 'production',
    description: 'Target infrastructure tier for automation run',
    sequence: 0,
    options: ['production', 'staging', 'dr-sandbox'],
  };

  // 3. Define 10 Enterprise Runbooks
  // 1. PostgreSQL Automated Failover
  const pgRunbook = await seedEnterpriseRunbook({
    slug: 'postgres-failover-promotion',
    name: 'PostgreSQL Automated Failover & Replica Promotion',
    description:
      'Pre-flight replication lag check, promote standby replica via pg_ctl, verify read-write transactions, and repoint PgBouncer connection pool.',
    tags: ['database', 'ha', 'tier-1', 'postgres', 'failover'],
    ownerTeamId: teamsMap.get('Database Operations'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'RETIRED',
        publishedDaysAgo: 30,
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'check_lag',
              name: 'Check standby replication lag',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: { command: 'psql -c "SELECT pg_last_wal_replay_lsn();"' },
            },
            {
              key: 'manual_promote',
              name: 'Promote standby instance',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: { command: 'pg_ctl promote -D /var/lib/postgresql/data' },
            },
          ],
        },
      },
      {
        version: 2,
        state: 'PUBLISHED',
        publishedDaysAgo: 10,
        inputs: [
          envInput,
          {
            key: 'target_replica',
            label: 'Target Replica Host',
            type: 'STRING',
            required: true,
            defaultValue: 'pg-replica-02.internal.opsknight.net',
            description: 'Fully qualified hostname of candidate standby',
            sequence: 1,
          },
          {
            key: 'drain_timeout_seconds',
            label: 'Connection Drain Timeout (sec)',
            type: 'NUMBER',
            required: false,
            defaultValue: '30',
            description: 'Max time to wait for active read transactions to conclude',
            sequence: 2,
          },
        ],
        definition: {
          steps: [
            {
              key: 'preflight',
              name: 'Verify standby health & replication sync',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command: 'psql -h ${{ inputs.target_replica }} -c "SELECT pg_is_in_recovery();"',
              },
            },
            {
              key: 'drain_pool',
              name: 'Pause PgBouncer traffic to failed primary',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: { command: 'pgbouncer-cli pause opsknight_db' },
            },
            {
              key: 'promote_replica',
              name: 'Promote standby replica to read-write primary',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: { command: 'pg_ctl promote -D /var/lib/postgresql/data' },
              verification: {
                steps: [
                  {
                    key: 'verify_rw',
                    name: 'Verify read-write transaction capability',
                    type: 'BASH',
                    riskClass: 'READ_ONLY',
                    config: {
                      command: 'psql -c "CREATE TEMP TABLE failover_test (ts timestamptz);"',
                    },
                  },
                ],
              },
            },
            {
              key: 'resume_pool',
              name: 'Repoint PgBouncer backend & resume query routing',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              config: { command: 'pgbouncer-cli resume opsknight_db' },
            },
          ],
        },
      },
      {
        version: 3,
        state: 'DRAFT',
        inputs: [
          envInput,
          {
            key: 'target_replica',
            label: 'Target Replica Host',
            type: 'STRING',
            required: true,
            defaultValue: 'pg-replica-02.internal.opsknight.net',
            description: 'Fully qualified hostname of candidate standby',
            sequence: 1,
          },
        ],
        definition: {
          steps: [
            {
              key: 'preflight',
              name: 'Verify standby health & replication sync',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command: 'psql -h ${{ inputs.target_replica }} -c "SELECT pg_is_in_recovery();"',
              },
            },
            {
              key: 'slack_alert',
              name: 'Post failover initiation notice to #incident-war-room',
              type: 'HTTP',
              riskClass: 'READ_ONLY',
              config: {
                method: 'POST',
                url: 'https://hooks.slack.com/services/internal/failover-alert',
              },
            },
            {
              key: 'promote_replica',
              name: 'Promote standby replica with automated rewind hook',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: { command: 'pg_ctl promote -D /var/lib/postgresql/data' },
            },
          ],
        },
      },
    ],
  });

  // 2. Kubernetes Pod OOMKilled & CrashLoop Remediation
  const k8sRunbook = await seedEnterpriseRunbook({
    slug: 'k8s-pod-crashloop-remediation',
    name: 'Kubernetes Pod CrashLoop & OOMKilled Remediation',
    description:
      'Gathers container dmesg crash diagnostics, evicts terminating zombie pods, triggers graceful rollout restart, and verifies deployment health.',
    tags: ['k8s', 'containers', 'oom', 'crashloop', 'rollout'],
    ownerTeamId: teamsMap.get('Platform Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 15,
        inputs: [
          envInput,
          {
            key: 'namespace',
            label: 'Kubernetes Namespace',
            type: 'STRING',
            required: true,
            defaultValue: 'production',
            description: 'Target namespace',
            sequence: 1,
          },
          {
            key: 'deployment_name',
            label: 'Deployment Name',
            type: 'STRING',
            required: true,
            defaultValue: 'checkout-api',
            description: 'Target deployment resource',
            sequence: 2,
          },
        ],
        definition: {
          steps: [
            {
              key: 'diagnostics',
              name: 'Inspect pods & capture exit status',
              type: 'KUBERNETES',
              riskClass: 'READ_ONLY',
              config: {
                action: 'get',
                namespace: '${{ inputs.namespace }}',
                resource: 'deployment',
                name: '${{ inputs.deployment_name }}',
              },
            },
            {
              key: 'rollout_restart',
              name: 'Rollout restart deployment pods',
              type: 'KUBERNETES',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: {
                action: 'rollout-restart',
                namespace: '${{ inputs.namespace }}',
                resource: 'deployment',
                name: '${{ inputs.deployment_name }}',
              },
              verification: {
                steps: [
                  {
                    key: 'verify_rollout',
                    name: 'Verify rollout complete & replicas healthy',
                    type: 'KUBERNETES',
                    riskClass: 'READ_ONLY',
                    config: {
                      action: 'rollout-status',
                      namespace: '${{ inputs.namespace }}',
                      resource: 'deployment',
                      name: '${{ inputs.deployment_name }}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        version: 2,
        state: 'DRAFT',
        inputs: [
          envInput,
          {
            key: 'namespace',
            label: 'Kubernetes Namespace',
            type: 'STRING',
            required: true,
            defaultValue: 'production',
            description: 'Target namespace',
            sequence: 1,
          },
          {
            key: 'deployment_name',
            label: 'Deployment Name',
            type: 'STRING',
            required: true,
            defaultValue: 'checkout-api',
            description: 'Target deployment resource',
            sequence: 2,
          },
        ],
        definition: {
          steps: [
            {
              key: 'diagnostics',
              name: 'Inspect pods & capture exit status',
              type: 'KUBERNETES',
              riskClass: 'READ_ONLY',
              config: {
                action: 'get',
                namespace: '${{ inputs.namespace }}',
                resource: 'deployment',
                name: '${{ inputs.deployment_name }}',
              },
            },
            {
              key: 'bump_limits',
              name: 'Patch container memory limit +25%',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: {
                command:
                  'kubectl patch deployment ${{ inputs.deployment_name }} -p \'{"spec":{"template":{"spec":{"containers":[{"name":"app","resources":{"limits":{"memory":"2Gi"}}}]}}}}\'',
              },
            },
            {
              key: 'rollout_restart',
              name: 'Rollout restart deployment pods',
              type: 'KUBERNETES',
              riskClass: 'NON_IDEMPOTENT',
              config: {
                action: 'rollout-restart',
                namespace: '${{ inputs.namespace }}',
                resource: 'deployment',
                name: '${{ inputs.deployment_name }}',
              },
            },
          ],
        },
      },
    ],
  });

  // 3. Redis Cluster Memory Eviction & Defrag
  const redisRunbook = await seedEnterpriseRunbook({
    slug: 'redis-memory-defrag-recovery',
    name: 'Redis Cluster Memory Defrag & Eviction Recovery',
    description:
      'Audits memory fragmentation ratio, executes active memory defragmentation (MEMORY PURGE), and clears expired key tombstones.',
    tags: ['redis', 'cache', 'memory', 'performance'],
    ownerTeamId: teamsMap.get('Site Reliability Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'RETIRED',
        publishedDaysAgo: 45,
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'info_memory',
              name: 'Query Redis memory usage',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: { command: 'redis-cli INFO memory' },
            },
          ],
        },
      },
      {
        version: 2,
        state: 'PUBLISHED',
        publishedDaysAgo: 8,
        inputs: [
          envInput,
          {
            key: 'cluster_node',
            label: 'Redis Cluster Node',
            type: 'STRING',
            required: true,
            defaultValue: 'redis-cluster-01.internal',
            description: 'Target Redis host or cluster primary',
            sequence: 1,
          },
        ],
        definition: {
          steps: [
            {
              key: 'diagnostics',
              name: 'Sample memory fragmentation and key count',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command:
                  'redis-cli -h ${{ inputs.cluster_node }} INFO memory | grep -E "used_memory_human|mem_fragmentation_ratio"',
              },
            },
            {
              key: 'memory_purge',
              name: 'Trigger jemalloc memory purge',
              type: 'BASH',
              riskClass: 'IDEMPOTENT_WRITE',
              requiresApproval: true,
              config: { command: 'redis-cli -h ${{ inputs.cluster_node }} MEMORY PURGE' },
            },
            {
              key: 'verify_memory',
              name: 'Verify post-purge memory footprint & latency',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command: 'redis-cli -h ${{ inputs.cluster_node }} --latency --latency-history -i 2',
              },
            },
          ],
        },
      },
    ],
  });

  // 4. Stripe Webhook Dead-Letter Queue Drain & Replay
  const stripeRunbook = await seedEnterpriseRunbook({
    slug: 'stripe-webhook-dlq-replay',
    name: 'Stripe Webhook Dead-Letter Queue Drain & Replay',
    description:
      'Safely audits failed payment webhooks in Amazon SQS DLQ, validates idempotency keys, and replays events into the ingestion consumer.',
    tags: ['payments', 'stripe', 'dlq', 'sqs', 'finance'],
    ownerTeamId: teamsMap.get('Core Payments'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 20,
        inputs: [
          envInput,
          {
            key: 'batch_size',
            label: 'Replay Batch Size',
            type: 'NUMBER',
            required: true,
            defaultValue: '50',
            description: 'Number of failed webhook payloads to process per batch',
            sequence: 1,
          },
          {
            key: 'dry_run',
            label: 'Dry Run Only',
            type: 'SELECT',
            required: true,
            defaultValue: 'false',
            description: 'Simulate processing without persisting financial ledgers',
            options: ['true', 'false'],
            sequence: 2,
          },
        ],
        definition: {
          steps: [
            {
              key: 'inspect_dlq',
              name: 'Inspect SQS DLQ queue depth & oldest message age',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command:
                  'aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123/stripe-dlq --attribute-names ApproximateNumberOfMessages',
              },
            },
            {
              key: 'replay_events',
              name: 'Replay failed webhook batch to ingestion worker',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: {
                command:
                  'python3 /opt/payment-tools/replay_webhooks.py --batch ${{ inputs.batch_size }} --dry-run=${{ inputs.dry_run }}',
              },
            },
            {
              key: 'verify_200',
              name: 'Verify consumer 200 OK throughput & error rate',
              type: 'HTTP',
              riskClass: 'READ_ONLY',
              config: {
                method: 'GET',
                url: 'https://internal.opsknight.net/metrics/stripe-consumer-health',
              },
            },
          ],
        },
      },
    ],
  });

  // 5. Kafka Consumer Lag Auto-Rebalance
  const kafkaRunbook = await seedEnterpriseRunbook({
    slug: 'kafka-consumer-lag-rebalance',
    name: 'Kafka Consumer Lag & Partition Rebalance Remediation',
    description:
      'Calculates consumer group lag offset, diagnoses partition skew, and executes a cooperative sticky rebalance to unblock stuck event streams.',
    tags: ['kafka', 'streaming', 'lag', 'data-pipeline'],
    ownerTeamId: teamsMap.get('Platform Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'RETIRED',
        publishedDaysAgo: 60,
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'check_lag',
              name: 'Check consumer group lag',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: { command: 'kafka-consumer-groups --describe --group analytics-pipeline' },
            },
          ],
        },
      },
      {
        version: 2,
        state: 'PUBLISHED',
        publishedDaysAgo: 14,
        inputs: [
          envInput,
          {
            key: 'consumer_group',
            label: 'Consumer Group ID',
            type: 'STRING',
            required: true,
            defaultValue: 'analytics-pipeline-v2',
            description: 'Target Kafka consumer group identifier',
            sequence: 1,
          },
        ],
        definition: {
          steps: [
            {
              key: 'describe_lag',
              name: 'Audit partition lag across topic partitions',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command:
                  'kafka-consumer-groups --bootstrap-server kafka:9092 --describe --group ${{ inputs.consumer_group }}',
              },
            },
            {
              key: 'trigger_rebalance',
              name: 'Trigger cooperative rebalance & reset stranded offsets',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: {
                command:
                  'kafka-consumer-groups --bootstrap-server kafka:9092 --group ${{ inputs.consumer_group }} --reset-offsets --to-latest --execute',
              },
            },
            {
              key: 'verify_consumption',
              name: 'Verify active message throughput rate',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command:
                  'kafka-run-class kafka.tools.GetOffsetShell --broker-list kafka:9092 --topic events-audit --time -1',
              },
            },
          ],
        },
      },
    ],
  });

  // 6. Linux Host Diagnostics (CPU, Disk & Sockets)
  const diagRunbook = await seedEnterpriseRunbook({
    slug: 'host-diagnostics-full',
    name: 'Comprehensive Host Diagnostics & Health Snapshot',
    description:
      'Zero-risk read-only diagnostics suite: top CPU/memory processes, df -h storage check, systemd failed units, and TCP socket pressure.',
    tags: ['diagnostics', 'linux', 'read-only', 'cpu', 'disk'],
    ownerTeamId: teamsMap.get('Site Reliability Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 40,
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'system_summary',
              name: 'Capture load average, uptime and kernel version',
              type: 'LINUX_DIAGNOSTICS',
              riskClass: 'READ_ONLY',
              config: { diagnostic: 'summary' },
            },
            {
              key: 'top_processes',
              name: 'Capture top memory & CPU consuming tasks',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: { command: 'ps aux --sort=-%cpu | head -n 15' },
            },
            {
              key: 'disk_space',
              name: 'Check mount point storage & inode capacity',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: { command: 'df -hT && df -i' },
            },
          ],
        },
      },
    ],
  });

  // 7. TLS Certificate Emergency Renewal
  const tlsRunbook = await seedEnterpriseRunbook({
    slug: 'tls-cert-emergency-renewal',
    name: 'TLS Certificate Emergency Renewal & Envoy Reload',
    description:
      'Inspects leaf & intermediate expiration dates across ingress domains, pulls fresh signed certificates from Vault, and performs zero-downtime Envoy hot reload.',
    tags: ['security', 'tls', 'certificates', 'vault', 'envoy'],
    ownerTeamId: teamsMap.get('Security Operations'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 25,
        inputs: [
          envInput,
          {
            key: 'domain_name',
            label: 'Ingress Domain',
            type: 'STRING',
            required: true,
            defaultValue: 'api.opsknight.net',
            description: 'Domain requiring certificate renewal',
            sequence: 1,
          },
        ],
        definition: {
          steps: [
            {
              key: 'check_cert',
              name: 'Verify TLS handshake & current expiration date',
              type: 'BASH',
              riskClass: 'READ_ONLY',
              config: {
                command:
                  'echo | openssl s_client -connect ${{ inputs.domain_name }}:443 -servername ${{ inputs.domain_name }} 2>/dev/null | openssl x509 -noout -dates',
              },
            },
            {
              key: 'rotate_vault',
              name: 'Pull latest issued certificate from HashiCorp Vault',
              type: 'BASH',
              riskClass: 'IDEMPOTENT_WRITE',
              requiresApproval: true,
              config: {
                command:
                  'vault kv get -field=certificate secret/data/tls/${{ inputs.domain_name }} > /etc/ssl/certs/${{ inputs.domain_name }}.crt',
              },
            },
            {
              key: 'reload_proxy',
              name: 'Trigger zero-downtime Envoy proxy reload',
              type: 'SYSTEMD',
              riskClass: 'NON_IDEMPOTENT',
              config: { action: 'reload', unit: 'envoy.service' },
            },
          ],
        },
      },
    ],
  });

  // 8. Cloudflare Edge Cache Purge & DDoS Rate Limiting
  const cdnRunbook = await seedEnterpriseRunbook({
    slug: 'cloudflare-cache-purge-ddos',
    name: 'Cloudflare Edge Cache Purge & DDoS Mitigation',
    description:
      'Purges stale CDN edge caches across global PoPs, toggles rate limiting rules, and verifies origin server health during traffic spikes.',
    tags: ['cdn', 'cloudflare', 'cache', 'ddos', 'networking'],
    ownerTeamId: teamsMap.get('Site Reliability Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 18,
        inputs: [
          envInput,
          {
            key: 'zone_name',
            label: 'Cloudflare Zone',
            type: 'STRING',
            required: true,
            defaultValue: 'opsknight.net',
            description: 'Target DNS zone',
            sequence: 1,
          },
        ],
        definition: {
          steps: [
            {
              key: 'check_5xx',
              name: 'Query edge 502/504 error response rate',
              type: 'HTTP',
              riskClass: 'READ_ONLY',
              config: { method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones/health' },
            },
            {
              key: 'purge_cache',
              name: 'Purge everything in zone edge cache',
              type: 'HTTP',
              riskClass: 'NON_IDEMPOTENT',
              requiresApproval: true,
              config: {
                method: 'POST',
                url: 'https://api.cloudflare.com/client/v4/zones/${{ inputs.zone_name }}/purge_cache',
              },
            },
          ],
        },
      },
    ],
  });

  // 9. Elasticsearch Index Shard Migration (In-Progress Draft)
  const esRunbook = await seedEnterpriseRunbook({
    slug: 'elasticsearch-shard-migration',
    name: 'Elasticsearch Index Rollover & Shard Unfreeze',
    description:
      'Work in progress: moves unassigned replicas to warm tier, allocates cold shards, and clears write block on full data nodes.',
    tags: ['elasticsearch', 'logs', 'storage', 'search'],
    ownerTeamId: teamsMap.get('Platform Engineering'),
    actorId: admin.id,
    versions: [
      {
        version: 1,
        state: 'DRAFT',
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'cat_shards',
              name: 'List unassigned shards',
              type: 'HTTP',
              riskClass: 'READ_ONLY',
              config: {
                method: 'GET',
                url: 'http://es-cluster:9200/_cat/shards?h=index,shard,prirep,state,unassigned.reason',
              },
            },
          ],
        },
      },
    ],
  });

  // 10. Legacy Monolith Log Rotator (Archived)
  const legacyRunbook = await seedEnterpriseRunbook({
    slug: 'legacy-monolith-log-cleanup',
    name: 'Legacy Monolith Log Rotator & Temp Purge',
    description:
      'Superseded by systemd journald compression and FluentBit vector streaming. Retained for enterprise regulatory compliance and historical audits.',
    tags: ['legacy', 'archived', 'logs', 'compliance'],
    ownerTeamId: teamsMap.get('Platform Engineering'),
    actorId: admin.id,
    archived: true,
    versions: [
      {
        version: 1,
        state: 'PUBLISHED',
        publishedDaysAgo: 120,
        inputs: [envInput],
        definition: {
          steps: [
            {
              key: 'rm_logs',
              name: 'Purge old uncompressed *.log files',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              config: { command: 'find /var/log/legacy -name "*.log" -mtime +30 -delete' },
            },
          ],
        },
      },
    ],
  });

  // 4. Bind Runbooks to Services with Automation Rules
  const checkoutApi = await prisma.service.findFirst({ where: { name: 'Checkout API' } });
  const identityGw = await prisma.service.findFirst({ where: { name: 'Identity Gateway' } });
  const paymentsLedger = await prisma.service.findFirst({ where: { name: 'Payments Ledger' } });
  const globalCdn = await prisma.service.findFirst({ where: { name: 'Global CDN' } });

  if (checkoutApi && pgRunbook.publishedVersionId) {
    const existingRule = await prisma.serviceAutomationRule.findFirst({
      where: { serviceId: checkoutApi.id, runbookId: pgRunbook.id },
    });
    if (!existingRule) {
      await prisma.serviceAutomationRule.create({
        data: {
          serviceId: checkoutApi.id,
          runbookId: pgRunbook.id,
          name: 'Critical Database Failover on Replication Breach',
          mode: 'SUGGESTED',
          enabled: true,
          defaultAgentPoolId: dbPool.id,
          inputValues: json({
            environment: 'production',
            target_replica: 'pg-replica-02.internal.opsknight.net',
          }),
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
    }
  }

  if (checkoutApi && k8sRunbook.publishedVersionId) {
    const existingRule = await prisma.serviceAutomationRule.findFirst({
      where: { serviceId: checkoutApi.id, runbookId: k8sRunbook.id },
    });
    if (!existingRule) {
      await prisma.serviceAutomationRule.create({
        data: {
          serviceId: checkoutApi.id,
          runbookId: k8sRunbook.id,
          name: 'Auto-restart pods on CrashLoopBackOff',
          mode: 'AUTOMATIC',
          enabled: true,
          versionStrategy: 'PINNED',
          runbookVersionId: k8sRunbook.publishedVersionId,
          defaultAgentPoolId: k8sPool.id,
          inputValues: json({
            namespace: 'production',
            deployment_name: 'checkout-api',
            environment: 'production',
          }),
          createdById: admin.id,
          triggers: {
            create: {
              event: 'INCIDENT_CREATED',
              conditionLogic: 'AND',
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
    }
  }

  if (paymentsLedger && stripeRunbook.publishedVersionId) {
    const existingRule = await prisma.serviceAutomationRule.findFirst({
      where: { serviceId: paymentsLedger.id, runbookId: stripeRunbook.id },
    });
    if (!existingRule) {
      await prisma.serviceAutomationRule.create({
        data: {
          serviceId: paymentsLedger.id,
          runbookId: stripeRunbook.id,
          name: 'On-demand Stripe Dead-Letter Queue Drain',
          mode: 'MANUAL',
          enabled: true,
          defaultAgentId: agentIds[3],
          inputValues: json({ batch_size: 100, dry_run: 'false', environment: 'production' }),
          createdById: admin.id,
        },
      });
    }
  }

  if (globalCdn && cdnRunbook.publishedVersionId) {
    const existingRule = await prisma.serviceAutomationRule.findFirst({
      where: { serviceId: globalCdn.id, runbookId: cdnRunbook.id },
    });
    if (!existingRule) {
      await prisma.serviceAutomationRule.create({
        data: {
          serviceId: globalCdn.id,
          runbookId: cdnRunbook.id,
          name: 'Edge Cache Invalidation & Protection',
          mode: 'SUGGESTED',
          enabled: true,
          defaultAgentId: agentIds[2],
          createdById: admin.id,
        },
      });
    }
  }

  // 5. Seed Real Executions for rich history
  if (checkoutApi && pgRunbook.publishedVersionId) {
    const rule = await prisma.serviceAutomationRule.findFirst({
      where: { runbookId: pgRunbook.id },
    });
    if (rule) {
      // Recent successful run
      const started = hoursAgo(2);
      await prisma.runbookExecution.create({
        data: {
          runbookId: pgRunbook.id,
          runbookVersionId: pgRunbook.publishedVersionId,
          serviceId: checkoutApi.id,
          bindingId: rule.id,
          status: 'SUCCEEDED',
          startedAt: started,
          completedAt: new Date(started.getTime() + 184000), // ~3 mins
          deadlineAt: new Date(started.getTime() + 3600000),
          triggeredByType: 'USER',
          triggeredByUserId: admin.id,
          inputValues: json({
            environment: 'production',
            target_replica: 'pg-replica-02.internal.opsknight.net',
          }),
          definitionChecksum: pgRunbook.publishedVersion!.checksum,
          resolvedTargetAgentId: agentIds[1],
        },
      });

      // Active running execution
      const runningStart = minutesAgo(3);
      await prisma.runbookExecution.create({
        data: {
          runbookId: pgRunbook.id,
          runbookVersionId: pgRunbook.publishedVersionId,
          serviceId: checkoutApi.id,
          bindingId: rule.id,
          status: 'RUNNING',
          startedAt: runningStart,
          completedAt: null,
          deadlineAt: new Date(runningStart.getTime() + 3600000),
          triggeredByType: 'TRIGGER',
          inputValues: json({
            environment: 'production',
            target_replica: 'pg-replica-02.internal.opsknight.net',
          }),
          definitionChecksum: pgRunbook.publishedVersion!.checksum,
          resolvedTargetAgentId: agentIds[1],
        },
      });
    }
  }

  if (checkoutApi && k8sRunbook.publishedVersionId) {
    const rule = await prisma.serviceAutomationRule.findFirst({
      where: { runbookId: k8sRunbook.id },
    });
    if (rule) {
      const started = hoursAgo(5);
      await prisma.runbookExecution.create({
        data: {
          runbookId: k8sRunbook.id,
          runbookVersionId: k8sRunbook.publishedVersionId,
          serviceId: checkoutApi.id,
          bindingId: rule.id,
          status: 'WAITING_APPROVAL',
          startedAt: started,
          completedAt: null,
          deadlineAt: new Date(started.getTime() + 3600000),
          triggeredByType: 'TRIGGER',
          inputValues: json({
            namespace: 'production',
            deployment_name: 'checkout-api',
            environment: 'production',
          }),
          definitionChecksum: k8sRunbook.publishedVersion!.checksum,
          resolvedTargetAgentId: agentIds[0],
        },
      });
    }
  }

  console.log('✅ Enterprise runbooks and service data successfully seeded!');
}

main()
  .catch(err => {
    console.error('Failed seeding enterprise runbooks:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
