import type { Prisma, RunbookAgentStatus } from '@prisma/client';

export type AgentListFilter = {
  q?: string;
  status?: RunbookAgentStatus;
  attention?: boolean;
  poolId?: string;
  platform?: string;
  capability?: string;
  labels?: Record<string, string>;
};

function statusCondition(
  status: RunbookAgentStatus,
  onlineSince: Date
): Prisma.RunbookAgentWhereInput {
  // Effective status: a stale heartbeat demotes ONLINE/DEGRADED Agents to OFFLINE.
  if (status === 'OFFLINE')
    return {
      OR: [
        { status: 'OFFLINE' },
        {
          status: { in: ['ONLINE', 'DEGRADED'] },
          OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: onlineSince } }],
        },
      ],
    };
  if (status === 'ONLINE' || status === 'DEGRADED')
    return { status, lastHeartbeatAt: { gte: onlineSince } };
  return { status };
}

export function buildAgentWhere(
  filter: AgentListFilter,
  onlineSince: Date
): Prisma.RunbookAgentWhereInput {
  const conditions: Prisma.RunbookAgentWhereInput[] = [];
  if (filter.q) {
    conditions.push({
      OR: [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { hostname: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filter.attention) {
    conditions.push({
      status: { not: 'REVOKED' },
      OR: [
        { status: { not: 'ONLINE' } },
        { lastHeartbeatAt: null },
        { lastHeartbeatAt: { lt: onlineSince } },
        { lastError: { not: '' } },
        { deadLetterDepth: { gt: 0 } },
      ],
    });
  }
  if (filter.status) conditions.push(statusCondition(filter.status, onlineSince));
  else if (!filter.attention) conditions.push({ status: { not: 'REVOKED' } });
  if (filter.poolId) conditions.push({ poolMemberships: { some: { poolId: filter.poolId } } });
  if (filter.platform) conditions.push({ platform: filter.platform });
  if (filter.capability) conditions.push({ capabilities: { array_contains: [filter.capability] } });
  for (const [key, value] of Object.entries(filter.labels ?? {})) {
    conditions.push({ labels: { path: [key], equals: value } });
  }
  return conditions.length > 0 ? { AND: conditions } : {};
}
