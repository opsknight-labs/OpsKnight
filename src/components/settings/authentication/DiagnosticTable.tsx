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
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th scope="col" className="p-3 sm:w-2/5">
            Record
          </th>
          <th scope="col" className="p-3">
            Status
          </th>
          <th scope="col" className="p-3">
            Last recorded activity
          </th>
          <th scope="col" className="p-3">
            Details
          </th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-border sm:table-row-group">
        {items.map(item => (
          <tr key={item.id} className="block py-3 sm:table-row sm:py-0">
            <td className="block min-w-0 break-words p-2 sm:table-cell sm:p-3">
              <p className="font-medium [overflow-wrap:anywhere]">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {item.subtitle}
              </p>
            </td>
            <td className="block p-2 sm:table-cell sm:p-3">
              <Badge
                variant={
                  ['ACTIVE', 'DELIVERED', 'CONSISTENT', 'success'].includes(item.state)
                    ? 'success'
                    : ['FAILED', 'CONFLICTING', 'failure', 'denied'].includes(item.state)
                      ? 'warning'
                      : 'neutral'
                }
              >
                {item.state.replaceAll('_', ' ')}
              </Badge>
            </td>
            <td className="block p-2 text-xs text-muted-foreground sm:table-cell sm:p-3">
              <time dateTime={item.activityAt}>{new Date(item.activityAt).toLocaleString()}</time>
            </td>
            <td className="block p-2 sm:table-cell sm:p-3">
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
