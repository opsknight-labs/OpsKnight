import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
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
import EmptyState from '@/components/ui/EmptyState';
import { Shield, FileText } from 'lucide-react';
import { assertAuditorOrAdmin } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';
import { parseAuditEntityType } from '@/lib/audit-filters';
import { logger } from '@/lib/logger';

import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import AuditFilters from '@/components/audit/AuditFilters';

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

export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  await assertAuditorOrAdmin();

  const awaitedParams = await searchParams;
  const entityType = parseAuditEntityType(awaitedParams?.entityType);
  const entityId = awaitedParams?.entityId;
  const actorId = awaitedParams?.actorId;
  const action = awaitedParams?.action;
  const search = awaitedParams?.search;
  const page = Math.max(1, Number.parseInt(awaitedParams?.page || '1', 10) || 1);
  const pageSize = 50;

  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

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
            value: logs.length,
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
          logsData={logs}
        />

        {/* Audit Table */}
        <Card className="bg-white overflow-hidden shadow-sm">
          {logs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Shield className="h-6 w-6 text-muted-foreground/60" />}
                title={
                  search || entityType || action
                    ? 'No matching audit entries'
                    : 'No audit entries found'
                }
                description={
                  search || entityType || action
                    ? 'Try clearing or modifying your filter criteria.'
                    : 'Actions on users, teams, escalation policies, and services will appear here.'
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <Table className="min-w-[800px]">
                  <TableHeader className="bg-slate-50 border-b border-border">
                    <TableRow>
                      <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                        Timestamp
                      </TableHead>
                      <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                        Actor
                      </TableHead>
                      <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                        Action
                      </TableHead>
                      <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                        Entity
                      </TableHead>
                      <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                        Details
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => (
                      <TableRow
                        key={log.id}
                        className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                      >
                        <TableCell className="p-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.createdAt, userTimeZone, { format: 'datetime' })}
                        </TableCell>
                        <TableCell className="p-4">
                          <div className="flex items-center gap-3">
                            {log.actor ? (
                              <DirectUserAvatar
                                avatarUrl={
                                  log.actor.avatarUrl ||
                                  getDefaultAvatar(
                                    undefined,
                                    log.actor.id || log.actor.name || 'user'
                                  )
                                }
                                name={log.actor.name}
                                size="sm"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[0.7rem] font-semibold text-gray-500">
                                SYS
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-sm">
                                {log.actor?.name || log.actorName || 'System'}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {log.actor?.email || log.actorEmail || '-'}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="p-4">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
                            {log.action}
                          </span>
                        </TableCell>
                        <TableCell className="p-4">
                          <div className="text-sm font-medium">{log.entityType}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {log.entityId || '-'}
                          </div>
                        </TableCell>
                        <TableCell className="p-4 text-xs font-mono text-muted-foreground max-w-xs truncate">
                          {log.details ? JSON.stringify(log.details) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Standardized Pagination Footer */}
              <TablePaginationFooter
                page={page}
                pageSize={pageSize}
                totalCount={totalLogs}
                pageHref={pageHref}
              />
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
