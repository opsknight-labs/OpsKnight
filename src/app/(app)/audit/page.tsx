import prisma from '@/lib/prisma';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Card } from '@/components/ui/shadcn/card';

import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Shield, FileText } from 'lucide-react';
import { assertAuditorOrAdmin } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';
import { parseAuditEntityType } from '@/lib/audit-filters';
import { logger } from '@/lib/logger';

import AuditFilters from '@/components/audit/AuditFilters';
import AuditLogTable from '@/components/audit/AuditLogTable';

export const dynamic = 'force-dynamic';

type AuditLogPageProps = {
  searchParams?: Promise<{
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    search?: string;
    page?: string;
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
  const currentUser = await assertAuditorOrAdmin();

  const awaitedParams = await searchParams;
  const entityType = parseAuditEntityType(awaitedParams?.entityType);
  const entityId = awaitedParams?.entityId;
  const actorId = awaitedParams?.actorId;
  const action = awaitedParams?.action;
  const search = awaitedParams?.search;
  const page = Math.max(1, Number.parseInt(awaitedParams?.page || '1', 10) || 1);
  const pageSize = 50;

  const userTimeZone = getUserTimeZone(currentUser);

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
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
  try {
    [logs, totalLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: auditLogInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
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
  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (entityType) params.set('entityType', entityType);
    if (entityId) params.set('entityId', entityId);
    if (actorId) params.set('actorId', actorId);
    if (action) params.set('action', action);
    if (search) params.set('search', search);
    params.set('page', String(targetPage));
    return `/audit?${params.toString()}`;
  };

  const hasActiveFilters = Boolean(entityType) || Boolean(action) || Boolean(search);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Security & Compliance"
        title="Audit Log"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Track administrative operations, team changes, permission assignments, and
            security-sensitive service modifications.
          </p>
        }
        stats={[
          {
            label: 'Total Records',
            value: totalLogs,
            icon: <Shield className="h-3.5 w-3.5" />,
          },
          {
            label: 'Page Entries',
            value: viewLogs.length,
            icon: <FileText className="h-3.5 w-3.5 text-blue-200" />,
          },
          {
            label: 'Current Page',
            value: `${Math.min(page, totalPages)} / ${totalPages}`,
            icon: <FileText className="h-3.5 w-3.5 text-emerald-200" />,
          },
        ]}
      />

      <div className="space-y-4">
        {/* Search & Filter Toolbar with CSV Export and Live Badge */}
        <AuditFilters
          currentEntityType={entityType}
          currentAction={action}
          currentSearch={search}
          logsData={viewLogs}
        />

        {/* Centralized Interactive Audit Table */}
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
    </main>
  );
}
