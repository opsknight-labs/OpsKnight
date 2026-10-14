import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/shadcn/table';
import { EmptyState } from './feedback/EmptyState';
import { API_ACTIVITY_ENTITY_TYPES } from '@/lib/api-v2/activity-query';
import { Activity, Search, Terminal } from 'lucide-react';

export type ApiAuditLogItem = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  createdAt: string;
  details?: Record<string, unknown> | null;
  ip?: string | null;
};

export type ApiActivityFilterValues = {
  q: string;
  entity: string;
  actor: string;
  key: string;
  from: string;
  to: string;
  hasCursor: boolean;
};

const SELECT_CLASS =
  'h-9 text-xs rounded-md border border-input bg-background px-2 min-w-[150px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function activityHref(filters: ApiActivityFilterValues, cursor?: string | null): string {
  const params = new URLSearchParams({ tab: 'activity' });
  (['q', 'entity', 'actor', 'key', 'from', 'to'] as const).forEach(name => {
    if (filters[name]) params.set(name, filters[name]);
  });
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
}

/**
 * Security audit history of API gateway mutations. Filtering and pagination run in
 * the database (see lib/api-v2/activity-query), driven by the URL so filters survive
 * reloads and can be shared. It is not request-traffic telemetry: reads and failed
 * requests are not recorded here.
 */
export default function ApiActivityPanel({
  activities,
  nextCursor,
  filters,
}: {
  activities: ApiAuditLogItem[];
  nextCursor: string | null;
  filters: ApiActivityFilterValues;
}) {
  const filtered = Boolean(
    filters.q || filters.entity || filters.actor || filters.key || filters.from || filters.to
  );

  return (
    <div className="space-y-6">
      <form
        method="get"
        className="flex flex-col gap-3 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs"
        aria-label="Filter API activity"
      >
        <input type="hidden" name="tab" value="activity" />
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={filters.q}
              aria-label="Action contains"
              placeholder="Action, e.g. incident.resolved"
              className="h-9 text-xs pl-8 bg-background"
            />
          </div>
          <Input
            name="actor"
            defaultValue={filters.actor}
            aria-label="Actor"
            placeholder="Actor name or email"
            className="h-9 text-xs bg-background sm:w-[200px]"
          />
          <Input
            name="key"
            defaultValue={filters.key}
            aria-label="API key ID"
            placeholder="API key ID"
            className="h-9 text-xs bg-background sm:w-[180px]"
          />
          <select
            name="entity"
            defaultValue={filters.entity}
            aria-label="Resource type"
            className={SELECT_CLASS}
          >
            <option value="">All resources</option>
            {API_ACTIVITY_ENTITY_TYPES.map(type => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
            From
            <Input type="date" name="from" defaultValue={filters.from} className="h-9 text-xs bg-background" />
          </label>
          <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
            To
            <Input type="date" name="to" defaultValue={filters.to} className="h-9 text-xs bg-background" />
          </label>
          <Button type="submit" size="sm" className="h-9">
            Apply filters
          </Button>
          {(filtered || filters.hasCursor) && (
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href="?tab=activity">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      {/* 2. Audit Activity List / Table */}
      {activities.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={filtered ? 'No matching API activity' : 'No API activity recorded yet'}
          description={
            filtered
              ? 'Try widening the date range or clearing a filter.'
              : 'When integrations and service accounts change data through REST API v2, audit records appear here.'
          }
          action={
            filtered ? (
              <Button asChild variant="outline" size="sm">
                <Link href="?tab=activity">Reset filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="pb-3 px-4 sm:px-5 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">API Gateway Audit Trail</CardTitle>
                <CardDescription className="text-xs">
                  Audit history of API mutations, newest first. Reads and rejected requests are not
                  recorded here.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-border/60">
                    <TableHead className="text-xs py-3 font-semibold">Action</TableHead>
                    <TableHead className="text-xs py-3 font-semibold">Resource</TableHead>
                    <TableHead className="text-xs py-3 font-semibold">Actor / Identity</TableHead>
                    <TableHead className="text-xs py-3 font-semibold">Details</TableHead>
                    <TableHead className="text-xs py-3 font-semibold text-right">Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activities.map(act => (
                    <TableRow key={act.id} className="border-border/60 hover:bg-muted/20">
                      <TableCell className="py-3 font-mono text-xs font-bold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>{act.action}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="space-y-0.5">
                          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                            {act.entityType}
                          </Badge>
                          {act.entityId && (
                            <code className="block text-[11px] font-mono text-muted-foreground truncate max-w-[140px]">
                              {act.entityId}
                            </code>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-xs">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-foreground">
                            {act.actorName || act.actorEmail || 'Machine Token'}
                          </span>
                          {act.ip && (
                            <span className="block text-[10px] text-muted-foreground font-mono">
                              {act.ip}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-xs max-w-xs">
                        {act.details ? (
                          <pre className="text-[10px] font-mono bg-muted/40 p-1 rounded border border-border/50 overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
                            {JSON.stringify(act.details)}
                          </pre>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-right text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {act.createdAt}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>Showing {activities.length} events</span>
            <div className="flex gap-2">
              {filters.hasCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={activityHref(filters)}>Newest</Link>
                </Button>
              )}
              {nextCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={activityHref(filters, nextCursor)}>Older events</Link>
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
