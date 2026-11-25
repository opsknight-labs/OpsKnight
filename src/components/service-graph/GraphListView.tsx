'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, ChevronsUpDown, Server } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import GraphHealthBadge from './GraphHealthBadge';
import { relationCounts, sortItems, type GraphItem, type GraphLink, type SortKey } from './model';

const head = 'h-9 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
/** Rows per page; the table is paginated rather than virtualised so find-in-page and screen readers see real rows. */
export const LIST_PAGE_SIZE = 100;

type Column = { key: SortKey; label: string; className?: string; numeric?: boolean };
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', className: 'w-[40%]' },
  { key: 'team', label: 'Team', className: 'hidden sm:table-cell' },
  { key: 'status', label: 'Status' },
  { key: 'incidents', label: 'Open incidents', numeric: true },
  { key: 'dependsOn', label: 'Depends on', className: 'hidden md:table-cell', numeric: true },
  { key: 'usedBy', label: 'Used by', className: 'hidden md:table-cell', numeric: true },
];

/**
 * The keyboard and screen-reader alternative to the canvas: every node as a sortable table row with
 * its relations counted, and a button that opens the same side panel.
 */
export default function GraphListView({
  items,
  links,
  selectedKey,
  onSelect,
  matches,
}: {
  items: readonly GraphItem[];
  links: readonly GraphLink[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Search matches, marked in the first column. */
  matches?: ReadonlySet<string>;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc',
  });
  const [page, setPage] = useState(0);
  const sorted = useMemo(
    () => sortItems(items, links, sort.key, sort.direction),
    [items, links, sort]
  );
  const counts = useMemo(() => relationCounts(links), [links]);
  if (items.length === 0)
    return (
      <EmptyState
        variant="card"
        size="sm"
        title="Nothing matches these filters"
        description="Clear the search or filters to see every service you can access."
      />
    );
  const pages = Math.ceil(sorted.length / LIST_PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const rows = sorted.slice(current * LIST_PAGE_SIZE, (current + 1) * LIST_PAGE_SIZE);
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Services in the graph, with status and relations</caption>
        <thead className="border-b">
          <tr>
            {COLUMNS.map(column => {
              const active = sort.key === column.key;
              const Arrow = !active
                ? ChevronsUpDown
                : sort.direction === 'asc'
                  ? ArrowUp
                  : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn(head, column.numeric && 'text-right', column.className)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPage(0);
                      setSort(prev => ({
                        key: column.key,
                        direction:
                          prev.key === column.key && prev.direction === 'asc' ? 'desc' : 'asc',
                      }));
                    }}
                    className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {column.label}
                    <Arrow className="h-3 w-3" aria-hidden="true" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(item => {
            const Icon = item.kind === 'bs' ? Boxes : Server;
            return (
              <tr
                key={item.key}
                className={cn(
                  'border-b last:border-0 hover:bg-muted/50',
                  selectedKey === item.key && 'bg-muted/60'
                )}
              >
                <td className="max-w-0 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onSelect(item.key)}
                    aria-pressed={selectedKey === item.key}
                    className="flex w-full min-w-0 items-center gap-2 text-left font-medium text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{item.name}</span>
                    <span className="sr-only">
                      {item.kind === 'bs' ? ' (business service)' : ' (technical service)'}
                      {matches?.has(item.key) ? ' (search match)' : ''}
                    </span>
                    {matches?.has(item.key) && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </button>
                </td>
                <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                  {item.teamName ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <GraphHealthBadge status={item.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{item.openIncidents}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {counts.dependsOn.get(item.key) ?? 0}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {counts.usedBy.get(item.key) ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pages > 1 && (
        <nav
          aria-label="List pages"
          className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground"
        >
          <span>
            {current * LIST_PAGE_SIZE + 1}–{Math.min((current + 1) * LIST_PAGE_SIZE, sorted.length)}{' '}
            of {sorted.length}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </span>
        </nav>
      )}
    </div>
  );
}
