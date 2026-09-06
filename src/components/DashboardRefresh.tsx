'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Button } from '@/components/ui/shadcn/button';
import { RefreshCw, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type DashboardRefreshProps = {
  autoRefreshInterval?: number; // in seconds, default 60
};

export default function DashboardRefresh({ autoRefreshInterval = 60 }: DashboardRefreshProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(autoRefreshInterval);
  const [mounted, setMounted] = useState(false);
  const [, startTransition] = useTransition();

  // Only set time after component mounts on client
  useEffect(() => {
    setMounted(true);
    setLastUpdated(new Date());
  }, []);

  // Load auto-refresh preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dashboard-auto-refresh');
    if (saved !== null) {
      setAutoRefreshEnabled(saved === 'true');
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    startTransition(() => {
      router.refresh();
    });
    setLastUpdated(new Date());
    setTimeUntilRefresh(autoRefreshInterval);
    setTimeout(() => setIsRefreshing(false), 500);
  }, [router, autoRefreshInterval]);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefreshEnabled) {
      setTimeUntilRefresh(autoRefreshInterval);
      return;
    }

    const countdownInterval = setInterval(() => {
      setTimeUntilRefresh(prev => (prev <= 1 ? autoRefreshInterval : prev - 1));
    }, 1000);

    const refreshInterval = setInterval(() => {
      handleRefresh();
    }, autoRefreshInterval * 1000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(refreshInterval);
    };
  }, [handleRefresh, autoRefreshEnabled, autoRefreshInterval]);

  const toggleAutoRefresh = () => {
    const newValue = !autoRefreshEnabled;
    setAutoRefreshEnabled(newValue);
    localStorage.setItem('dashboard-auto-refresh', String(newValue));
    if (newValue) setTimeUntilRefresh(autoRefreshInterval);
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="text-sm font-medium text-slate-300">
        {mounted && lastUpdated ? (
          <>
            Updated: {formatDateTime(lastUpdated, userTimeZone, { format: 'time' })}
            {autoRefreshEnabled && (
              <span className="ml-2 text-xs font-mono tabular-nums text-slate-400">
                (Auto: {timeUntilRefresh}s)
              </span>
            )}
          </>
        ) : (
          <span>Updated: --:--</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleRefresh}
          disabled={isRefreshing}
          variant="secondary"
          size="sm"
          className="h-8 gap-2 bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700/80 font-semibold shadow-xs transition-all"
          title="Refresh dashboard data"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>

        <Button
          onClick={toggleAutoRefresh}
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white transition-all',
            autoRefreshEnabled ? 'bg-slate-800/90 border-slate-600 text-white' : 'bg-transparent'
          )}
          title={autoRefreshEnabled ? 'Disable auto-refresh' : 'Enable auto-refresh'}
        >
          <RotateCw className="h-3.5 w-3.5" />
          {autoRefreshEnabled ? 'Auto ON' : 'Auto OFF'}
        </Button>
      </div>
    </div>
  );
}
