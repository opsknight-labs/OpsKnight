import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { requireMcp } from '@/lib/mcp/core/errors';
import { operationReviewSummarySchema } from '@/lib/mcp/approvals/operation';
import {
  MCP_PAGE_SIZE,
  type ApprovalKind,
  type ApprovalState,
  type ClientStatus,
  type ClientType,
  type GrantStatus,
} from './list-params';

/**
 * Read queries for the MCP settings page. Each takes an `McpViewer`, which only `loadMcpViewer`
 * can produce, so a query cannot run without the page's own sign-in check. Administrator-only
 * lists check the role again here; connections are limited to the viewer's own grants for
 * everyone else, exactly as before.
 */

declare const viewerBrand: unique symbol;
export type McpViewer = {
  readonly id: string;
  readonly isAdmin: boolean;
  readonly timeZone: string;
  readonly [viewerBrand]: true;
};

/** Pass the caller's permissions when it already loaded them, so they are read once. */
export async function loadMcpViewer(
  preloaded?: Awaited<ReturnType<typeof getUserPermissions>>
): Promise<McpViewer> {
  const permissions = preloaded ?? (await getUserPermissions());
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const user = await getCurrentUser();
  return {
    id: permissions.id,
    isAdmin: permissions.isAdmin,
    timeZone: getUserTimeZone(user),
  } as McpViewer;
}

function requireAdmin(viewer: McpViewer) {
  requireMcp(viewer.isAdmin, 'MCP_ADMIN_REQUIRED', 403);
}

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

export type McpPerson = { id: string; name: string | null; email: string | null };

async function peopleById(ids: Iterable<string>) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, McpPerson>();
  const people = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(people.map(person => [person.id, person]));
}

// ---------------------------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------------------------

export function activeGrantWhere(now: Date): Prisma.McpGrantWhereInput {
  return { revokedAt: null, expiresAt: { gt: now } };
}

function pendingOperationWhere(now: Date): Prisma.McpOperationApprovalWhereInput {
  return { status: 'PENDING', expiresAt: { gt: now } };
}

function pendingRunbookWhere(now: Date): Prisma.RunbookPreviewAuthorizationWhereInput {
  return {
    independentReview: true,
    reviewedAt: null,
    rejectedAt: null,
    consumedAt: null,
    expiresAt: { gt: now },
  };
}

export async function countActiveConnections(viewer: McpViewer, now = new Date()) {
  return prisma.mcpGrant.count({
    where: { ...activeGrantWhere(now), ...(viewer.isAdmin ? {} : { userId: viewer.id }) },
  });
}

export async function countPendingApprovals(viewer: McpViewer, now = new Date()) {
  requireAdmin(viewer);
  const [operations, runbooks] = await Promise.all([
    prisma.mcpOperationApproval.count({ where: pendingOperationWhere(now) }),
    prisma.runbookPreviewAuthorization.count({ where: pendingRunbookWhere(now) }),
  ]);
  return { operations, runbooks, total: operations + runbooks };
}

export async function countActiveClients(viewer: McpViewer) {
  requireAdmin(viewer);
  return prisma.mcpClient.count({ where: { revokedAt: null } });
}

// ---------------------------------------------------------------------------------------------
// Connections (grants)
// ---------------------------------------------------------------------------------------------

function grantStatusWhere(status: GrantStatus, now: Date): Prisma.McpGrantWhereInput {
  switch (status) {
    case 'active':
      return activeGrantWhere(now);
    case 'expired':
      return { revokedAt: null, expiresAt: { lte: now } };
    case 'revoked':
      return { revokedAt: { not: null } };
    default:
      return {};
  }
}

// A search that matches more people than this is too broad to be useful as a filter.
const PEOPLE_SEARCH_LIMIT = 200;

export type McpGrantRow = {
  id: string;
  scopes: string[];
  status: Exclude<GrantStatus, 'all'>;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  user: McpPerson;
  client: {
    id: string;
    name: string;
    type: Exclude<ClientType, 'all'>;
    revoked: boolean;
  };
};

export function clientTypeOf(client: {
  dynamicRegistration: boolean;
  metadataUrl: string | null;
}): Exclude<ClientType, 'all'> {
  if (client.metadataUrl) return 'metadata';
  return client.dynamicRegistration ? 'automatic' : 'manual';
}

