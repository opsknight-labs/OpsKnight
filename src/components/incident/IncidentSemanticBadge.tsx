import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300',
  ACKNOWLEDGED:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-300',
  RESOLVED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300',
  SNOOZED:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/35 dark:text-blue-300',
  SUPPRESSED:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const URGENCY_STYLES: Record<string, string> = {
  HIGH: 'border-rose-500 bg-rose-500 text-white',
  MEDIUM: 'border-amber-500 bg-amber-500 text-white',
  LOW: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/35 dark:text-blue-300',
};

function baseClasses() {
  return 'inline-flex h-5 items-center rounded-md border px-1.5 text-[10px] font-bold uppercase tracking-[0.04em]';
}

export function IncidentStatusBadge({ status, className }: { status: string; className?: string }) {
  const key = status.toUpperCase();
  const label = key === 'OPEN' ? 'Triggered' : key.charAt(0) + key.slice(1).toLowerCase();
  return (
    <span className={cn(baseClasses(), STATUS_STYLES[key] || 'border-border bg-muted text-muted-foreground', className)}>
      {label}
    </span>
  );
}

export function IncidentUrgencyBadge({ urgency, className }: { urgency?: string | null; className?: string }) {
  if (!urgency) return null;
  const key = urgency.toUpperCase();
  return (
    <span className={cn(baseClasses(), URGENCY_STYLES[key] || 'border-border bg-muted text-muted-foreground', className)}>
      {key}
    </span>
  );
}
