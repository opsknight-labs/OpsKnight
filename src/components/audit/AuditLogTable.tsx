'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Button } from '@/components/ui/shadcn/button';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import AuditActionBadge from './AuditActionBadge';
import AuditDetailModal, { getEntityHref, AuditLogEntry } from './AuditDetailModal';
import { EmptyState } from '@/components/patterns';
import {
  LogPagination,
  LogTableCard,
  LogTableScroll,
  LogTimestamp,
  MonoId,
  logCellClass,
  logHeadClass,
  logRowClass,
} from './LogTable';
import { Shield, Eye, ExternalLink } from 'lucide-react';

export type AuditLogTableProps = {
  logs: AuditLogEntry[];
  userTimeZone: string;
  page: number;
  pageSize: number;
  totalCount: number;
  prevHref?: string;
  nextHref?: string;
  hasFilters?: boolean;
};

export default function AuditLogTable({
  logs,
  userTimeZone,
  page,
  pageSize,
  totalCount,
  prevHref,
  nextHref,
  hasFilters = false,
}: AuditLogTableProps) {
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const clearHref = '/audit';

  return (
    <>
      <LogTableCard
        footer={
          logs.length > 0 ? (
            <LogPagination
              label="Audit log pages"
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          ) : undefined
        }
      >
        {logs.length === 0 ? (
          <EmptyState
            variant="simple"
            icon={<Shield />}
            title={hasFilters ? 'No audit entries match these filters' : 'No audit entries yet'}
            description={
              hasFilters
                ? 'Change the search or filters, or clear them to see every entry.'
                : 'Changes to users, teams, escalation policies, services and settings are recorded here.'
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={clearHref}>Clear filters</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <LogTableScroll label="Audit log entries">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(logHeadClass, 'w-[180px]')}>Time</TableHead>
                  <TableHead className={logHeadClass}>Actor</TableHead>
                  <TableHead className={logHeadClass}>Action</TableHead>
                  <TableHead className={logHeadClass}>Entity</TableHead>
                  <TableHead className={logHeadClass}>Details</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[96px] text-right')}>
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => {
                  const entityHref = getEntityHref(log.entityType, log.entityId);
                  const actorName = log.actor?.name || log.actorName || 'System';

                  return (
                    <TableRow key={log.id} className={logRowClass}>
                      <TableCell className={logCellClass}>
                        <LogTimestamp date={log.createdAt} timeZone={userTimeZone} />
                      </TableCell>
                      <TableCell className={logCellClass}>
                        <div className="flex items-center gap-3">
                          {log.actor ? (
                            <UserAvatar
                              userId={log.actor.id || log.actor.name || 'user'}
                              avatarUrl={log.actor.avatarUrl}
                              name={log.actor.name}
                              size="sm"
                              aria-hidden
                            />
                          ) : (
                            <div
                              aria-hidden="true"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
                            >
                              SYS
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {log.actor?.id ? (
                                <Link
                                  href={`/users/${log.actor.id}`}
                                  className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {actorName}
                                </Link>
                              ) : (
                                actorName
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {log.actor?.email || log.actorEmail || '—'}
                              {log.channel?.startsWith('mcp:') && ' · via AI assistant'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={logCellClass}>
                        <AuditActionBadge action={log.action} />
                      </TableCell>
                      <TableCell className={logCellClass}>
                        <div className="text-xs font-medium text-foreground">
                          {log.entityType.replace(/_/g, ' ')}
                        </div>
                        <div className="max-w-[180px]">
                          {entityHref ? (
                            <Link
                              href={entityHref}
                              title={log.entityId ?? undefined}
                              className="inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="truncate">{log.entityId}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </Link>
                          ) : log.entityId ? (
                            <MonoId value={log.entityId} label="entity ID" copyable={false} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={cn(logCellClass, 'max-w-xs')}>
                        <code className="block truncate font-mono text-xs text-muted-foreground">
                          {log.details === '-' ? '—' : log.details}
                        </code>
                      </TableCell>
                      <TableCell className={cn(logCellClass, 'text-right')}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                          aria-label={`View details for ${log.action} by ${actorName}`}
                          className="gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </LogTableScroll>
        )}
      </LogTableCard>

      <AuditDetailModal
        log={selectedLog}
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        userTimeZone={userTimeZone}
      />
    </>
  );
}
