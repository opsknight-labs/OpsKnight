import Link from 'next/link';
import { RUNBOOK_EXECUTION_STATUSES } from '@/lib/runbooks/presentation/contracts';
import { cn } from '@/lib/utils';

export type ExecutionStatusChipsProps = {
  query: Record<string, string>;
  counts: Record<string, number>;
  selected: string | null;
};

const PRIMARY_STATUSES = ['RUNNING', 'WAITING_APPROVAL', 'FAILED', 'SUCCEEDED'];

export function statusChipHref(query: Record<string, string>, status: string | null): string {
  const params = new URLSearchParams(query);
  params.delete('page');
  if (status) params.set('status', status);
  else params.delete('status');
  const search = params.toString();
  return search ? `/runbooks/executions?${search}` : '/runbooks/executions';
}

export function ExecutionStatusChips({ query, counts, selected }: ExecutionStatusChipsProps) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const countMap = new Map(Object.entries(counts));
  const countOf = (status: string) => countMap.get(status) ?? 0;
  const statuses = RUNBOOK_EXECUTION_STATUSES.filter(
    status => PRIMARY_STATUSES.includes(status) || countOf(status) > 0 || status === selected
  );
  const chips = [
    { status: null, label: 'All', count: total },
    ...statuses.map(status => ({
      status,
      label: status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' '),
      count: countOf(status),
    })),
  ];
  return (
    <nav aria-label="Filter executions by status" className="flex flex-wrap gap-1.5">
      {chips.map(chip => {
        const isSelected = chip.status === selected;
        return (
          <Link
            key={chip.status ?? 'all'}
            href={statusChipHref(query, chip.status)}
            aria-current={isSelected ? 'page' : undefined}
            aria-label={`${chip.label} (${chip.count})`}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-foreground/80 bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            )}
          >
            {chip.status && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  STATUS_DOT[chip.status] ?? 'bg-muted-foreground/60'
                )}
              />
            )}
            <span>{chip.label}</span>
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px] tabular-nums',
                isSelected ? 'bg-background/20' : 'bg-muted'
              )}
            >
              {chip.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

const STATUS_DOT: Record<string, string> = {
  RUNNING: 'bg-blue-500',
  QUEUED: 'bg-muted-foreground/60',
  WAITING_APPROVAL: 'bg-amber-500',
  WAITING_AGENT: 'bg-amber-500',
  SUCCEEDED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  TIMED_OUT: 'bg-rose-500',
  CANCELLED: 'bg-muted-foreground/60',
  CANCEL_REQUESTED: 'bg-muted-foreground/60',
};
