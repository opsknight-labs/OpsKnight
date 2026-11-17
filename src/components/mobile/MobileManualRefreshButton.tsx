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
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <RefreshCw
        className={`h-4 w-4 ${refreshContext.isRefreshing ? 'motion-safe:animate-spin text-foreground' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}
