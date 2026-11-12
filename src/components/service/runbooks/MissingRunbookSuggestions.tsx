import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import {
  getMissingRunbookSuggestions,
  type MissingRunbookSuggestion,
} from '@/lib/intelligence/runbook-health/loader';
import { Button } from '@/components/ui/shadcn/button';
import { draftRunbookFromNotesAction } from '@/app/(app)/services/[id]/runbook-suggestion-actions';

const MAX_SHOWN = 3;

/** Presentation only; renders nothing without a suggestion. */
export function MissingRunbookList({
  serviceId,
  suggestions,
  canManage,
}: {
  serviceId: string;
  suggestions: readonly MissingRunbookSuggestion[];
  canManage: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="mb-4 space-y-2" aria-label="Suggested runbooks">
      {suggestions.slice(0, MAX_SHOWN).map(suggestion => (
        <li
          key={suggestion.key}
          className="rounded-xl border border-border/70 bg-muted/30 px-4 py-2 text-sm text-foreground"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="min-w-0 break-words">
              <span className="font-medium">No runbook for this yet.</span> {suggestion.title}.
            </p>
            {canManage && (
              <form action={draftRunbookFromNotesAction.bind(null, serviceId, suggestion.key)}>
                <Button type="submit" variant="outline" size="lg" className="px-4">
                  Open a draft in the editor
                </Button>
              </form>
            )}
          </div>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Why this is suggested ({suggestion.evidence.steps.length}{' '}
              {suggestion.evidence.steps.length === 1 ? 'step' : 'steps'} found)
            </summary>
            <div className="grid gap-4 pb-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <p className="font-medium text-foreground">Draft steps</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  {suggestion.evidence.steps.map(step => (
                    <li key={step.name}>
                      {step.name} ({step.support} of {suggestion.evidence.noteCount} notes)
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="font-medium text-foreground">What responders wrote</p>
                <ul className="mt-1 space-y-1">
                  {suggestion.evidence.sampleNotes.map((note, index) => (
                    <li key={index} className="break-words">
                      “{note}”
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Streams in after the Runbooks tab; a failed or slow read hides the strip and never the tab. */
export async function MissingRunbookSuggestions({
  serviceId,
  actor,
  canManage,
}: {
  serviceId: string;
  actor: AuthorizationActor;
  canManage: boolean;
}) {
  let suggestions: MissingRunbookSuggestion[] = [];
  try {
    suggestions = await getMissingRunbookSuggestions(serviceId, actor);
  } catch (error) {
    logger.warn('[Service Detail] Runbook suggestions unavailable', {
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return (
    <MissingRunbookList serviceId={serviceId} suggestions={suggestions} canManage={canManage} />
  );
}
