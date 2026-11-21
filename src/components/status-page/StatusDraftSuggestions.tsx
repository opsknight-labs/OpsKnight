'use client';

import { useEffect, useRef, useState } from 'react';
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
  incidentId,
  onApply,
}: {
  statusPageId: string;
  /** Opened from an incident's "Post status update": offer only its draft and fill the form with it. */
  incidentId?: string;
  onApply: (draft: StatusDraft) => void;
}) {
  const [drafts, setDrafts] = useState<StatusDraft[]>([]);
  const [applied, setApplied] = useState<string | null>(null);
  // The parent passes a fresh callback each render; the load must not re-run for it.
  const onApplyRef = useRef(onApply);
  useEffect(() => {
    onApplyRef.current = onApply;
  });

  useEffect(() => {
    let current = true;
    loadStatusDraftsAction(statusPageId, incidentId)
      .then(result => {
        if (!current) return;
        setDrafts(result);
        const named = incidentId
          ? result.find(draft => draft.incidentId === incidentId)
          : undefined;
        if (named) {
          setApplied(named.incidentId);
          onApplyRef.current(named);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [statusPageId, incidentId]);

  if (drafts.length === 0) return null;
  const appliedDraft = drafts.find(draft => draft.incidentId === applied);
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
      {appliedDraft && (
        <p>
          Draft filled in below
          {appliedDraft.affected.length > 0 &&
            ` for ${appliedDraft.affected.map(component => component.name).join(', ')}`}
          . Review the wording before you publish.
        </p>
      )}
    </div>
  );
}
