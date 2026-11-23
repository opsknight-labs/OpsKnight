'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellRing, Loader2 } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CHIP_CLASS } from '../field-styles';

type Follower = { id: string; name: string | null; avatarUrl: string | null };

/**
 * Follow / Following for the action bar, with the people already following: one click to subscribe
 * yourself, the avatars open the Subscribers card (roles, adding teammates). Uses the card's own actions.
 */
export default function FollowControl({
  currentUserId,
  currentWatcherId,
  followers,
  total,
  onAddWatcher,
  onRemoveWatcher,
}: {
  currentUserId: string;
  /** Your subscription record, when you follow this incident. */
  currentWatcherId: string | null;
  followers: Follower[];
  total: number;
  onAddWatcher: (formData: FormData) => Promise<void> | void;
  onRemoveWatcher: (formData: FormData) => Promise<void> | void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const following = Boolean(currentWatcherId);

  const toggle = () =>
    start(async () => {
      const form = new FormData();
      if (following) form.append('watcherMemberId', currentWatcherId!);
      else {
        form.append('watcherId', currentUserId);
        form.append('watcherRole', 'FOLLOWER');
      }
      try {
        await (following ? onRemoveWatcher(form) : onAddWatcher(form));
        notify.success(
          following ? 'You no longer follow this incident' : 'Following: you will get its updates'
        );
        router.refresh();
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not change your subscription');
      }
    });

  const Icon = pending ? Loader2 : following ? BellRing : Bell;
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        title={
          following
            ? 'You get every update on this incident. Click to stop.'
            : 'Get every update on this incident'
        }
        className={cn(
          CHIP_CLASS,
          'hover:bg-muted/60 disabled:opacity-60',
          following && 'border-status-ok/40 text-status-ok-deep dark:text-status-ok'
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', pending && 'animate-spin')} aria-hidden />
        {following ? 'Following' : 'Follow'}
      </button>
      {total > 0 && (
        <a
          href="#incident-subscribers"
          title={`${total} following — manage subscribers`}
          className="inline-flex h-8 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <span className="flex -space-x-1.5">
            {followers.slice(0, 3).map(person => (
              <UserAvatar
                key={person.id}
                userId={person.id}
                name={person.name}
                avatarUrl={person.avatarUrl}
                size="xs"
                className="ring-2 ring-background"
              />
            ))}
          </span>
          <span className="tabular-nums">{total}</span>
        </a>
      )}
    </div>
  );
}
