'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { useRunbookRefresh } from './useRunbookRefresh';

export type RunbookLiveRefreshProps = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
  active?: boolean;
  showIndicator?: boolean;
  className?: string;
};

export function formatRefreshAge(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function RunbookRefreshIndicator({
  lastRefreshedAt,
  onRefresh,
  live = true,
  className,
}: {
  lastRefreshedAt: number | null;
  onRefresh: () => void;
  live?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const age = lastRefreshedAt === null ? null : formatRefreshAge(now - lastRefreshedAt);
  return (
    <div
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border bg-background pl-2.5 pr-0.5 text-xs text-muted-foreground',
        className
      )}
    >
      {live && (
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      <span role="status" aria-live="polite" aria-atomic="true" className="tabular-nums">
        {live ? 'Live' : 'Auto-refresh off'}
        {age ? ` · updated ${age}` : ''}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full"
        aria-label="Refresh now"
        title="Refresh now"
        onClick={() => {
          onRefresh();
          setNow(Date.now());
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

export function RunbookLiveRefresh({
  enabled = true,
  intervalMs = 20000,
  refreshOnFocus = true,
  active,
  showIndicator = false,
  className,
}: RunbookLiveRefreshProps) {
  const router = useRouter();
  const { lastRefreshedAt, refreshNow } = useRunbookRefresh(router, {
    enabled,
    intervalMs,
    refreshOnFocus,
    active,
  });
  if (!showIndicator) return null;
  return (
    <RunbookRefreshIndicator
      lastRefreshedAt={lastRefreshedAt}
      onRefresh={refreshNow}
      live={enabled}
      className={className}
    />
  );
}
