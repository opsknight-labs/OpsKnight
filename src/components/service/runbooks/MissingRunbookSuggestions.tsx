import { ChevronDown } from 'lucide-react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import {
  getMissingRunbookSuggestions,
  type MissingRunbookSuggestion,
} from '@/lib/intelligence/runbook-health/view';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
import { Button } from '@/components/ui/shadcn/button';
import { draftRunbookFromNotesAction } from '@/app/(app)/services/[id]/runbook-suggestion-actions';

const MAX_SHOWN = 3;

/**
 * Presentation only; renders nothing without a suggestion. Each stored insight keeps its accept, dismiss
 * and evidence controls; below it, the notes and draft steps the viewer may read, and the button that
 * saves them as an unpublished draft runbook.
 */
export function MissingRunbookList({
  serviceId,
  suggestions,
  canManage,
  canDecide,
  squireName,
}: {
  serviceId: string;
  suggestions: readonly MissingRunbookSuggestion[];
  canManage: boolean;
  canDecide: boolean;
  squireName?: string | null;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section id="missing-runbooks" aria-label="Suggested runbooks" className="mb-6 space-y-3">
      {suggestions.slice(0, MAX_SHOWN).map(suggestion => (
        <div key={suggestion.insight.id} className="space-y-2">
          {/* The draft button is right here, so the insight does not link back to this page. */}
          <InsightsPanel
            insights={[{ ...suggestion.insight, draftHref: null }]}
            canDecide={canDecide}
            squireName={squireName}
            label="Missing runbook suggestion"
          />
          {suggestion.steps.length > 0 ? (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {suggestion.template ? `“${suggestion.template}”: ` : ''}
                {suggestion.steps.length} draft {suggestion.steps.length === 1 ? 'step' : 'steps'}{' '}
                from {suggestion.notes.length} notes you can read
                <ChevronDown
                  aria-hidden="true"
                  className="ml-1.5 h-4 w-4 shrink-0 motion-safe:transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="grid gap-4 pb-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <p className="font-medium text-foreground">Draft steps</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-4">
                    {suggestion.steps.map(step => (
                      <li key={step.name}>
                        {step.name} ({step.support} of {suggestion.notes.length} notes)
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="font-medium text-foreground">What responders wrote</p>
                  <ul className="mt-1 space-y-1">
                    {suggestion.notes.slice(0, 3).map((note, index) => (
                      <li key={index} className="break-words">
                        “{note.replace(/\s+/g, ' ').slice(0, 200)}”
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {canManage && (
                <form
                  action={draftRunbookFromNotesAction.bind(null, serviceId, suggestion.insight.id)}
                >
                  <Button type="submit" variant="outline" size="lg" className="px-4">
                    Open a draft in the editor
                  </Button>
                </form>
              )}
            </details>
          ) : (
            <p className="text-xs text-muted-foreground">
              The notes behind this are on incidents you cannot open.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

/** Streams in after the Runbooks tab; a failed or slow read hides the suggestions and never the tab. */
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
  if (suggestions.length === 0) return null;
  const squire = await getAiPublicStatus().catch(() => null);
  return (
    <MissingRunbookList
      serviceId={serviceId}
      suggestions={suggestions}
      canManage={canManage}
      canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
      squireName={squire?.squireEnabled ? squire.squireName : null}
    />
  );
}
