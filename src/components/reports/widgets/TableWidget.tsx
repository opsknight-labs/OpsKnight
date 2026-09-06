'use client';

import { memo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { formatTimeMinutesMs } from '@/lib/time-format';

type TableWidgetProps = {
  data: Array<Record<string, any>>;
  metricKey: string;
  maxRows?: number;
};

type ColumnConfig = {
  key: string;
  label: string;
  format?: (value: any) => string;
  align?: 'left' | 'center' | 'right';
};

/**
 * TableWidget - Generic table for displaying list data
 *
 * Automatically configures columns based on the metric type.
 */
const TableWidget = memo(function TableWidget({ data, metricKey, maxRows = 5 }: TableWidgetProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  const columns = getColumnsForMetric(metricKey);
  const displayData = data.slice(0, maxRows);

  return (
    <div className="overflow-auto h-full -mx-1">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map(col => (
              <TableHead
                key={col.key}
                className={`text-xs font-medium ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayData.map((row, idx) => (
            <TableRow key={row.id || idx} className="hover:bg-muted/50">
              {columns.map(col => (
                <TableCell
                  key={col.key}
                  className={`text-xs py-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                >
                  {col.format ? col.format(row[col.key]) : (row[col.key] ?? '--')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {data.length > maxRows && (
        <div className="text-xs text-muted-foreground text-center mt-2">
          Showing {maxRows} of {data.length} items
        </div>
      )}
    </div>
  );
});

/**
 * Get column configuration based on metric type
 */
function getColumnsForMetric(metricKey: string): ColumnConfig[] {
  const configs: Record<string, ColumnConfig[]> = {
    topServices: [
      { key: 'name', label: 'Service' },
      { key: 'count', label: 'Incidents', align: 'right' },
    ],
    assigneeLoad: [
      { key: 'name', label: 'Assignee' },
      { key: 'count', label: 'Incidents', align: 'right' },
    ],
    serviceMetrics: [
      { key: 'name', label: 'Service' },
      { key: 'status', label: 'Status', align: 'center' },
      { key: 'count', label: 'Incidents', align: 'right' },
      {
        key: 'mtta',
        label: 'MTTA',
        align: 'right',
        format: v => (v ? formatTimeMinutesMs(v * 60000) : '--'),
      },
    ],
    onCallLoad: [
      { key: 'name', label: 'User' },
      {
        key: 'hoursMs',
        label: 'Hours',
        align: 'right',
        format: v => (v ? `${(v / 3600000).toFixed(1)}h` : '--'),
      },
      { key: 'incidentCount', label: 'Incidents', align: 'right' },
    ],
    recurringTitles: [
      { key: 'title', label: 'Issue Title' },
      { key: 'count', label: 'Occurrences', align: 'right' },
    ],
    serviceSlaTable: [
      { key: 'name', label: 'Service' },
      { key: 'ackRate', label: 'Ack Rate', align: 'right', format: v => `${(v ?? 0).toFixed(0)}%` },
      {
        key: 'resolveRate',
        label: 'Resolve Rate',
        align: 'right',
        format: v => `${(v ?? 0).toFixed(0)}%`,
      },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    currentShifts: [
      { key: 'user.name', label: 'On-Call' },
      { key: 'schedule.name', label: 'Schedule' },
    ],
  };

  return (
    configs[metricKey] || [
      { key: 'name', label: 'Name' },
      { key: 'count', label: 'Count', align: 'right' },
    ]
  );
}

export default TableWidget;
