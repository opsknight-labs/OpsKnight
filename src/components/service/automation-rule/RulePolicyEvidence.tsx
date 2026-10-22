import { CheckCircle2, Clock, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { cn } from '@/lib/utils';
import { RuleTimestamp } from './RuleTimestamp';

export type RulePolicyRow = {
  id: string;
  status: string;
  agent: string;
  checked: { iso: string; relative: string; absolute: string } | null;
  pendingUntil: string;
  policyHash: string | null;
  checksum: string;
};

const STATUS_STYLE = new Map<string, { label: string; className: string; icon: typeof Clock }>([
  [
    'PASSED',
    {
      label: 'Passed',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      icon: CheckCircle2,
    },
  ],
  [
    'DEFERRED',
    {
      label: 'Deferred',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      icon: ShieldAlert,
    },
  ],
  [
    'PENDING',
    { label: 'Pending', className: 'border-border bg-muted text-muted-foreground', icon: Clock },
  ],
]);
const DENIED = {
  className: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  icon: XCircle,
};

export function PolicyStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE.get(status) ?? {
    ...DENIED,
    label: status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' '),
  };
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        style.className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {style.label}
    </span>
  );
}

function Checked({ row }: { row: RulePolicyRow }) {
  return row.checked ? (
    <RuleTimestamp {...row.checked} />
  ) : (
    <span className="text-muted-foreground">Pending until {row.pendingUntil}</span>
  );
}

export function RulePolicyEvidence({ checks }: { checks: RulePolicyRow[] }) {
  if (checks.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-card/60 backdrop-blur-xs px-4 py-8 text-center">
        <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold text-foreground">No Agent policy checks recorded.</p>
        <p className="text-xs text-muted-foreground">
          Use “Check Agent policy · No execution” to request evidence from eligible Agents.
        </p>
      </div>
    );
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-2xs md:block">
        <Table aria-label="Read-only policy evidence">
          <TableHeader className="bg-muted/40">
            <TableRow className="border-border/60">
              <TableHead className="font-semibold text-xs">Status</TableHead>
              <TableHead className="font-semibold text-xs">Agent</TableHead>
              <TableHead className="font-semibold text-xs">Checked</TableHead>
              <TableHead className="font-semibold text-xs">Policy hash</TableHead>
              <TableHead className="text-right font-semibold text-xs">
                Definition checksum
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/60">
            {checks.map(check => (
              <TableRow key={check.id} className="border-border/60 hover:bg-muted/30">
                <TableCell>
                  <PolicyStatusBadge status={check.status} />
                </TableCell>
                <TableCell
                  className="max-w-[12rem] truncate font-medium text-xs"
                  title={check.agent}
                >
                  {check.agent}
                </TableCell>
                <TableCell className="text-xs">
                  <Checked row={check} />
                </TableCell>
                <TableCell
                  className="font-mono text-xs text-muted-foreground"
                  title={check.policyHash ?? undefined}
                >
                  {check.policyHash ? check.policyHash.slice(0, 12) : 'Not reported'}
                </TableCell>
                <TableCell
                  className="text-right font-mono text-xs text-muted-foreground"
                  title={check.checksum}
                >
                  {check.checksum.slice(0, 12)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        aria-label="Read-only policy evidence"
        className="divide-y divide-border/60 rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-2xs md:hidden"
      >
        {checks.map(check => (
          <li key={check.id} className="space-y-1.5 px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <PolicyStatusBadge status={check.status} />
              <span className="truncate font-medium text-xs">{check.agent}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {check.checked ? (
                <time dateTime={check.checked.iso} title={check.checked.absolute}>
                  {check.checked.relative}
                </time>
              ) : (
                `Pending until ${check.pendingUntil}`
              )}
            </div>
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              Policy {check.policyHash ? check.policyHash.slice(0, 12) : 'not reported'} ·
              Definition {check.checksum.slice(0, 12)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
