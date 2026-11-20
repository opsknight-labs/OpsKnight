'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export type IncidentStatusUpdateView = {
  /** The status page's announcement composer, filled from this incident's draft. */
  href: string;
  statusPageName: string;
  /** ISO instant; null before the first update linked to this incident. */
  nextDueAt: string | null;
};

/** "Next update in 12m", "Update due now", "Update overdue by 5m". */
export function nextUpdateLabel(
  nextDueAt: string,
  now: number
): { text: string; overdue: boolean } {
  const minutes = Math.round((new Date(nextDueAt).getTime() - now) / 60_000);
  if (minutes > 0) return { text: `Next update in ${formatMinutes(minutes)}`, overdue: false };
  if (minutes === 0) return { text: 'Update due now', overdue: true };
  return { text: `Update overdue by ${formatMinutes(-minutes)}`, overdue: true };
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`;
}

/**
 * "Post status update" plus the next-update-due chip, in the incident command bar. Renders nothing when the
 * incident has no status page to post on (the server leaves `statusUpdate` null).
 */
export default function StatusUpdateAction({
  statusUpdate,
  presentation = 'desktop',
  onNavigate,
}: {
  statusUpdate?: IncidentStatusUpdateView | null;
  presentation?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const nextDueAt = statusUpdate?.nextDueAt;
  useEffect(() => {
    if (!nextDueAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [nextDueAt]);

  if (!statusUpdate) return null;
  const due = nextDueAt ? nextUpdateLabel(nextDueAt, now) : null;
  const mobile = presentation === 'mobile';

  return (
    <div className={cn('flex items-center gap-2', mobile && 'w-full flex-col items-stretch')}>
      <Button
        asChild
        variant="outline"
        size="sm"
        className={cn(
          mobile
            ? 'h-11 w-full justify-start gap-2.5 text-sm font-medium'
            : 'h-8 gap-1.5 px-2.5 text-xs font-semibold bg-background hover:bg-muted/40 border-border/80 text-foreground shadow-2xs'
        )}
      >
        <Link
          href={statusUpdate.href}
          onClick={onNavigate}
          title={`Opens the ${statusUpdate.statusPageName} announcement form, filled from this incident`}
        >
          <Megaphone className={mobile ? 'h-4 w-4' : 'h-3.5 w-3.5 shrink-0'} aria-hidden />
          <span>Post status update</span>
        </Link>
      </Button>
      {due && (
        <span
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium tabular-nums whitespace-nowrap',
            mobile && 'self-start',
            due.overdue
              ? 'border-status-elevated-border/40 bg-status-elevated-soft text-status-elevated-deep dark:bg-status-elevated/10 dark:text-foreground'
              : 'border-border/80 bg-muted/40 text-muted-foreground'
          )}
          title={`${statusUpdate.statusPageName}: based on the last update linked to this incident`}
          // The server and the browser read the clock a moment apart.
          suppressHydrationWarning
        >
          {due.text}
        </span>
      )}
    </div>
  );
}
