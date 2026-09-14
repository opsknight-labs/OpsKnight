'use client';

import { WifiOff } from 'lucide-react';
import { formatCachedSnapshotTime } from '@/lib/mobile-cache-status';

export default function MobileCachedDataNotice({ savedAt }: { savedAt: Date | null }) {
  if (!savedAt) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Offline — showing saved data from {formatCachedSnapshotTime(savedAt)}.</span>
    </div>
  );
}
