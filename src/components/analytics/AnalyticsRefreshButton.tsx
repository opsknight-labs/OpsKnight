'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';

/** Re-runs the analytics queries. Styled for the page header's dark surface. */
export default function AnalyticsRefreshButton() {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-busy={isRefreshing || undefined}
      className={pageHeaderActionClass}
    >
      <RotateCw aria-hidden="true" className={cn(isRefreshing && 'motion-safe:animate-spin')} />
      {isRefreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
}
