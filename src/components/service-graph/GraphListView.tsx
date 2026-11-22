'use client';

import { Boxes, Server } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import { cn } from '@/lib/utils';
import GraphHealthBadge from './GraphHealthBadge';
import type { GraphItem, GraphLink } from './model';

const head = 'h-9 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';

/**
 * The keyboard and screen-reader alternative to the canvas: every node as a table row with its
 * relations counted, and a button that opens the same side panel.
 */
export default function GraphListView({
  items,
  links,
  selectedKey,
  onSelect,
}: {
  items: readonly GraphItem[];
  links: readonly GraphLink[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        variant="card"
        size="sm"
        title="Nothing matches these filters"
        description="Clear the search or team filter to see every service you can access."
      />
    );
  const dependsOn = new Map<string, number>();
  const usedBy = new Map<string, number>();
  for (const link of links) {
    dependsOn.set(link.source, (dependsOn.get(link.source) ?? 0) + 1);
    usedBy.set(link.target, (usedBy.get(link.target) ?? 0) + 1);
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Services in the graph, with status and relations</caption>
        <thead className="border-b">
          <tr>
            <th scope="col" className={head}>
              Name
            </th>
            <th scope="col" className={cn(head, 'hidden sm:table-cell')}>
              Team
            </th>
            <th scope="col" className={head}>
              Status
            </th>
            <th scope="col" className={cn(head, 'text-right')}>
              Open incidents
            </th>
            <th scope="col" className={cn(head, 'hidden text-right md:table-cell')}>
              Depends on
            </th>
            <th scope="col" className={cn(head, 'hidden text-right md:table-cell')}>
              Used by
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
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
                    </span>
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
                  {dependsOn.get(item.key) ?? 0}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {usedBy.get(item.key) ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
