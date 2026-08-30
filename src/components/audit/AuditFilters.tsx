'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import LivePulseBadge from '@/components/ui/LivePulseBadge';
import { exportToCsv } from '@/lib/export-csv';
import { Download } from 'lucide-react';
import { AUDIT_ENTITY_TYPES } from '@/lib/audit-filters';

export type AuditFiltersProps = {
  currentEntityType?: string;
  currentAction?: string;
  currentSearch?: string;
  logsData?: Array<{
    id: string;
    createdAt: Date | string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    actor?: { name: string | null; email: string | null } | null;
    details?: string;
  }>;
};

export default function AuditFilters({
  currentEntityType = 'ALL',
  currentAction = '',
  currentSearch = '',
  logsData = [],
}: AuditFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'ALL') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page');

    startTransition(() => {
      router.push(`/audit?${params.toString()}`);
    });
  };

  const hasActiveFilters =
    (currentEntityType && currentEntityType !== 'ALL') ||
    Boolean(currentSearch) ||
    Boolean(currentAction);

  const handleReset = () => {
    startTransition(() => {
      router.push('/audit');
    });
  };

  const handleExportCsv = () => {
    exportToCsv(
      `audit-logs-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Audit ID', accessor: 'id' },
        { header: 'Timestamp', accessor: row => new Date(row.createdAt).toISOString() },
        { header: 'Actor Name', accessor: row => row.actor?.name || row.actorName || 'System' },
        { header: 'Actor Email', accessor: row => row.actor?.email || row.actorEmail || '-' },
        { header: 'Action', accessor: 'action' },
        { header: 'Entity Type', accessor: 'entityType' },
        { header: 'Entity ID', accessor: row => row.entityId || '-' },
        {
          header: 'Details',
          accessor: row => (row.details === '-' ? '' : row.details || ''),
        },
      ],
      logsData
    );
  };

  return (
    <SearchFilterBar
      searchValue={currentSearch}
      onSearchChange={val => updateParam('search', val)}
      searchPlaceholder="Search actor, action, or entity ID..."
      searchDebounceMs={300}
      hasActiveFilters={hasActiveFilters}
      onResetFilters={handleReset}
      filters={
        <Select
          value={currentEntityType || 'ALL'}
          onValueChange={val => updateParam('entityType', val)}
        >
          <SelectTrigger className="h-9 w-[160px] bg-slate-50/60 text-xs">
            <SelectValue placeholder="All Entity Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Entity Types</SelectItem>
            {AUDIT_ENTITY_TYPES.map(type => (
              <SelectItem key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      actions={
        <div className="flex items-center gap-2">
          <LivePulseBadge isLive={true} label="Audit Active" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={logsData.length === 0}
            className="h-9 gap-1.5 text-xs shadow-sm hover:bg-slate-100"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Export CSV</span>
          </Button>
        </div>
      }
    />
  );
}
