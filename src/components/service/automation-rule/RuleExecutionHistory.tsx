import Link from 'next/link';
import { History } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { RuleTimestamp } from './RuleTimestamp';

export type RuleExecutionRow = {
  id: string;
  status: string;
  iso: string;
  relative: string;
  absolute: string;
  duration: string;
  incidentId: string | null;
  checksum: string;
};

export function RuleExecutionHistory({ executions }: { executions: RuleExecutionRow[] }) {
  if (executions.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
        <History className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">This rule has not run yet.</p>
        <p className="text-xs text-muted-foreground">
          Executions started by this rule appear here with their outcome and evidence.
        </p>
      </div>
    );
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table aria-label="Execution history">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Checksum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map(execution => (
              <TableRow key={execution.id}>
                <TableCell>
                  <Link
                    href={`/runbooks/executions/${execution.id}`}
                    aria-label={`Open execution started ${execution.absolute}`}
                    className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RunbookStatusBadge status={execution.status} context="execution" />
                  </Link>
                </TableCell>
                <TableCell>
                  <RuleTimestamp
                    iso={execution.iso}
                    relative={execution.relative}
                    absolute={execution.absolute}
                  />
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {execution.duration}
                </TableCell>
                <TableCell>
                  {execution.incidentId ? (
                    <Link
                      href={`/incidents/${execution.incidentId}`}
                      className="text-primary hover:underline"
                    >
                      Source incident
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No incident</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {execution.checksum.slice(0, 12)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Execution history" className="divide-y rounded-lg border md:hidden">
        {executions.map(execution => (
          <li key={execution.id} className="space-y-1.5 px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/runbooks/executions/${execution.id}`} className="inline-flex">
                <RunbookStatusBadge status={execution.status} context="execution" />
              </Link>
              <span className="font-mono text-[11px] text-muted-foreground">
                {execution.checksum.slice(0, 12)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <time dateTime={execution.iso} title={execution.absolute}>
                {execution.relative}
              </time>
              <span>Duration {execution.duration}</span>
              {execution.incidentId && (
                <Link
                  href={`/incidents/${execution.incidentId}`}
                  className="text-primary hover:underline"
                >
                  Source incident
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
