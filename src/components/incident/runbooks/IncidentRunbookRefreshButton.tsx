'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function IncidentRunbookRefreshButton({
  hasActiveExecutions = false,
  pollIntervalSeconds = 4,
}: {
  hasActiveExecutions?: boolean;
  pollIntervalSeconds?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manualSpin, setManualSpin] = useState(false);

  // Auto-refresh polling whenever there are in-flight executions
  useEffect(() => {
    if (!hasActiveExecutions) return;

    const interval = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, pollIntervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [hasActiveExecutions, pollIntervalSeconds, router]);

  const handleManualRefresh = () => {
    setManualSpin(true);
    startTransition(() => {
      router.refresh();
    });
    setTimeout(() => {
      setManualSpin(false);
    }, 700);
  };

  const refreshing = isPending || manualSpin;

  return (
    <div className="flex items-center gap-2">
      {hasActiveExecutions && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/25 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
          Live updating
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={refreshing}
        onClick={handleManualRefresh}
        className="h-7 gap-1.5 px-2 text-xs font-medium"
        title="Refresh runbook execution status"
      >
        <RefreshCw
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            refreshing && 'animate-spin'
          )}
          aria-hidden="true"
        />
        <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
      </Button>
    </div>
  );
}
