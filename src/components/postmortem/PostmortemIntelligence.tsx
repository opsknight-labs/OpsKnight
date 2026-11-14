import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import type { ActionItemSuggestion } from '@/lib/intelligence/postmortems/evidence-draft';
import type { QualityIssue } from '@/lib/intelligence/postmortems/quality';
import {
  recurrenceHeadline,
  type PostmortemRecurrence,
} from '@/lib/intelligence/postmortems/recurrence';

/**
 * Postmortem intelligence strips. Each one renders nothing when it has nothing to say. No hooks, so the
 * recurrence strip also mounts in server components (the incident page).
 */

const SURFACE = 'rounded-md border border-border bg-muted/40 px-4 py-3 text-sm';
const ROW_LINK =
  'inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline focus-visible:underline';
const day = (date: Date | string) => new Date(date).toISOString().slice(0, 10);
const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

export function PostmortemRecurrenceStrip({
  recurrence,
}: {
  recurrence: PostmortemRecurrence | null | undefined;
}) {
  const headline = recurrence ? recurrenceHeadline(recurrence) : null;
  if (!recurrence || !headline) return null;
  const { lastPostmortem, openActionItems, openActionItemCount, overdueActionItemCount } =
    recurrence;
  return (
    <section aria-label="Recurrence" className={SURFACE}>
      <p className="font-medium text-foreground">{headline}</p>
      <p className="text-muted-foreground">
        {lastPostmortem ? (
          <>
            Last postmortem:{' '}
            <Link href={`/postmortems/${lastPostmortem.incidentId}`} className={ROW_LINK}>
              {lastPostmortem.title}
            </Link>{' '}
            ({lastPostmortem.status.toLowerCase()}, {day(lastPostmortem.createdAt)})
          </>
        ) : (
          'No earlier occurrence has a postmortem.'
        )}
        {openActionItemCount > 0 && (
          <>
            {' · '}
            {count(openActionItemCount, 'action item')} still open
            {overdueActionItemCount > 0 && `, ${overdueActionItemCount} overdue`}
          </>
        )}
      </p>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Earlier occurrences{openActionItems.length > 0 && ' and open action items'}
        </summary>
        <ul className="pb-1">
          {recurrence.previous.map(incident => (
            <li key={incident.incidentId} className="flex flex-wrap items-center gap-x-2">
              <Link href={`/incidents/${incident.incidentId}`} className={ROW_LINK}>
                {incident.title}
              </Link>
              <span className="text-xs tabular-nums text-muted-foreground">
                {day(incident.createdAt)}
              </span>
            </li>
          ))}
        </ul>
        {openActionItems.length > 0 && (
          <ul className="border-t border-border pt-1">
            {openActionItems.map(item => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-2">
                <Link href={`/postmortems/${item.incidentId}`} className={ROW_LINK}>
                  {item.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {item.status.toLowerCase().replace(/_/g, ' ')}
                  {item.dueDate && `, due ${day(item.dueDate)}`}
                </span>
                {item.overdue && (
                  <Badge variant="warning" size="xs">
                    Overdue
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

export function PostmortemQualityChecklist({ issues }: { issues: readonly QualityIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section aria-label="Postmortem checklist" className={SURFACE}>
      <p className="font-medium text-foreground">Still missing</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {issues.map(issue => (
          <li key={issue.code}>{issue.message}</li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_LABEL: Record<ActionItemSuggestion['source'], string> = {
  ACCEPTED_CAUSE: 'From a confirmed cause',
  SIMILAR_FIX: 'From a similar incident',
  RUNBOOK: 'From a runbook run',
};

export function PostmortemActionSuggestions({
  suggestions,
  onAdd,
}: {
  suggestions: readonly ActionItemSuggestion[];
  /** Adds the suggestion to the form. Nothing is saved until the person saves the postmortem. */
  onAdd: (suggestion: ActionItemSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section aria-label="Suggested action items" className={SURFACE}>
      <p className="font-medium text-foreground">Suggested action items</p>
      <ul className="divide-y divide-border">
        {suggestions.map(suggestion => {
          const covered = suggestion.duplicateOf;
          return (
            <li
              key={suggestion.key}
              className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-foreground">{suggestion.title}</p>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_LABEL[suggestion.source]}. {suggestion.description}
                </p>
              </div>
              {covered ? (
                <p className="shrink-0 text-xs text-muted-foreground">
                  Already covered by{' '}
                  {covered.incidentId ? (
                    <Link href={`/postmortems/${covered.incidentId}`} className={ROW_LINK}>
                      {covered.title}
                    </Link>
                  ) : (
                    <span className="text-foreground">{covered.title}</span>
                  )}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => onAdd(suggestion)}
                >
                  Add
                  <span className="sr-only">: {suggestion.title}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
