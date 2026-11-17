import prisma from '@/lib/prisma';
import { getUserTimeZone } from '@/lib/timezone';

import { PageHeader } from '@/components/patterns';
import { Shield, FileText } from 'lucide-react';
import { assertAuditorOrAdmin } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';
import { parseAuditEntityType } from '@/lib/audit-filters';
import { logger } from '@/lib/logger';

import AuditFilters from '@/components/audit/AuditFilters';
import AuditLogTable from '@/components/audit/AuditLogTable';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type AuditLogPageProps = {
  searchParams?: Promise<{
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    search?: string;
    page?: string;
    /** "assistant": only changes made through an AI assistant. */
    via?: string;
  }>;
};

const auditLogInclude = {
  actor: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.AuditLogInclude;

type AuditLogRow = Prisma.AuditLogGetPayload<{ include: typeof auditLogInclude }>;

type AuditLogView = Omit<AuditLogRow, 'createdAt' | 'details'> & {
  createdAt: string;
  details: string;
};

function serializeAuditDetails(details: Prisma.JsonValue | null): string {
  if (details === null) return '-';

  try {
    return JSON.stringify(details);
  } catch (error) {
    // A malformed historical value should not make the audit log unavailable.
    logger.warn('[AuditLog] Could not serialize record details', { error });
    return '[Details unavailable]';
  }
}

export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  await requirePageAccess('/audit');
  const currentUser = await assertAuditorOrAdmin();

  const awaitedParams = await searchParams;
  const entityType = parseAuditEntityType(awaitedParams?.entityType);
  const entityId = awaitedParams?.entityId;
  const actorId = awaitedParams?.actorId;
  const action = awaitedParams?.action;
  const search = awaitedParams?.search;
  const viaAssistant = awaitedParams?.via === 'assistant';
  const requestedPage = parsePageParam(awaitedParams?.page);
  const pageSize = 50;

  const userTimeZone = getUserTimeZone(currentUser);

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(viaAssistant ? { channel: { startsWith: 'mcp:' } } : {}),
  };

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { action: { contains: q, mode: 'insensitive' } },
      { entityId: { contains: q, mode: 'insensitive' } },
      { actorName: { contains: q, mode: 'insensitive' } },
      { actorEmail: { contains: q, mode: 'insensitive' } },
      { actor: { name: { contains: q, mode: 'insensitive' } } },
      { actor: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }

  let logs: AuditLogRow[];
  let totalLogs: number;
  let page: number;
  let totalPages: number;
  try {
    totalLogs = await prisma.auditLog.count({ where });
    const pagination = calculatePaginationBounds({
      totalItems: totalLogs,
      page: requestedPage,
      pageSize,
    });
    page = pagination.page;
    totalPages = pagination.totalPages;

    logs = await prisma.auditLog.findMany({
      where,
      include: auditLogInclude,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    });
  } catch (error) {
    logger.error('[AuditLog] Failed to load records', {
      error,
      entityType,
      hasEntityIdFilter: Boolean(entityId),
      hasActorIdFilter: Boolean(actorId),
      hasActionFilter: Boolean(action),
      hasSearchFilter: Boolean(search),
    });
    throw error;
  }
  const viewLogs: AuditLogView[] = logs.map(log => ({
    ...log,
    createdAt: log.createdAt.toISOString(),
    details: serializeAuditDetails(log.details),
  }));
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (entityType) params.set('entityType', entityType);
    if (entityId) params.set('entityId', entityId);
    if (actorId) params.set('actorId', actorId);
    if (action) params.set('action', action);
    if (search) params.set('search', search);
    if (viaAssistant) params.set('via', 'assistant');
    params.set('page', String(targetPage));
    return `/audit?${params.toString()}`;
  };

  const hasActiveFilters =
    Boolean(entityType) || Boolean(action) || Boolean(search) || viaAssistant;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Audit log"
        icon={Shield}
        description="Who changed what, and when: users, teams, permissions, services and settings. Entries are append-only."
        stats={[
          {
            label: hasActiveFilters ? 'Matching entries' : 'Entries',
            value: totalLogs.toLocaleString(),
            icon: <FileText className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <div className="space-y-4">
        <AuditFilters
          currentEntityType={entityType}
          currentAction={action}
          currentSearch={search}
          currentVia={viaAssistant ? 'assistant' : 'ALL'}
          logsData={viewLogs}
        />

        <AuditLogTable
          logs={viewLogs}
          userTimeZone={userTimeZone}
          page={page}
          pageSize={pageSize}
          totalCount={totalLogs}
          prevHref={page > 1 ? pageHref(page - 1) : undefined}
          nextHref={page < totalPages ? pageHref(page + 1) : undefined}
          hasFilters={hasActiveFilters}
        />
      </div>
    </div>
  );
}
