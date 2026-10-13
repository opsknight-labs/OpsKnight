'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/shadcn/table';
import { EmptyState } from './feedback/EmptyState';
import { Activity, Search, X, Shield, Clock, Terminal } from 'lucide-react';

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

export default function ApiActivityPanel({
  activities,
}: {
  activities: ApiAuditLogItem[];
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState('ALL');

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    activities.forEach(a => set.add(a.entityType));
    return Array.from(set).sort();
  }, [activities]);

  const filteredActivities = useMemo(() => {
    return activities.filter(item => {
      const matchesSearch =
        searchQuery === '' ||
        item.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.entityId && item.entityId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.actorEmail && item.actorEmail.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.actorName && item.actorName.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesEntity = entityFilter === 'ALL' || item.entityType === entityFilter;
      return matchesSearch && matchesEntity;
    });
  }, [activities, searchQuery, entityFilter]);

  return (
    <div className="space-y-6">
      {/* 1. Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search activity by action, entity ID, or actor..."
            className="h-9 text-xs pl-8 bg-background"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="h-9 text-xs w-[160px] bg-background">
            <SelectValue placeholder="All Resource Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Resources ({entityTypes.length})</SelectItem>
            {entityTypes.map(t => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 2. Audit Activity List / Table */}
      {filteredActivities.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={searchQuery || entityFilter !== 'ALL' ? 'No matching API activity' : 'No recent API activity logged'}
          description={
            searchQuery || entityFilter !== 'ALL'
              ? 'Try clearing your search terms or selecting a different resource filter.'
              : 'As external integrations and service accounts invoke OpsKnight REST API v2 endpoints, tamper-evident audit records will stream here in real time.'
          }
          action={
            searchQuery || entityFilter !== 'ALL' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setEntityFilter('ALL');
                }}
              >
                Reset Filters
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
                  {filteredActivities.length} recent {filteredActivities.length === 1 ? 'event' : 'events'} recorded
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
                  {filteredActivities.map(act => (
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
        </Card>
      )}
    </div>
  );
}
