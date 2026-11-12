'use client';

import { useEffect, useState } from 'react';
import { loadStatusDraftsAction } from '@/app/(app)/settings/status-pages/helper-actions';
import { Button } from '@/components/ui/shadcn/button';
import type { StatusDraft } from '@/lib/intelligence/helpers/status-draft';

/**
 * At the top of the announcement form: open incidents that affect this page, each one click away from a
 * pre-filled draft (type, title, message, affected services). Renders nothing when no open incident touches
 * the page; picking one only fills the form, which is still reviewed and published as usual.
 */
export default function StatusDraftSuggestions({
  statusPageId,
  onApply,
}: {
  statusPageId: string;
  onApply: (draft: StatusDraft) => void;
}) {
  const [drafts, setDrafts] = useState<StatusDraft[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadStatusDraftsAction(statusPageId)
      .then(result => {
        if (current) setDrafts(result);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [statusPageId]);

  if (drafts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="space-y-2 text-xs text-muted-foreground"
      data-testid="status-draft-suggestions"
    >
      <p>Start from an open incident that affects this page:</p>
      <div className="flex flex-wrap gap-2">
        {drafts.map(draft => (
          <Button
            key={draft.incidentId}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={applied === draft.incidentId}
            title={`Fills the form for ${draft.affected.map(component => component.name).join(', ')}`}
            className="min-h-11 max-w-full rounded-xl px-3 text-xs"
            onClick={() => {
              setApplied(draft.incidentId);
              onApply(draft);
            }}
          >
            <span className="truncate">{draft.incidentTitle}</span>
          </Button>
        ))}
      </div>
      {applied && <p>Draft filled in below. Review the wording before you publish.</p>}
    </div>
  );
}
