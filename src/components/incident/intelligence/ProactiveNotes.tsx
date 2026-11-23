import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import RelativeTime from '@/components/patterns/RelativeTime';
import SquireMarkdown from '@/components/squire/SquireMarkdown';
import { toneClasses } from '@/components/patterns/status-tone';
import type {
  InvestigationView,
  ProactiveNotesView,
} from '@/lib/intelligence/memory/proactive-view';

const modeLabel = (mode: 'BASIC' | 'AI') => (mode === 'AI' ? 'Written with AI' : 'Basic mode');

type Digest = InvestigationView['updates'][number];

/** One "What changed" entry: only the lists that have something in them. */
function DigestEntry({ digest }: { digest: Digest }) {
  const lists: Array<[string, string[]]> = [
    ['New hypotheses', digest.added],
    ['More likely', digest.up],
    ['Less likely', digest.down],
    ['Ruled out', digest.ruledOut],
    ['No longer supported', digest.dropped],
    ['New next checks', digest.nextChecks],
  ];
  const changed =
    digest.leading || digest.newEvidence.length || lists.some(([, items]) => items.length);
  return (
    <li className="space-y-1">
      <p className="text-xs text-muted-foreground">
        <RelativeTime date={new Date(digest.at)} format="long" />
        {digest.signals.length ? ` · after ${digest.signals.join(', ')}` : ''}
      </p>
      {digest.leading && (
        <p>
          <span className="font-medium">Leading hypothesis is now: </span>
          {digest.leading}
        </p>
      )}
      {lists.map(([label, items]) =>
        items.length ? (
          <div key={label}>
            <p className="font-medium">{label}</p>
            <ul className="list-disc pl-5">
              {items.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null
      )}
      {digest.newEvidence.length > 0 && (
        <div>
          <p className="font-medium">New evidence</p>
          <ul className="list-disc pl-5">
            {digest.newEvidence.map(item => (
              <li key={`${item.kind}:${item.id}`}>
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!changed && <p className="text-muted-foreground">No change to the conclusion.</p>}
    </li>
  );
}

/**
 * Squire's proactive notes for one incident: a briefing, a stakeholder-update nudge and a postmortem draft,
 * each only when its service opted in. Presentational: the inspector's Briefing section passes the notes the
 * incident-insights loader already read for this viewer.
 */
export function ProactiveNotes({
  incidentId,
  notes,
  routePrefix = '',
  action,
  assistantName = 'Squire',
}: {
  incidentId: string;
  notes: ProactiveNotesView;
  /** `/m` on the mobile route, so incident links stay in the mobile shell. */
  routePrefix?: string;
  /** Optional control shown beside the heading (the inspector's "Ask Squire"). */
  action?: ReactNode;
  /** The configured assistant name (Settings → Assistant). */
  assistantName?: string;
}) {
  const { briefing, nudge, postmortemDraft, investigation, verification } = notes;
  // Unique per instance: the desktop inspector and the mobile sheet can both render the notes.
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 id={headingId} className="text-sm font-semibold">
            {assistantName}
          </h3>
        </div>
        {action}
      </div>

      {nudge && (
        <div
          role="status"
          className={`space-y-2 rounded-md border p-3 text-sm ${toneClasses('elevated').soft}`}
        >
          <p className="font-medium">
            No stakeholder update for {nudge.minutesSinceUpdate} minutes.
          </p>
          <p className="text-muted-foreground">Suggested update (review before posting):</p>
          <p className="whitespace-pre-wrap wrap-break-word">{nudge.aiDraft ?? nudge.draft}</p>
        </div>
      )}

      {verification && (
        <div
          role="status"
          className={
            verification.holding
              ? 'space-y-1 rounded-md border border-border p-3 text-sm'
              : `space-y-1 rounded-md border p-3 text-sm ${toneClasses('critical').soft}`
          }
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-medium">
              {verification.trigger === 'RESOLVE' ? 'Did the fix hold?' : 'After the runbook'}
            </h4>
            <span className="text-xs text-muted-foreground">
              Checked <RelativeTime date={new Date(verification.checkedAt)} format="long" />
            </span>
          </div>
          <p>{verification.headline}</p>
          {verification.related.length > 0 && (
            <ul className="space-y-1">
              {verification.related.map(item => (
                <li key={item.id}>
                  <Link href={`${routePrefix}/incidents/${item.id}`} className="hover:underline">
                    {item.label}
                  </Link>{' '}
                  <span className="text-xs text-muted-foreground">
                    {item.opened
                      ? 'new'
                      : `${item.alerts} new alert${item.alerts === 1 ? '' : 's'}`}{' '}
                    · {item.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {investigation && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-medium">{assistantName} investigated this</h4>
            <span className="text-xs text-muted-foreground">
              {investigation.revision > 1 ? 'Updated ' : ''}
              <RelativeTime date={investigation.updatedAt} format="long" />
              {investigation.revision > 1
                ? ` · ${investigation.revision - 1} update${investigation.revision === 2 ? '' : 's'}`
                : ''}
              {investigation.partial ? ' · partial' : ''}
            </span>
          </div>
          {investigation.answer ? (
            <SquireMarkdown
              text={investigation.answer}
              allowed={investigation.citations.map(item => item.href)}
              references={investigation.citations}
            />
          ) : (
            <p className="text-muted-foreground">
              This investigation used sources you cannot open, so it is not shown.
            </p>
          )}
          {investigation.updates.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">
                Updates ({investigation.updates.length})
              </summary>
              <ol className="mt-2 space-y-3">
                {investigation.updates.map(digest => (
                  <DigestEntry key={`${digest.revision}:${digest.at}`} digest={digest} />
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {briefing && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-medium">Briefing</h4>
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
                    <Link href={`${routePrefix}/incidents/${item.id}`} className="hover:underline">
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
                href={`${routePrefix}/incidents/${incidentId}?tab=runbooks`}
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
