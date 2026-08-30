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
import { Card } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { formatDateTime } from '@/lib/timezone';
import AuditActionBadge from './AuditActionBadge';
import AuditDetailModal, { getEntityHref, AuditLogEntry } from './AuditDetailModal';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import EmptyState from '@/components/ui/EmptyState';
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

  return (
    <>
      <Card className="bg-white overflow-hidden shadow-sm">
        {logs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Shield className="h-6 w-6 text-muted-foreground/60" />}
              title={hasFilters ? 'No matching audit entries' : 'No audit entries found'}
              description={
                hasFilters
                  ? 'Try clearing or modifying your filter criteria.'
                  : 'Actions on users, teams, escalation policies, and services will appear here.'
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
              <Table className="min-w-[850px]">
                <TableHeader className="bg-slate-50 border-b border-border">
                  <TableRow>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground w-[170px]">
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
                    <TableHead className="text-right p-4 font-semibold text-muted-foreground w-[90px]">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => {
                    const entityHref = getEntityHref(log.entityType, log.entityId);

                    return (
                      <TableRow
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className="border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors group"
                      >
                        <TableCell className="p-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.createdAt, userTimeZone, { format: 'datetime' })}
                        </TableCell>
                        <TableCell className="p-4" onClick={e => e.stopPropagation()}>
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
                            <div className="min-w-0">
                              <div className="font-semibold text-sm truncate">
                                {log.actor?.id ? (
                                  <Link
                                    href={`/users/${log.actor.id}`}
                                    className="hover:underline text-primary"
                                  >
                                    {log.actor?.name || log.actorName || 'System'}
                                  </Link>
                                ) : (
                                  log.actor?.name || log.actorName || 'System'
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {log.actor?.email || log.actorEmail || '-'}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="p-4">
                          <AuditActionBadge action={log.action} />
                        </TableCell>
                        <TableCell className="p-4" onClick={e => entityHref && e.stopPropagation()}>
                          <div className="text-xs font-semibold text-foreground">
                            {log.entityType}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-[140px]">
                            {entityHref ? (
                              <Link
                                href={entityHref}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <span>{log.entityId}</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            ) : (
                              log.entityId || '-'
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="p-4 text-xs font-mono text-muted-foreground max-w-xs truncate">
                          {log.details}
                        </TableCell>
                        <TableCell className="p-4 text-right" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                            className="h-8 px-2 text-xs gap-1 text-muted-foreground group-hover:text-foreground"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>View</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Standardized Pagination Footer */}
            <TablePaginationFooter
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          </>
        )}
      </Card>

      {/* Details Dialog */}
      <AuditDetailModal
        log={selectedLog}
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        userTimeZone={userTimeZone}
      />
    </>
  );
}
