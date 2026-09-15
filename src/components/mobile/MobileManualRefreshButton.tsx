'use client';

import { RefreshCw } from 'lucide-react';
import { useMobileRefresh } from '@/components/mobile/MobileRefreshContext';

export default function MobileManualRefreshButton({ label = 'Refresh' }: { label?: string }) {
  const refreshContext = useMobileRefresh();
  if (!refreshContext) return null;

  return (
    <button
      type="button"
      onClick={() => void refreshContext.refresh()}
      disabled={refreshContext.isRefreshing}
      aria-label={label}
      className="inline-flex items-center justify-center p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
    >
      <RefreshCw
        className={`h-3.5 w-3.5 ${refreshContext.isRefreshing ? 'animate-spin text-primary' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}
