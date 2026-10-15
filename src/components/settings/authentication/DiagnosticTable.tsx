'use client';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import type { DiagnosticItem } from '@/lib/auth-control/diagnostic-contract';

export default function DiagnosticTable({
  items,
  onInspect,
}: {
  items: DiagnosticItem[];
  onInspect: (item: DiagnosticItem) => void;
}) {
  return (
    <table className="block w-full table-fixed text-left text-sm sm:table">
      <caption className="sr-only">Matching authentication diagnostic records</caption>
      <thead className="sr-only sm:not-sr-only sm:table-header-group">
        <tr className="border-b border-border/80 bg-muted/40 text-xs font-medium text-muted-foreground">
          <th scope="col" className="p-3.5 sm:w-2/5">
            Record
          </th>
          <th scope="col" className="p-3.5">
            Status
          </th>
          <th scope="col" className="p-3.5">
            Last recorded activity
          </th>
          <th scope="col" className="p-3.5 text-right sm:text-left">
            Details
          </th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-border/60 sm:table-row-group">
        {items.map(item => (
          <tr
            key={item.id}
            className="block py-3 sm:table-row sm:py-0 transition-colors hover:bg-muted/30"
          >
            <td className="block min-w-0 break-words p-3 sm:table-cell">
              <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{item.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {item.subtitle}
              </p>
            </td>
            <td className="block p-3 sm:table-cell">
              <Badge
                variant={
                  ['ACTIVE', 'DELIVERED', 'CONSISTENT', 'success'].includes(item.state)
                    ? 'success'
                    : ['FAILED', 'CONFLICTING', 'failure', 'denied'].includes(item.state)
                      ? 'warning'
                      : 'neutral'
                }
                className="text-[11px] font-semibold uppercase tracking-wider"
              >
                {item.state.replaceAll('_', ' ')}
              </Badge>
            </td>
            <td className="block p-3 text-xs text-muted-foreground sm:table-cell">
              <time dateTime={item.activityAt}>{new Date(item.activityAt).toLocaleString()}</time>
            </td>
            <td className="block p-3 sm:table-cell text-right sm:text-left">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onInspect(item)}
                aria-label={`View ${item.title}`}
              >
                View details
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
