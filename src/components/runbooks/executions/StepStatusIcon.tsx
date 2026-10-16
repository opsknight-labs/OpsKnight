import {
  Ban,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  ShieldAlert,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepTone = 'success' | 'danger' | 'info' | 'warning' | 'neutral';

export function stepTone(status: string): StepTone {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED' || status === 'UNKNOWN' || status === 'TIMED_OUT') return 'danger';
  if (status === 'RUNNING' || status === 'CLAIMED') return 'info';
  if (status.startsWith('WAITING')) return 'warning';
  return 'neutral';
}

export function StepStatusIcon({ status, className }: { status: string; className?: string }) {
  const base = cn('h-4 w-4 shrink-0', className);
  if (status === 'SUCCEEDED')
    return (
      <CheckCircle2
        aria-hidden="true"
        className={cn(base, 'text-emerald-600 dark:text-emerald-400')}
      />
    );
  if (status === 'FAILED' || status === 'UNKNOWN' || status === 'TIMED_OUT')
    return <XCircle aria-hidden="true" className={cn(base, 'text-rose-600 dark:text-rose-400')} />;
  if (status === 'RUNNING' || status === 'CLAIMED')
    return (
      <Loader2
        aria-hidden="true"
        className={cn(base, 'animate-spin text-blue-600 dark:text-blue-400')}
      />
    );
  if (status === 'WAITING_APPROVAL')
    return (
      <ShieldAlert aria-hidden="true" className={cn(base, 'text-amber-600 dark:text-amber-400')} />
    );
  if (status.startsWith('WAITING'))
    return <Clock3 aria-hidden="true" className={cn(base, 'text-amber-600 dark:text-amber-400')} />;
  if (status === 'SKIPPED')
    return <SkipForward aria-hidden="true" className={cn(base, 'text-muted-foreground')} />;
  if (status === 'CANCELLED' || status === 'CANCEL_REQUESTED')
    return <Ban aria-hidden="true" className={cn(base, 'text-muted-foreground')} />;
  return <Circle aria-hidden="true" className={cn(base, 'text-muted-foreground')} />;
}
