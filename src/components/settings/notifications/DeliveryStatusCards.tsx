'use client';

import {
  type LucideIcon,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  XCircle,
} from 'lucide-react';
import { toneClasses, type ToneKey } from '@/components/patterns';
import { cn } from '@/lib/utils';

type Props = {
  stats: Record<string, number>;
  activeStatus: string;
  onStatusChange: (status: string) => void;
};

type Card = {
  status: string;
  label: string;
  value: number;
  hint: string;
  tone: ToneKey;
  icon: LucideIcon;
  className?: string;
};

export default function DeliveryStatusCards({ stats, activeStatus, onStatusChange }: Props) {
  const total = Object.values(stats).reduce((sum, v) => sum + v, 0);
  const delivered = stats.DELIVERED ?? 0;

  const cards: Card[] = [
    {
      status: 'all',
      label: 'Total Dispatched',
      value: total,
      hint: 'All logged operations',
      tone: 'neutral',
      icon: Activity,
    },
    {
      status: 'DELIVERED',
      label: 'Delivered',
      value: delivered,
      hint:
        total > 0
          ? `${Math.round((delivered / total) * 100)}% delivery rate`
          : 'Confirmed delivered',
      tone: 'ok',
      icon: CheckCircle2,
    },
    {
      status: 'SENT',
      label: 'Accepted',
      value: stats.SENT ?? 0,
      hint: 'Provider accepted',
      tone: 'info',
      icon: CheckCircle2,
    },
    {
      status: 'PENDING',
      label: 'Pending Queue',
      value: stats.PENDING ?? 0,
      hint: 'Queued or retry backoff',
      tone: 'elevated',
      icon: Clock3,
    },
    {
      status: 'UNKNOWN',
      label: 'Unknown',
      value: stats.UNKNOWN ?? 0,
      hint: 'Awaiting reconciliation',
      tone: 'neutral',
      icon: HelpCircle,
    },
    {
      status: 'FAILED',
      label: 'Failed / Dead Letter',
      value: stats.FAILED ?? 0,
      hint: 'Permanent error or max retries',
      tone: 'critical',
      icon: AlertTriangle,
    },
    {
      status: 'SKIPPED',
      label: 'Suppressed / Skipped',
      value: stats.SKIPPED ?? 0,
      hint: 'Quiet hours or rate limits',
      tone: 'neutral',
      icon: XCircle,
      className: 'col-span-2 sm:col-span-1',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      {cards.map(({ status, label, value, hint, tone, icon: Icon, className }) => {
        const active = activeStatus === status;
        const recipe = toneClasses(tone);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            // Total always resets; every other card toggles its own filter.
            onClick={() => onStatusChange(status === 'all' || active ? 'all' : status)}
            className={cn(
              'rounded-lg border p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active
                ? recipe.soft
                : cn('border-border bg-card hover:bg-muted/50', recipe.hoverBorder),
              className
            )}
          >
            <div className="flex items-center justify-between pb-1.5">
              <span className={cn('text-xs font-semibold', active ? 'text-current' : recipe.text)}>
                {label}
              </span>
              <Icon
                aria-hidden="true"
                className={cn('h-4 w-4', active ? 'text-current' : recipe.text)}
              />
            </div>
            <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {value}
            </div>
            <span className="text-2xs text-muted-foreground">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
