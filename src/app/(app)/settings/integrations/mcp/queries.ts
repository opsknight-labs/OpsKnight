import 'server-only';
import { MCP_IDP_GRANT_KIND } from '@/lib/mcp/auth/enterprise-grant';
import { cache } from 'react';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { requireMcp } from '@/lib/mcp/core/errors';
import { CAPABILITIES } from '@/lib/authorization';
import { loadMcpRuntime } from '@/lib/mcp/auth/config';
import {
  CLIENT_ACCESS_COLUMNS,
  GRANT_ACCESS_COLUMNS,
  grantAccessVerdict,
  usableGrantSql,
  MCP_PAT_CLIENT_ID,
  type GrantAccessSnapshot,
  type McpGrantBlock,
} from '@/lib/mcp/auth/effective-access';
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
  /** May approve runbook runs (and so sees the runbook approvals queue). */
  readonly canApproveRunbooks: boolean;
  /** Sees every incident and service, so no runbook plan is outside their review scope. */
  readonly readsAllTargets: boolean;
  readonly timeZone: string;
  readonly [viewerBrand]: true;
};

/**
 * The signed-in user and their permissions, read once per page render however many sections,
 * queries and server components ask (React request cache; outside a render it simply runs).
 */
export const loadMcpPagePermissions = cache(getUserPermissions);
const loadMcpPageUser = cache(getCurrentUser);

/** Pass the caller's permissions when it already loaded them, so they are read once. */
export async function loadMcpViewer(
  preloadedPermissions?: Awaited<ReturnType<typeof getUserPermissions>>
): Promise<McpViewer> {
  const permissions = preloadedPermissions ?? (await loadMcpPagePermissions());
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const user = await loadMcpPageUser();
  const capabilities: readonly string[] = permissions.capabilities ?? [];
  return {
    id: permissions.id,
    isAdmin: permissions.isAdmin,
    canApproveRunbooks:
      permissions.isAdmin ||
      (capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE) &&
        capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL)),
    readsAllTargets:
      permissions.isAdmin ||
      (capabilities.includes(CAPABILITIES.INCIDENT_READ_ALL) &&
        capabilities.includes(CAPABILITIES.SERVICE_READ_ALL)),
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

function activeGrantWhere(now: Date): Prisma.McpGrantWhereInput {
  return { revokedAt: null, expiresAt: { gt: now } };
}

function pendingOperationWhere(now: Date): Prisma.McpOperationApprovalWhereInput {
  return { status: 'PENDING', expiresAt: { gt: now } };
}

/**
 * Runbook plans this viewer may review: everything for an administrator; for other runbook
 * approvers, other people's plans within what they can see. Team-scoped readers are limited to
 * untargeted plans here; the review page itself applies the exact incident and service checks.
 */
