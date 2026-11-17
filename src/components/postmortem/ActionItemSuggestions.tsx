'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { suggestForActionItemDraftAction } from '@/app/(app)/postmortems/intelligence-actions';
import { Button } from '@/components/ui/shadcn/button';
import type { ActionItemDraftSuggestions } from '@/lib/intelligence/helpers/action-item-suggest-loader';

const DEBOUNCE_MS = 500;

/**
 * Hints under a new action item's title: open look-alikes elsewhere, the service it is for and a likely
 * owner. Renders nothing until there is something to say; picking the owner only fills the field.
 */
export default function ActionItemSuggestions({
  incidentId,
  title,
  owner,
  selectableUserIds,
  onPickOwner,
}: {
  incidentId: string;
  title: string;
  owner: string | undefined;
  /** People the owner field lists; a suggestion outside it is not offered. */
  selectableUserIds: ReadonlySet<string>;
  onPickOwner: (userId: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<ActionItemDraftSuggestions | null>(null);
  const request = useRef(0);

  useEffect(() => {
    // Every change supersedes the request in flight.
    const current = ++request.current;
    const timer = setTimeout(() => {
      suggestForActionItemDraftAction({ incidentId, title: title.slice(0, 500) })
        .then(result => {
          if (request.current === current) setSuggestions(result);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [incidentId, title]);

  if (!suggestions) return null;
  const suggestedOwner =
    suggestions.owner && !owner && selectableUserIds.has(suggestions.owner.userId)
      ? suggestions.owner
      : null;
  const duplicates = title.trim() ? suggestions.duplicates : [];
  if (!suggestedOwner && duplicates.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="space-y-2 text-xs text-muted-foreground"
      data-testid="action-item-suggestions"
    >
      {duplicates.length > 0 && (
        <div>
          <p>Possibly already tracked:</p>
          <ul className="space-y-0.5">
            {duplicates.map(item => (
              <li key={item.id}>
                <Link
                  href={`/postmortems/${item.incidentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:text-primary"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {suggestedOwner && (
        <div className="flex flex-wrap items-center gap-2">
          {suggestions.service && <span>For {suggestions.service.name}:</span>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 rounded-xl px-3 text-xs"
            onClick={() => onPickOwner(suggestedOwner.userId)}
          >
            Assign {suggestedOwner.name}
          </Button>
          <span>{suggestedOwner.reason}</span>
        </div>
      )}
    </div>
  );
}
