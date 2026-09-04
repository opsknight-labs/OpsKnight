'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AnalyticsRefreshButton() {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      type="button"
      className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 text-slate-200 hover:text-white transition-all text-xs font-semibold cursor-pointer disabled:opacity-60"
    >
      <RotateCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-rose-400')} />
      <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
    </button>
  );
}