export async function listMcpGrants(
  viewer: McpViewer,
  input: { status: GrantStatus; q: string; clientId: string | null; page: number },
  now = new Date()
) {
  const base: Prisma.McpGrantWhereInput[] = [];
  if (!viewer.isAdmin) base.push({ userId: viewer.id });
  if (input.clientId) {
    requireAdmin(viewer);
    base.push({ clientId: input.clientId });
  }
  if (input.q) {
    const people = viewer.isAdmin
      ? await prisma.user.findMany({
          where: { OR: [{ name: contains(input.q) }, { email: contains(input.q) }] },
          select: { id: true },
          take: PEOPLE_SEARCH_LIMIT,
        })
      : [];
    base.push({
      OR: [
        { client: { name: contains(input.q) } },
        ...(people.length ? [{ userId: { in: people.map(person => person.id) } }] : []),
      ],
    });
  }
  const where = (status: GrantStatus): Prisma.McpGrantWhereInput => ({
    AND: [...base, grantStatusWhere(status, now)],
  });
  const [rows, active, expired, revoked, all, client] = await Promise.all([
    prisma.mcpGrant.findMany({
      where: where(input.status),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * MCP_PAGE_SIZE,
      take: MCP_PAGE_SIZE,
      select: {
        id: true,
        userId: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        client: {
          select: {
            id: true,
            name: true,
            revokedAt: true,
            dynamicRegistration: true,
            metadataUrl: true,
          },
        },
      },
    }),
    prisma.mcpGrant.count({ where: where('active') }),
    prisma.mcpGrant.count({ where: where('expired') }),
    prisma.mcpGrant.count({ where: where('revoked') }),
    prisma.mcpGrant.count({ where: where('all') }),
    input.clientId
      ? prisma.mcpClient.findUnique({
          where: { id: input.clientId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);
  const people = await peopleById(rows.map(row => row.userId));
  const counts = { active, expired, revoked, all };
  return {
    rows: rows.map((row): McpGrantRow => ({
      id: row.id,
      scopes: row.scopes,
      status: row.revokedAt ? 'revoked' : row.expiresAt <= now ? 'expired' : 'active',
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: people.get(row.userId) ?? { id: row.userId, name: null, email: null },
      client: {
        id: row.client.id,
        name: row.client.name,
        type: clientTypeOf(row.client),
        revoked: Boolean(row.client.revokedAt),
      },
    })),
    counts,
    total: counts[input.status],
    client,
  };
}

// ---------------------------------------------------------------------------------------------
// Assistants (clients)
// ---------------------------------------------------------------------------------------------

function clientTypeWhere(type: ClientType): Prisma.McpClientWhereInput {
  switch (type) {
    case 'automatic':
      return { dynamicRegistration: true, metadataUrl: null };
    case 'metadata':
      return { metadataUrl: { not: null } };
    case 'manual':
      return { dynamicRegistration: false, metadataUrl: null };
    default:
      return {};
  }
}

function clientStatusWhere(status: ClientStatus): Prisma.McpClientWhereInput {
  if (status === 'active') return { revokedAt: null };
  if (status === 'revoked') return { revokedAt: { not: null } };
  return {};
}

export type McpClientRow = {
  id: string;
  name: string;
  type: Exclude<ClientType, 'all'>;
  metadataHost: string | null;
  redirectUris: string[];
  scopes: string[];
  createdAt: Date;
  revokedAt: Date | null;
  activeConnections: number;
  lastUsedAt: Date | null;
};

export async function listMcpClients(
  viewer: McpViewer,
  input: { status: ClientStatus; type: ClientType; q: string; page: number },
  now = new Date()
) {
  requireAdmin(viewer);
  const where = (status: ClientStatus): Prisma.McpClientWhereInput => ({
    AND: [
      clientTypeWhere(input.type),
      clientStatusWhere(status),
      input.q ? { name: contains(input.q) } : {},
    ],
  });
  const [rows, active, revoked, all] = await Promise.all([
    prisma.mcpClient.findMany({
      where: where(input.status),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * MCP_PAGE_SIZE,
      take: MCP_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        redirectUris: true,
        scopes: true,
        metadataUrl: true,
        dynamicRegistration: true,
        createdAt: true,
        revokedAt: true,
        _count: { select: { grants: { where: activeGrantWhere(now) } } },
      },
    }),
    prisma.mcpClient.count({ where: where('active') }),
    prisma.mcpClient.count({ where: where('revoked') }),
    prisma.mcpClient.count({ where: where('all') }),
  ]);
  const usage = rows.length
    ? await prisma.mcpGrant.groupBy({
        by: ['clientId'],
        where: { clientId: { in: rows.map(row => row.id) } },
        _max: { lastUsedAt: true },
      })
    : [];
  const lastUsed = new Map(usage.map(entry => [entry.clientId, entry._max.lastUsedAt]));
  const counts = { active, revoked, all };
  return {
    rows: rows.map((row): McpClientRow => ({
      id: row.id,
      name: row.name,
      type: clientTypeOf(row),
      metadataHost: hostOf(row.metadataUrl),
      redirectUris: row.redirectUris,
      scopes: row.scopes,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      activeConnections: row._count.grants,
      lastUsedAt: lastUsed.get(row.id) ?? null,
    })),
    counts,
    total: counts[input.status],
  };
}

function hostOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

export type McpApprovalStatus =
  'pending' | 'approved' | 'rejected' | 'expired' | 'executing' | 'completed' | 'failed';

export type McpApprovalRow = {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string | null;
  risk: string | null;
  status: McpApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  requester: McpPerson;
  reviewer: McpPerson | null;
  assistant: string | null;
  /** Detail page, when it can still be opened. */
  href: string | null;
};

const OPERATION_STATUS: Record<string, McpApprovalStatus> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  EXECUTING: 'executing',
  COMMITTED: 'completed',
  FAILED: 'failed',
};

async function assistantsByGrant(grantIds: Iterable<string | null>) {
  const ids = [...new Set([...grantIds].filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const grants = await prisma.mcpGrant.findMany({
    where: { id: { in: ids } },
    select: { id: true, client: { select: { name: true } } },
  });
  return new Map(grants.map(grant => [grant.id, grant.client.name]));
}

export async function listMcpApprovals(
  viewer: McpViewer,
  input: { kind: ApprovalKind; state: ApprovalState; page: number },
  now = new Date()
) {
  requireAdmin(viewer);
  const skip = (input.page - 1) * MCP_PAGE_SIZE;

  if (input.kind === 'operations') {
    const where: Prisma.McpOperationApprovalWhereInput =
      input.state === 'pending' ? pendingOperationWhere(now) : { NOT: pendingOperationWhere(now) };
    const [pending, rows, total] = await Promise.all([
      countPendingApprovals(viewer, now),
      prisma.mcpOperationApproval.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: MCP_PAGE_SIZE,
        select: {
          id: true,
          operationId: true,
          riskClass: true,
          summary: true,
          status: true,
          actorId: true,
          requesterGrantId: true,
          reviewedById: true,
          reviewedAt: true,
          rejectedAt: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
      prisma.mcpOperationApproval.count({ where }),
    ]);
    const [people, assistants] = await Promise.all([
      peopleById(
        rows.flatMap(row => [row.actorId, ...(row.reviewedById ? [row.reviewedById] : [])])
      ),
      assistantsByGrant(rows.map(row => row.requesterGrantId)),
    ]);
    return {
      pending,
      total,
      rows: rows.map((row): McpApprovalRow => {
        const summary = operationReviewSummarySchema.safeParse(row.summary);
        const status =
          row.status === 'PENDING' && row.expiresAt <= now
            ? 'expired'
            : (OPERATION_STATUS[row.status] ?? 'pending');
        return {
          id: row.id,
          kind: 'operations',
          title: summary.success ? summary.data.operationId : row.operationId,
          detail: summary.success ? `${summary.data.method} ${summary.data.path}` : null,
          risk: row.riskClass,
          status,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          decidedAt: row.reviewedAt ?? row.rejectedAt,
          requester: people.get(row.actorId) ?? { id: row.actorId, name: null, email: null },
          reviewer: row.reviewedById ? (people.get(row.reviewedById) ?? null) : null,
          assistant: assistants.get(row.requesterGrantId) ?? null,
          href: `/settings/integrations/mcp/approvals/operations/${row.id}`,
        };
      }),
    };
  }

  const base: Prisma.RunbookPreviewAuthorizationWhereInput = { independentReview: true };
  const where: Prisma.RunbookPreviewAuthorizationWhereInput =
    input.state === 'pending'
      ? pendingRunbookWhere(now)
      : { AND: [base, { NOT: pendingRunbookWhere(now) }] };
  const [pending, rows, total] = await Promise.all([
    countPendingApprovals(viewer, now),
    prisma.runbookPreviewAuthorization.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: MCP_PAGE_SIZE,
      select: {
        id: true,
        runbookId: true,
        actorId: true,
        requesterGrantId: true,
        reviewedById: true,
        reviewedAt: true,
        rejectedAt: true,
        consumedAt: true,
        executionId: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    prisma.runbookPreviewAuthorization.count({ where }),
  ]);
  const [people, assistants, runbooks] = await Promise.all([
    peopleById(rows.flatMap(row => [row.actorId, ...(row.reviewedById ? [row.reviewedById] : [])])),
    assistantsByGrant(rows.map(row => row.requesterGrantId)),
    rows.length
      ? prisma.runbook.findMany({
          where: { id: { in: [...new Set(rows.map(row => row.runbookId))] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const runbookNames = new Map(runbooks.map(runbook => [runbook.id, runbook.name]));
  return {
    pending,
    total,
    rows: rows.map((row): McpApprovalRow => {
      const status: McpApprovalStatus = row.rejectedAt
        ? 'rejected'
        : row.consumedAt || row.executionId
          ? 'completed'
          : row.expiresAt <= now
            ? 'expired'
            : row.reviewedAt
              ? 'approved'
              : 'pending';
      // The review page only opens while the plan is still live.
      const open = row.expiresAt > now && !row.consumedAt;
      return {
        id: row.id,
        kind: 'runbooks',
        title: runbookNames.get(row.runbookId) ?? 'Runbook',
        detail: null,
        risk: null,
        status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        decidedAt: row.reviewedAt ?? row.rejectedAt,
        requester: people.get(row.actorId) ?? { id: row.actorId, name: null, email: null },
        reviewer: row.reviewedById ? (people.get(row.reviewedById) ?? null) : null,
        assistant: row.requesterGrantId ? (assistants.get(row.requesterGrantId) ?? null) : null,
        href: open ? `/settings/integrations/mcp/approvals/${row.id}` : null,
      };
    }),
  };
}