function runbookReviewScope(viewer: McpViewer): Prisma.RunbookPreviewAuthorizationWhereInput {
  if (viewer.isAdmin) return {};
  requireMcp(viewer.canApproveRunbooks, 'MCP_ADMIN_REQUIRED', 403);
  return {
    actorId: { not: viewer.id },
    ...(viewer.readsAllTargets ? {} : { incidentId: null, serviceId: null }),
  };
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

/** This server's MCP address, or null before one is configured (the check is then skipped). */
async function currentMcpResource() {
  const runtime = await loadMcpRuntime();
  return runtime.origin ? `${runtime.origin}/mcp` : null;
}

const GRANT_ACCESS_FROM = Prisma.sql`"McpGrant" g JOIN "McpClient" c ON c.id = g."clientId"
  LEFT JOIN "User" u ON u.id = g."userId"
  LEFT JOIN "McpPolicy" p ON p.id = 'default'`;

/**
 * Connections that work right now: the same predicate the MCP request path enforces
 * (effective-access.ts), so a connection blocked by policy or a security event is not counted.
 */
export async function countActiveConnections(viewer: McpViewer, now = new Date()) {
  const resource = await currentMcpResource();
  const [row] = await prisma.$queryRaw<{ usable: number }[]>`
    SELECT COUNT(*)::int AS usable FROM ${GRANT_ACCESS_FROM}
    WHERE ${usableGrantSql(now, resource)}
      AND (${viewer.isAdmin} OR g."userId" = ${viewer.id})`;
  return row?.usable ?? 0;
}

export async function countPendingApprovals(viewer: McpViewer, now = new Date()) {
  const scope = runbookReviewScope(viewer);
  const [operations, runbooks] = await Promise.all([
    // Configuration changes are reviewed by administrators only.
    viewer.isAdmin ? prisma.mcpOperationApproval.count({ where: pendingOperationWhere(now) }) : 0,
    prisma.runbookPreviewAuthorization.count({
      where: { AND: [pendingRunbookWhere(now), scope] },
    }),
  ]);
  return { operations, runbooks, total: operations + runbooks };
}

export async function countActiveClients(viewer: McpViewer) {
  requireAdmin(viewer);
  // The internal client personal tokens hang off is not an assistant.
  return prisma.mcpClient.count({ where: { revokedAt: null, id: { not: MCP_PAT_CLIENT_ID } } });
}

// ---------------------------------------------------------------------------------------------
// Connections (grants)
// ---------------------------------------------------------------------------------------------

function grantStatusSql(status: GrantStatus, now: Date) {
  switch (status) {
    case 'active':
      return Prisma.sql`g."revokedAt" IS NULL AND g."expiresAt" > ${now}`;
    case 'expired':
      return Prisma.sql`g."revokedAt" IS NULL AND g."expiresAt" <= ${now}`;
    case 'revoked':
      return Prisma.sql`g."revokedAt" IS NOT NULL`;
    default:
      return Prisma.sql`TRUE`;
  }
}

// A search that matches more people than this is too broad to be useful as a filter.
const PEOPLE_SEARCH_LIMIT = 200;

/**
 * Why a live connection gives no access right now. `mcp_disabled` is the master switch; the rest
 * are the request path's own reasons (effective-access.ts).
 */
export type McpConnectionBlock = McpGrantBlock | 'mcp_disabled';

export type McpGrantRow = {
  id: string;
  /** oauth: an assistant's consent. pat: a personal access token. */
  kind: 'oauth' | 'pat';
  /** Granted by the organization's identity provider (ID-JAG), not by a consent click. */
  idpGranted?: boolean;
  /** The name a personal token's owner gave it; null for OAuth connections. */
  label: string | null;
  /** What the person approved. */
  scopes: string[];
  /** What the server honours today: approved scopes within the assistant's current ceiling. */
  effectiveScopes: string[];
  /** Set while the connection is active by date but the server would refuse it. */
  blockedReason: McpConnectionBlock | null;
  status: Exclude<GrantStatus, 'all'>;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** The last tool call, written at most once a minute. */
  lastCallAt: Date | null;
  lastTool: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  user: McpPerson;
  client: {
    id: string;
    name: string;
    type: Exclude<ClientType, 'all'>;
    /** Host of the client's metadata document; the only basis for showing a brand logo. */
    metadataHost: string | null;
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

/** The connection-level verdict: the request path's verdict, then the master switch. */
export function connectionAccess(row: GrantAccessSnapshot, now: Date, resource: string | null) {
  const verdict = grantAccessVerdict(row, now, resource);
  const blockedReason: McpConnectionBlock | null =
    verdict.block ?? (row.policyEnabled ? null : 'mcp_disabled');
  return { blockedReason, effectiveScopes: blockedReason ? [] : verdict.effectiveScopes };
}

type GrantListRow = GrantAccessSnapshot & {
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastCallAt: Date | null;
  lastTool: string | null;
  clientId: string;
  clientName: string;
  dynamicRegistration: boolean;
  metadataUrl: string | null;
};

type GrantCounts = {
  active: number;
  expired: number;
  revoked: number;
  all: number;
  usable: number;
  revocable: number;
};

export async function listMcpGrants(
  viewer: McpViewer,
  input: { status: GrantStatus; q: string; clientId: string | null; page: number },
  now = new Date()
) {
  if (input.clientId) requireAdmin(viewer);
  const [people, resource] = await Promise.all([
    input.q && viewer.isAdmin
      ? prisma.user.findMany({
          where: { OR: [{ name: contains(input.q) }, { email: contains(input.q) }] },
          select: { id: true },
          take: PEOPLE_SEARCH_LIMIT,
        })
      : Promise.resolve([]),
    currentMcpResource(),
  ]);
  const personIds = people.map(person => person.id);
  // The same ILIKE pattern Prisma's insensitive `contains` sends, so search behaves as before.
  const pattern = `%${input.q}%`;
  const scope = viewer.isAdmin ? Prisma.sql`TRUE` : Prisma.sql`g."userId" = ${viewer.id}`;
  const base = Prisma.sql`${scope}
    AND (${input.clientId}::text IS NULL OR g."clientId" = ${input.clientId})
    AND (${input.q} = '' OR c.name ILIKE ${pattern} OR g.label ILIKE ${pattern}
      OR g."userId" = ANY(${personIds}::text[]))`;
  const [rows, [counts], client] = await Promise.all([
    // One statement for the page and what each connection may do right now.
    prisma.$queryRaw<GrantListRow[]>`
      SELECT ${GRANT_ACCESS_COLUMNS}, g.label, g."createdAt", g."lastUsedAt", g."lastCallAt",
        g."lastTool",
        c.id AS "clientId", c.name AS "clientName", c."dynamicRegistration", c."metadataUrl"
      FROM ${GRANT_ACCESS_FROM}
      WHERE ${base} AND ${grantStatusSql(input.status, now)}
      ORDER BY g."createdAt" DESC, g.id DESC
      OFFSET ${(input.page - 1) * MCP_PAGE_SIZE} LIMIT ${MCP_PAGE_SIZE}`,
    // Every status count in one pass. "usable" is the enforced predicate; "revocable" is what
    // "Revoke all" acts on, whatever filter is showing.
    prisma.$queryRaw<GrantCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE ${base} AND ${grantStatusSql('active', now)})::int AS active,
        COUNT(*) FILTER (WHERE ${base} AND ${grantStatusSql('expired', now)})::int AS expired,
        COUNT(*) FILTER (WHERE ${base} AND ${grantStatusSql('revoked', now)})::int AS revoked,
        COUNT(*) FILTER (WHERE ${base})::int AS "all",
        COUNT(*) FILTER (WHERE ${base} AND ${usableGrantSql(now, resource)})::int AS usable,
        COUNT(*) FILTER (WHERE g."revokedAt" IS NULL)::int AS revocable
      FROM ${GRANT_ACCESS_FROM}
      WHERE ${scope}`,
    input.clientId
      ? prisma.mcpClient.findUnique({
          where: { id: input.clientId },
          select: { id: true, name: true, metadataUrl: true },
        })
      : Promise.resolve(null),
  ]);
  const owners = await peopleById(rows.map(row => row.userId));
  const { usable, revocable, ...statusCounts } = counts ?? {
    active: 0,
    expired: 0,
    revoked: 0,
    all: 0,
    usable: 0,
    revocable: 0,
  };
  return {
    rows: rows.map((row): McpGrantRow => {
      const status = row.revokedAt ? 'revoked' : row.expiresAt <= now ? 'expired' : 'active';
      const access = connectionAccess(row, now, resource);
      return {
        id: row.grantId,
        kind: row.grantKind === 'PAT' ? 'pat' : 'oauth',
        idpGranted: row.grantKind === MCP_IDP_GRANT_KIND,
        label: row.label,
        scopes: row.grantScopes,
        effectiveScopes: access.effectiveScopes,
        blockedReason: status === 'active' ? access.blockedReason : null,
        status,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        lastCallAt: row.lastCallAt,
        lastTool: row.lastTool,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        user: owners.get(row.userId) ?? { id: row.userId, name: null, email: null },
        client: {
          id: row.clientId,
          name: row.clientName,
          type: clientTypeOf(row),
          metadataHost: hostOf(row.metadataUrl),
          revoked: Boolean(row.clientRevokedAt),
        },
      };
    }),
    counts: statusCounts,
    /** Active connections the server would honour now, within the current filter. */
    usable,
    /** Every connection "Revoke all" revokes, ignoring the filter (administrators only). */
    revocable: viewer.isAdmin ? revocable : 0,
    total: statusCounts[input.status],
    client: client
      ? { id: client.id, name: client.name, metadataHost: hostOf(client.metadataUrl) }
      : null,
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

function clientTypeSql(type: ClientType) {
  switch (type) {
    case 'automatic':
      return Prisma.sql`c."dynamicRegistration" AND c."metadataUrl" IS NULL`;
    case 'metadata':
      return Prisma.sql`c."metadataUrl" IS NOT NULL`;
    case 'manual':
      return Prisma.sql`NOT c."dynamicRegistration" AND c."metadataUrl" IS NULL`;
    default:
      return Prisma.sql`TRUE`;
  }
}

/** Why the policy refuses an allowed assistant today. */
export type McpClientBlock = 'mcp_disabled' | 'client_untrusted';

export type McpClientRow = {
  id: string;
  name: string;
  type: Exclude<ClientType, 'all'>;
  metadataHost: string | null;
  redirectUris: string[];
  /** The stored ceiling. */
  scopes: string[];
  /** The ceiling the server applies today (stored ceiling within the current policy). */
  effectiveScopes: string[];
  /** Set for an allowed (not revoked) assistant the policy currently refuses. */
  blockedReason: McpClientBlock | null;
  createdAt: Date;
  revokedAt: Date | null;
  activeConnections: number;
  lastUsedAt: Date | null;
  lastCallAt: Date | null;
};

export async function listMcpClients(
  viewer: McpViewer,
  input: { status: ClientStatus; type: ClientType; q: string; page: number },
  now = new Date()
) {
  requireAdmin(viewer);
  const where = (status: ClientStatus): Prisma.McpClientWhereInput => ({
    AND: [
      // Personal tokens are listed under Connections; their internal client is not an assistant.
      { id: { not: MCP_PAT_CLIENT_ID } },
      clientTypeWhere(input.type),
      clientStatusWhere(status),
      input.q ? { name: contains(input.q) } : {},
    ],
  });
  const filter = Prisma.sql`c.id <> ${MCP_PAT_CLIENT_ID} AND ${clientTypeSql(input.type)}
    AND (${input.q} = '' OR c.name ILIKE ${`%${input.q}%`})`;
  const [rows, [counts]] = await Promise.all([
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
    prisma.$queryRaw<{ active: number; revoked: number; all: number }[]>`
      SELECT COUNT(*) FILTER (WHERE c."revokedAt" IS NULL)::int AS active,
        COUNT(*) FILTER (WHERE c."revokedAt" IS NOT NULL)::int AS revoked,
        COUNT(*)::int AS "all"
      FROM "McpClient" c WHERE ${filter}`,
  ]);
  const ids = rows.map(row => row.id);
  const [usage, access] = ids.length
    ? await Promise.all([
        prisma.mcpGrant.groupBy({
          by: ['clientId'],
          where: { clientId: { in: ids } },
          _max: { lastUsedAt: true, lastCallAt: true },
        }),
        // The same ceiling and trust columns the MCP request path reads.
        prisma.$queryRaw<
          {
            id: string;
            clientScopes: string[];
            clientTrusted: boolean;
            policyEnabled: boolean | null;
          }[]
        >`SELECT c.id, ${CLIENT_ACCESS_COLUMNS}
          FROM "McpClient" c LEFT JOIN "McpPolicy" p ON p.id = 'default'
          WHERE c.id = ANY(${ids}::text[])`,
      ])
    : [[], []];
  const lastUsed = new Map(usage.map(entry => [entry.clientId, entry._max]));
  const ceilings = new Map(access.map(entry => [entry.id, entry]));
  const statusCounts = counts ?? { active: 0, revoked: 0, all: 0 };
  return {
    rows: rows.map((row): McpClientRow => {
      const ceiling = ceilings.get(row.id);
      const blockedReason: McpClientBlock | null =
        row.revokedAt || !ceiling
          ? null
          : !ceiling.policyEnabled
            ? 'mcp_disabled'
            : !ceiling.clientTrusted
              ? 'client_untrusted'
              : null;
      return {
        id: row.id,
        name: row.name,
        type: clientTypeOf(row),
        metadataHost: hostOf(row.metadataUrl),
        redirectUris: row.redirectUris,
        scopes: row.scopes,
        effectiveScopes: blockedReason || row.revokedAt ? [] : (ceiling?.clientScopes ?? []),
        blockedReason,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
        activeConnections: row._count.grants,
        lastUsedAt: lastUsed.get(row.id)?.lastUsedAt ?? null,
        lastCallAt: lastUsed.get(row.id)?.lastCallAt ?? null,
      };
    }),
    counts: statusCounts,
    total: statusCounts[input.status],
  };
}

/**
 * Assistants for the connections filter: allowed ones that have been used, with a short id
 * suffix on names that repeat (many "Claude Code" registrations look identical otherwise).
 */
export const ASSISTANT_FILTER_LIMIT = 100;
export async function listMcpAssistantFilter(viewer: McpViewer) {
  requireAdmin(viewer);
  const clients = await prisma.mcpClient.findMany({
    where: { revokedAt: null, grants: { some: {} } },
    select: { id: true, name: true, metadataUrl: true },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    take: ASSISTANT_FILTER_LIMIT + 1,
  });
  const listed = clients.slice(0, ASSISTANT_FILTER_LIMIT);
  const names = new Map<string, number>();
  for (const client of listed) names.set(client.name, (names.get(client.name) ?? 0) + 1);
  return {
    truncated: clients.length > ASSISTANT_FILTER_LIMIT,
    clients: listed.map(({ metadataUrl, ...client }) => {
      const host = hostOf(metadataUrl);
      return {
        ...client,
        metadataHost: host,
        label:
          (names.get(client.name) ?? 0) > 1
            ? `${client.name} · ${host ?? client.id.slice(-4)}`
            : client.name,
      };
    }),
  };
}

export function hostOf(url: string | null) {
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
  /** Whoever decided it: the approver, or the person who rejected it. */
  reviewer: McpPerson | null;
  /** An administrator approved their own request after confirming. */
  selfApproved: boolean;
  /** The reviewer's note, untrusted text. */
  decisionReason: string | null;
  assistant: string | null;
  /** Host of the assistant's metadata document, when it has one. */
  assistantHost: string | null;
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

/** Who asked, and through which assistant: shown on the review and status pages. */
export async function describeMcpRequester(actorId: string, grantId: string | null) {
  const [people, assistants] = await Promise.all([
    peopleById([actorId]),
    assistantsByGrant([grantId]),
  ]);
  return {
    person: people.get(actorId) ?? { id: actorId, name: null, email: null },
    assistant: grantId ? (assistants.get(grantId) ?? null) : null,
  };
}

function decider(people: Map<string, McpPerson>, id: string | null) {
  return id ? (people.get(id) ?? { id, name: null, email: null }) : null;
}

async function assistantsByGrant(grantIds: Iterable<string | null>) {
  const ids = [...new Set([...grantIds].filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, { name: string; metadataHost: string | null }>();
  const grants = await prisma.mcpGrant.findMany({
    where: { id: { in: ids } },
    select: { id: true, client: { select: { name: true, metadataUrl: true } } },
  });
  return new Map(
    grants.map(grant => [
      grant.id,
      { name: grant.client.name, metadataHost: hostOf(grant.client.metadataUrl) },
    ])
  );
}

export async function listMcpApprovals(
  viewer: McpViewer,
  input: { kind: ApprovalKind; state: ApprovalState; page: number },
  now = new Date()
) {
  const scope = runbookReviewScope(viewer);
  const skip = (input.page - 1) * MCP_PAGE_SIZE;

  if (input.kind === 'operations') {
    requireAdmin(viewer);
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
          rejectedById: true,
          selfApproved: true,
          decisionReason: true,
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
        rows.flatMap(row => [
          row.actorId,
          ...(row.reviewedById ? [row.reviewedById] : []),
          ...(row.rejectedById ? [row.rejectedById] : []),
        ])
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
          reviewer: decider(people, row.reviewedById ?? row.rejectedById),
          selfApproved: row.selfApproved,
          decisionReason: row.decisionReason,
          assistant: assistants.get(row.requesterGrantId)?.name ?? null,
          assistantHost: assistants.get(row.requesterGrantId)?.metadataHost ?? null,
          href: `/settings/integrations/mcp/approvals/operations/${row.id}`,
        };
      }),
    };
  }

  const base: Prisma.RunbookPreviewAuthorizationWhereInput = { independentReview: true };
  const where: Prisma.RunbookPreviewAuthorizationWhereInput =
    input.state === 'pending'
      ? { AND: [pendingRunbookWhere(now), scope] }
      : { AND: [base, scope, { NOT: pendingRunbookWhere(now) }] };
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
        rejectedById: true,
        selfApproved: true,
        decisionReason: true,
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
    peopleById(
      rows.flatMap(row => [
        row.actorId,
        ...(row.reviewedById ? [row.reviewedById] : []),
        ...(row.rejectedById ? [row.rejectedById] : []),
      ])
    ),
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
        reviewer: decider(people, row.reviewedById ?? row.rejectedById),
        selfApproved: row.selfApproved,
        decisionReason: row.decisionReason,
        assistant: row.requesterGrantId
          ? (assistants.get(row.requesterGrantId)?.name ?? null)
          : null,
        assistantHost: row.requesterGrantId
          ? (assistants.get(row.requesterGrantId)?.metadataHost ?? null)
          : null,
        href: open ? `/settings/integrations/mcp/approvals/${row.id}` : null,
      };
    }),
  };
}
