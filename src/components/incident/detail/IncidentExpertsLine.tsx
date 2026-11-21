'use client';

import { useId, useState, useTransition } from 'react';
import { Loader2, Sparkles, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type { IncidentExpert } from '@/lib/intelligence/triage/experts';

const why = (expert: IncidentExpert) =>
  [
    expert.resolved > 0 && `resolved ${expert.resolved} similar`,
    expert.noted > 0 && `worked ${expert.noted} similar`,
  ]
    .filter(Boolean)
    .join(', ');

/**
 * The "Experts" line under the responders card: people who fixed similar incidents, each with one
 * "Add responder" button that calls the same add-watcher action as the card (role Follower).
 */
export default function IncidentExpertsLine({
  experts,
  onAddWatcher,
}: {
  experts: IncidentExpert[];
  onAddWatcher: (formData: FormData) => void | Promise<void>;
}) {
  const titleId = useId();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const visible = experts.filter(expert => !added.has(expert.userId));
  if (visible.length === 0) return null;

  const add = (userId: string) => {
    const formData = new FormData();
    formData.append('watcherId', userId);
    formData.append('watcherRole', 'FOLLOWER');
    setPendingId(userId);
    startTransition(async () => {
      try {
        await onAddWatcher(formData);
        setAdded(previous => new Set(previous).add(userId));
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-border/70 bg-card px-4 py-3"
    >
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <h3
          id={titleId}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          Experts
        </h3>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        Fixed similar incidents in the last 180 days.
      </p>
      <ul className="mt-2 divide-y divide-border/60">
        {visible.map(expert => (
          <li key={expert.userId} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{expert.name}</p>
              <p className="truncate text-xs text-muted-foreground">{why(expert)}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0 gap-1.5 text-xs sm:min-h-9"
              disabled={isPending}
              onClick={() => add(expert.userId)}
              aria-label={`Add ${expert.name} as responder`}
            >
              {pendingId === expert.userId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Add responder
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
