'use client';

import { useOptimistic, useTransition } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { notify } from '@/lib/toast';
import { followBusinessServiceAction } from '@/app/(app)/services/business/actions';

/** Follow toggle: plain-language in-app updates when the business service is affected. */
export default function BusinessServiceFollowButton({
  id,
  name,
  following,
}: {
  id: string;
  name: string;
  following: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(following);
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant={optimistic ? 'secondary' : 'outline'}
      aria-pressed={optimistic}
      aria-label={optimistic ? `Stop following ${name}` : `Follow ${name}`}
      disabled={isPending}
      className="h-8 gap-1.5 text-xs"
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!optimistic);
          const result = await followBusinessServiceAction(id, !optimistic);
          if (!result.ok) notify.error(result.error);
        })
      }
    >
      {optimistic ? (
        <BellOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Bell className="h-3.5 w-3.5" aria-hidden />
      )}
      {optimistic ? 'Following' : 'Follow'}
    </Button>
  );
}
