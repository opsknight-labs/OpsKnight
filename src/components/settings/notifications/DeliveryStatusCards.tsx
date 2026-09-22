'use client';

import { Activity, AlertTriangle, CheckCircle2, Clock3, XCircle } from 'lucide-react';

type Props = {
  stats: Record<string, number>;
  activeStatus: string;
  onStatusChange: (status: string) => void;
};

export default function DeliveryStatusCards({ stats, activeStatus, onStatusChange }: Props) {
  const total = Object.values(stats).reduce((sum, v) => sum + v, 0);
  const delivered = stats.DELIVERED ?? 0;
  const accepted = stats.SENT ?? 0;
  const pending = stats.PENDING ?? 0;
  const failed = stats.FAILED ?? 0;
  const skipped = stats.SKIPPED ?? 0;
  const unknown = stats.UNKNOWN ?? 0;

  const handleClick = (targetStatus: string) => {
    onStatusChange(activeStatus === targetStatus ? 'all' : targetStatus);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
      {/* Total */}
      <button
        type="button"
        onClick={() => onStatusChange('all')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'all'
            ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Total Dispatched</span>
          <Activity className="h-4 w-4 text-primary" />
        </div>
        <div className="text-2xl font-black text-foreground tracking-tight">{total}</div>
        <span className="text-[10px] text-muted-foreground">All logged operations</span>
      </button>

      {/* Delivered */}
      <button
        type="button"
        onClick={() => handleClick('DELIVERED')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'DELIVERED'
            ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Delivered
          </span>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
          {delivered}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {total > 0
            ? `${Math.round((delivered / total) * 100)}% delivery rate`
            : 'Confirmed delivered'}
        </span>
      </button>

      {/* Accepted */}
      <button
        type="button"
        onClick={() => handleClick('SENT')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'SENT'
            ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Accepted</span>
          <CheckCircle2 className="h-4 w-4 text-blue-500" />
        </div>
        <div className="text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tight">
          {accepted}
        </div>
        <span className="text-[10px] text-muted-foreground">Provider accepted</span>
      </button>

      {/* Pending */}
      <button
        type="button"
        onClick={() => handleClick('PENDING')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'PENDING'
            ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            Pending Queue
          </span>
          <Clock3 className="h-4 w-4 text-amber-500" />
        </div>
        <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
          {pending}
        </div>
        <span className="text-[10px] text-muted-foreground">Queued or retry backoff</span>
      </button>

      {/* Unknown */}
      <button
        type="button"
        onClick={() => handleClick('UNKNOWN')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'UNKNOWN'
            ? 'bg-violet-500/10 border-violet-500/40 ring-1 ring-violet-500/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-violet-600 dark:text-violet-400">
            Unknown
          </span>
          <AlertTriangle className="h-4 w-4 text-violet-500" />
        </div>
        <div className="text-2xl font-black text-violet-600 dark:text-violet-400 tracking-tight">
          {unknown}
        </div>
        <span className="text-[10px] text-muted-foreground">Awaiting reconciliation</span>
      </button>

      {/* Failed */}
      <button
        type="button"
        onClick={() => handleClick('FAILED')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeStatus === 'FAILED'
            ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/40 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            Failed / Dead Letter
          </span>
          <AlertTriangle className="h-4 w-4 text-rose-500" />
        </div>
        <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
          {failed}
        </div>
        <span className="text-[10px] text-muted-foreground">Permanent error or max retries</span>
      </button>

      {/* Skipped */}
      <button
        type="button"
        onClick={() => handleClick('SKIPPED')}
        className={`text-left p-4 rounded-xl border transition-all col-span-2 sm:col-span-1 ${
          activeStatus === 'SKIPPED'
            ? 'bg-muted border-foreground/30 ring-1 ring-foreground/20 shadow-xs'
            : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Suppressed / Skipped</span>
          <XCircle className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-black text-foreground tracking-tight">{skipped}</div>
        <span className="text-[10px] text-muted-foreground">Quiet hours or rate limits</span>
      </button>
    </div>
  );
}
