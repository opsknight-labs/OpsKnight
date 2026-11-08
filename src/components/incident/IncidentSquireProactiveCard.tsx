import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getProactiveNotesForActor,
  type ProactiveNotesView,
} from '@/lib/intelligence/memory/proactive-view';

/**
 * Squire's proactive notes for one incident: a briefing, a stakeholder-update nudge and a postmortem draft, each
 * only when its service opted in. Advisory: renders nothing on any failure and never affects the incident page.
 */
export default async function IncidentSquireProactiveCard({ incidentId }: { incidentId: string }) {
  let notes: ProactiveNotesView | null;
  try {
    notes = await getProactiveNotesForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Squire] Proactive notes unavailable', {
      incidentId,
      error: error instanceof Error ? error.name : 'error',
    });
    return null;
  }
  if (!notes) return null;
  return <ProactiveNotes incidentId={incidentId} notes={notes} />;
}

const modeLabel = (mode: 'BASIC' | 'AI') => (mode === 'AI' ? 'Written with AI' : 'Basic mode');

export function ProactiveNotes({
  incidentId,
  notes,
}: {
  incidentId: string;
  notes: ProactiveNotesView;
}) {
  const { briefing, nudge, postmortemDraft } = notes;
  return (
    <section
      aria-labelledby="squire-proactive-heading"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="squire-proactive-heading" className="text-sm font-semibold">
          Squire
        </h2>
      </div>

      {nudge && (
        <div
          role="status"
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            No stakeholder update for {nudge.minutesSinceUpdate} minutes.
          </p>
          <p className="text-muted-foreground">Suggested update (review before posting):</p>
          <p className="whitespace-pre-wrap break-words">{nudge.aiDraft ?? nudge.draft}</p>
        </div>
      )}

      {briefing && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Briefing</h3>
            <span className="text-xs text-muted-foreground">{modeLabel(briefing.mode)}</span>
          </div>
          <p>{briefing.ai?.headline ?? briefing.headline}</p>
          {briefing.ai ? (
            <p className="text-muted-foreground">{briefing.ai.currentState}</p>
          ) : (
            <ul className="list-disc pl-5 text-muted-foreground">
              {briefing.facts.map(fact => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          )}
          {briefing.analysisPending && (
            <p className="text-xs text-muted-foreground">
              Written before the first analysis finished; similar incidents may be missing.
            </p>
          )}
          {briefing.refs.similar.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase text-muted-foreground">
                Similar incidents
              </h4>
              <ul className="space-y-1">
                {briefing.refs.similar.map(item => (
                  <li key={item.id}>
                    <Link href={`/incidents/${item.id}`} className="hover:underline">
                      {item.label}
                    </Link>{' '}
                    <span className="text-xs text-muted-foreground">
                      {item.matchPercent}% match
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {briefing.refs.changes.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase text-muted-foreground">
                Likely change (unconfirmed)
              </h4>
              <ul className="space-y-1">
                {briefing.refs.changes.map(item => (
                  <li key={item.id}>
                    <Link href={`/changes/${item.id}`} className="hover:underline">
                      {item.label}
                    </Link>{' '}
                    <span className="text-xs text-muted-foreground">
                      {item.minutesBefore} min before onset
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(briefing.ai?.possibleCauses.length ?? 0) > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase text-muted-foreground">
                Possible causes (to verify)
              </h4>
              <ul className="list-disc pl-5">
                {briefing.ai!.possibleCauses.map(cause => (
                  <li key={cause}>{cause}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="text-xs font-medium uppercase text-muted-foreground">Next steps</h4>
            <ol className="list-decimal pl-5">
              {(briefing.ai?.nextSteps.length ? briefing.ai.nextSteps : briefing.nextSteps).map(
                step => (
                  <li key={step}>{step}</li>
                )
              )}
            </ol>
          </div>
          {briefing.refs.runbooks.length > 0 && (
            <p>
              Suggested runbook:{' '}
              <Link
                href={`/incidents/${incidentId}?tab=runbooks`}
                className="font-medium hover:underline"
              >
                {briefing.refs.runbooks[0].label}
              </Link>
            </p>
          )}
        </div>
      )}

      {postmortemDraft && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Postmortem draft{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {modeLabel(postmortemDraft.mode)} · not published
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              <span className="font-medium">Summary: </span>
              {postmortemDraft.summary}
            </p>
            <p>
              <span className="font-medium">Impact: </span>
              {postmortemDraft.impact}
            </p>
            <p>
              <span className="font-medium">Root cause: </span>
              {postmortemDraft.rootCause}
            </p>
            <p>
              <span className="font-medium">Resolution: </span>
              {postmortemDraft.resolution}
            </p>
            <p>
              <span className="font-medium">Lessons: </span>
              {postmortemDraft.lessons}
            </p>
            {postmortemDraft.actionItems.length > 0 && (
              <ul className="list-disc pl-5">
                {postmortemDraft.actionItems.map(item => (
                  <li key={item.title}>
                    {item.title}{' '}
                    <span className="text-xs text-muted-foreground">
                      {item.priority.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/postmortems/${incidentId}`} className="inline-block underline">
              Open the postmortem editor
            </Link>
          </div>
        </details>
      )}
    </section>
  );
}
