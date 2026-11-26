'use client';

import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

/** "YYYY-MM" for this month and the one before, in UTC like the report. */
export function reportMonths(now = new Date()): [string, string] {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [now.toISOString().slice(0, 7), previous.toISOString().slice(0, 7)];
}

/** Download menu for the monthly SLA report (CSV or PDF) of one business service. */
export default function SlaReportMenu({
  businessServiceId,
  className,
}: {
  businessServiceId: string;
  className?: string;
}) {
  const [current, previous] = reportMonths();
  const href = (month: string, format: 'csv' | 'pdf') =>
    `/api/business-services/${encodeURIComponent(businessServiceId)}/sla-report?month=${month}&format=${format}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={className}>
          <FileDown className="h-4 w-4" aria-hidden />
          SLA report
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {[
          { label: 'This month (to date)', month: current },
          { label: 'Last month', month: previous },
        ].map((entry, index) => (
          <div key={entry.month}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>
              {entry.label} · {entry.month}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <a href={href(entry.month, 'csv')} download>
                CSV
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={href(entry.month, 'pdf')} download>
                PDF
              </a>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
