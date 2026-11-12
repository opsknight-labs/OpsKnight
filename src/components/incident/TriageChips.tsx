'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { decideTriage, type TriageActionState } from '@/app/(app)/incidents/[id]/triage-actions';
import type { TriageSuggestionView } from '@/lib/intelligence/triage/view';
import { Button } from '@/components/ui/shadcn/button';

const initial: TriageActionState = { ok: false, message: '', verdict: null };

const formatMinutes = (minutes: number) =>
  minutes < 60
    ? `${minutes} min`
    : minutes < 60 * 48
      ? `${Math.round((minutes / 60) * 10) / 10} h`
      : `${Math.round(minutes / 1440)} d`;

function describe(suggestion: TriageSuggestionView): { title: string; detail: string } {
  if (suggestion.urgency)
    return {
      title: `Set urgency to ${suggestion.urgency}`,
      detail: `${suggestion.precedents} similar incidents were handled at this urgency${suggestion.sloBurning ? '; the service is burning its error budget' : ''}.`,
    };
  if (suggestion.owner)
    return {
      title: `Assign to ${suggestion.owner.name}`,
      detail: `${suggestion.precedents} similar incidents were resolved by this ${suggestion.owner.type}.`,
    };
  if (suggestion.duplicate)
    return {
      title: `Possible duplicate of "${suggestion.duplicate.title}"`,
      detail: `Same problem on the same service, opened ${suggestion.duplicate.gapMinutes} min apart (${suggestion.duplicate.status.toLowerCase()}).`,
    };
  if (suggestion.resolution)
    return {
      title: `Usually resolved in about ${formatMinutes(suggestion.resolution.expectedMinutes)}`,
      detail: `Typically ${formatMinutes(suggestion.resolution.lowMinutes)} to ${formatMinutes(suggestion.resolution.highMinutes)}, from ${suggestion.resolution.samples} similar resolved incidents.`,
    };
  return { title: 'Suggestion', detail: '' };
}

function TriageChip({
  incidentId,
  suggestion,
  canAct,
}: {
  incidentId: string;
  suggestion: TriageSuggestionView;
  canAct: boolean;
}) {
  const [state, action, pending] = useActionState(decideTriage.bind(null, incidentId), {
    ...initial,
    verdict: suggestion.myVerdict,
  });
  const { title, detail } = describe(suggestion);
  const decided = state.verdict;
  const informational = Boolean(suggestion.resolution);
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {suggestion.duplicate ? (
              <Link
                href={`/incidents/${suggestion.duplicate.incidentId}`}
                className="hover:underline"
              >
                {title}
              </Link>
            ) : (
              title
            )}
            <span
              className="ml-2 text-xs font-normal text-muted-foreground"
              title="A ranking signal from similar incidents, not a probability."
            >
              {suggestion.confidencePercent}% match
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        {canAct && !decided && (
          <form action={action} className="flex items-center gap-2">
            <input type="hidden" name="findingId" value={suggestion.findingId} />
            <Button
              type="submit"
              name="decision"
              value="ACCEPT"
              size="sm"
              className="h-11 sm:h-9"
              disabled={pending}
            >
              {informational ? 'Looks right' : 'Apply'}
            </Button>
            <Button
              type="submit"
              name="decision"
              value="DISMISS"
              size="sm"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={pending}
            >
              Dismiss
            </Button>
          </form>
        )}
        {decided && (
          <span className="text-xs text-muted-foreground">
            {decided === 'HELPFUL' ? 'Accepted' : 'Dismissed'}
          </span>
        )}
      </div>
      {state.message && (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={
            state.ok
              ? 'text-xs text-status-ok-deep dark:text-status-ok-soft'
              : 'text-xs text-destructive'
          }
        >
          {state.message}
        </p>
      )}
    </li>
  );
}

export default function TriageChips({
  incidentId,
  suggestions,
  canAct,
}: {
  incidentId: string;
  suggestions: TriageSuggestionView[];
  canAct: boolean;
}) {
  return (
    <ul className="divide-y divide-border" aria-label="Triage suggestions">
      {suggestions.map(suggestion => (
        <TriageChip
          key={suggestion.findingId}
          incidentId={incidentId}
          suggestion={suggestion}
          canAct={canAct}
        />
      ))}
    </ul>
  );
}
