'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { refreshAnalytics } from '@/app/(app)/insights/actions';
import { RelativeTime } from '@/components/patterns';
import { cn } from '@/lib/utils';

export default function FreshnessControl({ asOf }: { asOf: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const refresh = () =>
    startTransition(async () => {
      try {
        await refreshAnalytics(searchParams.toString());
        setFailed(false);
        router.refresh();
      } catch {
        setFailed(true);
      }
    });

  return (
    <div className="flex min-h-11 items-center justify-end gap-2 text-xs text-muted-foreground sm:min-h-5">
      {failed && (
        <span role="alert" className="text-destructive">
          Couldn&apos;t refresh. Try again.
        </span>
      )}
      {asOf && (
        <>
          <span>
            Updated <RelativeTime date={asOf} />
          </span>
          <span aria-hidden>·</span>
        </>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-1 rounded-sm px-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-0"
      >
        <RotateCw
          className={cn('h-3.5 w-3.5', pending && 'motion-safe:animate-spin')}
          aria-hidden
        />
        {pending ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
