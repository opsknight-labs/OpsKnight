import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { BookOpen, Compass, FileText, GitCommitHorizontal, History, Link2 } from 'lucide-react';
import type { IncidentInsights } from '@/lib/intelligence/incident-ux/strip';
import type { InsightsSectionId } from '@/lib/intelligence/incident-ux/strip-contract';
import { isImpactEmpty } from '@/lib/intelligence/impact/view';
import IncidentAiSummary from '@/components/incident/IncidentAiSummary';
import { ImpactCardBody } from '@/components/incident/IncidentImpactCard';
import MarkRelatedIncident from '@/components/incident/MarkRelatedIncident';
import RelatedIncidentActions from '@/components/incident/RelatedIncidentActions';
import SimilarIncidentFeedback from '@/components/incident/SimilarIncidentFeedback';
import TriageChips from '@/components/incident/TriageChips';
import type { SquireEvidenceKind } from '@/components/squire/squire-bus';
import AskSquireAbout from './AskSquireAbout';
import FreshnessDot from './FreshnessDot';
import IncidentGroupView from './IncidentGroupView';
import { ProactiveNotes } from './ProactiveNotes';

/**
 * The content of the insights inspector: Briefing · Triage · Similar · Related/Group · Why · Runbooks that
 * worked · Impact · Summary, in that order, each rendered only when it has something to show. Server-rendered
 * from the one per-request insights read, so opening the inspector costs no extra query.
 *
 * Every item carries a stable anchor (`id="finding-<id>"`) for deep links and citations, and, when the
 * assistant is available, an "Ask <name>" action that opens it with a question about that item.
 */

const RELATION_LABEL = {
  SAME_SERVICE: 'Same service',
  UPSTREAM: 'Upstream dependency',
  GLOBAL: 'Not tied to a service',
} as const;

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const formatLead = (minutes: number) =>
  minutes < 1
    ? 'moments before'
    : minutes < 90
      ? `${minutes} min before`
      : `${Math.round(minutes / 60)} h before`;

/** 45 min, 3 h 10 min, 2 d 4 h. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

const formatMetric = (value: number) =>
  Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '—';
const quote = (text: string) => `"${text.length > 120 ? `${text.slice(0, 119)}…` : text}"`;

const ITEM_CLASS = 'scroll-mt-4 py-2 target:rounded-md target:bg-accent/60';

function Section({
  id,
  headingId,
  icon,
  title,
  note,
  children,
}: {
  id: InsightsSectionId;
  headingId: string;
  icon: ReactNode;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`insights-${id}`}
      aria-labelledby={headingId}
      tabIndex={-1}
      className="scroll-mt-4 space-y-2 rounded-lg border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="space-y-1">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function InsightsSections({
  insights,
  sections,
  routePrefix = '',
  assistantName,
  recurrence,
}: {
  insights: IncidentInsights;
  /** Sections with content, from `insightsSections(insights)`. */
  sections: InsightsSectionId[];
  routePrefix?: string;
  /** Set when the assistant can be opened from this surface. */
  assistantName?: string;
  /** Postmortem recurrence (a streamed server component); renders nothing when there is nothing to show. */
  recurrence?: ReactNode;
}) {
  const { incidentId } = insights;
  const has = (id: InsightsSectionId) => sections.includes(id);
  const incidentHref = (id: string) => `${routePrefix}/incidents/${id}`;
  // `id` omitted means the whole section: the handle then carries the incident id (see squire-bus).
  const ask = (
    subject: string,
    question: string,
    evidence: { kind: SquireEvidenceKind; id?: string; label?: string }
  ) =>
    assistantName ? (
      <AskSquireAbout
        assistantName={assistantName}
        subject={subject}
        question={question}
        incidentId={incidentId}
        evidence={{ ...evidence, id: evidence.id ?? incidentId }}
      />
    ) : null;

  return (
    <div className="space-y-3">
      {insights.mode === 'OFF' && (
        <p
          data-testid="insights-off-hint"
          className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground"
        >
          Intelligence is off for this service, so responders see no suggestions here.{' '}
          {sections.length > 0 &&
            'Links made before it was switched off can still be undone below. '}
          <Link
            href="/settings/intelligence"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Open intelligence settings
          </Link>
        </p>
      )}

      {insights.mode !== 'OFF' && sections.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {insights.analysis && insights.analysis.status !== 'CURRENT'
            ? insights.analysis.message
            : 'Nothing to show for this incident yet.'}
        </p>
      )}

      {/* The strip carries the dot while analysis is unfinished; managers refresh a current one from here. */}
      {insights.analysis?.status === 'CURRENT' && insights.analysis.canRefresh && (
        <FreshnessDot incidentId={incidentId} initial={insights.analysis} variant="inline" />
      )}

      {has('briefing') && insights.proactive && (
        <div
          id="insights-briefing"
          tabIndex={-1}
          className="scroll-mt-4 focus-visible:outline-none"
        >
          <ProactiveNotes
            incidentId={incidentId}
            notes={insights.proactive}
            routePrefix={routePrefix}
            action={ask('this briefing', 'Summarise this incident', {
              kind: 'briefing',
              label: 'Briefing',
            })}
          />
        </div>
      )}

      {has('triage') && insights.triage && (
        <Section
          id="triage"
          headingId="triage-suggestions-heading"
          icon={<Compass className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
          title="Triage suggestions"
          note="From how similar incidents were handled. Apply what fits; nothing changes on its own."
        >
          <TriageChips
            incidentId={incidentId}
            suggestions={insights.triage.suggestions}
            canAct={insights.triage.canAct}
            assistantName={assistantName}
          />
        </Section>
      )}

      {has('similar') && insights.similar && (
        <Section
          id="similar"
          headingId="similar-incidents-heading"
          icon={<History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
          title="Similar past incidents"
        >
          <ul className="divide-y divide-border">
            {insights.similar.map(item => (
              <li
                key={item.incidentId}
                id={`finding-${item.findingId}`}
                className={`${ITEM_CLASS} flex flex-wrap items-start justify-between gap-2`}
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={incidentHref(item.incidentId)}
                    className="text-sm font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {item.serviceName} · {formatDate(item.createdAt)} · {item.status.toLowerCase()}
                    {item.minutesToResolve !== null &&
                      ` · resolved in ${formatDuration(item.minutesToResolve)}`}
                  </p>
                  {item.resolutionSummary && (
                    <p className="text-xs text-foreground/80">Fixed by: {item.resolutionSummary}</p>
                  )}
                  {item.postmortem && (
                    <p className="text-xs">
                      <Link
                        href={item.postmortem.href}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        Postmortem
                      </Link>
                    </p>
                  )}
                  <details className="text-xs">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium sm:min-h-8 sm:py-2">
                      Why this matched
                    </summary>
                    <ul className="flex flex-wrap gap-1" aria-label="Why this matched">
                      {item.reasons.map(reason => (
                        <li key={reason} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className="text-xs tabular-nums text-muted-foreground"
                    title="A ranking signal for ordering suggestions, not a probability"
                  >
                    Match {item.matchPercent}%
                  </span>
                  {insights.canGiveFeedback && (
                    <MarkRelatedIncident
                      incidentId={incidentId}
                      otherIncidentId={item.incidentId}
                    />
                  )}
                  {insights.canGiveFeedback && (
                    <SimilarIncidentFeedback
                      incidentId={incidentId}
                      findingId={item.findingId}
                      initialVerdict={item.myVerdict}
                    />
                  )}
                  {ask(
                    item.title,
                    `Have we seen this before? Compare this incident with the similar incident ${quote(item.title)}.`,
                    { kind: 'similar', id: item.findingId, label: item.title }
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {has('related') && (
        <div
          id="insights-related"
          tabIndex={-1}
          className="scroll-mt-4 space-y-3 focus-visible:outline-none"
        >
          {insights.group && (
            <div className="space-y-1">
              <IncidentGroupView
                incidentId={incidentId}
                group={insights.group}
                routePrefix={routePrefix}
              />
              {!insights.group.parentHidden &&
                ask('this group', 'Why were these incidents and alerts grouped together?', {
                  kind: 'group',
                  label: 'Group',
                })}
            </div>
          )}
          {insights.related && insights.related.length > 0 && (
            <section
              aria-labelledby="related-incidents-heading"
              className="space-y-2 rounded-lg border border-border bg-card p-4"
            >
              <h3
                id="related-incidents-heading"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Related incidents
              </h3>
              <ul className="divide-y divide-border">
                {insights.related.map(item => (
                  <li
                    key={item.relationshipId}
                    id={`finding-${item.relationshipId}`}
                    className={`${ITEM_CLASS} flex flex-wrap items-start justify-between gap-2`}
                  >
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={incidentHref(item.incidentId)}
                        className="text-sm font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {item.serviceName} · {formatDate(item.createdAt)} ·{' '}
                        {item.status.toLowerCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.automatic
                          ? 'Automatically grouped after paging'
                          : item.origin === 'HUMAN'
                            ? 'Linked by a responder'
                            : item.ruleId
                              ? `Suggested by grouping rule “${item.ruleId}”`
                              : 'Suggested by a grouping rule'}
                        {item.decision === 'ACCEPTED' ? ' · confirmed' : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {insights.canGiveFeedback && (
                        <RelatedIncidentActions
                          incidentId={incidentId}
                          relationshipId={item.relationshipId}
                          decision={item.decision}
                          automatic={item.automatic}
                        />
                      )}
                      {ask(
                        item.title,
                        `Is ${quote(item.title)} a similar incident, and how is it related to this one?`,
                        {
                          kind: 'related',
                          id: item.relationshipId,
                          label: item.title,
                        }
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Links never merge incidents or change routing, and each can be undone.
              </p>
            </section>
          )}
        </div>
      )}

      {recurrence && <Suspense fallback={null}>{recurrence}</Suspense>}

      {has('why') && insights.response && (
        <Section
          id="why"
          headingId="response-intelligence-heading"
          icon={
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          }
          title="Possible causes"
          note="Based on timing and service dependencies. These are leads to verify, not confirmed causes."
        >
          {insights.response.changes.length > 0 && (
            <ul className="divide-y divide-border">
              {insights.response.changes.map(change => (
                <li
                  key={change.findingId}
                  id={`finding-${change.findingId}`}
                  className={`${ITEM_CLASS} space-y-1`}
                >
                  <p className="text-sm font-medium">
                    {change.url ? (
                      <a
                        href={change.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {change.summary}
                      </a>
                    ) : (
                      <Link href={`/changes/${change.changeId}`} className="hover:underline">
                        {change.summary}
                      </Link>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {change.kind.replace('_', ' ').toLowerCase()} · {formatLead(change.leadMinutes)}{' '}
                    onset · {RELATION_LABEL[change.relation]}
                    {change.serviceName ? ` (${change.serviceName})` : ''} · {change.source}
                    {change.version ? ` · ${change.version}` : ''}
                    {change.riskPercent !== null && (
                      <span
                        className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs text-foreground"
                        title="Change risk: history of incidents after similar changes, blast radius, timing and size. A ranking signal, not a verdict."
                      >
                        risk {change.riskPercent}%
                      </span>
                    )}
                  </p>
                  {ask(
                    change.summary,
                    `What changed before this started? Could ${quote(change.summary)} have caused this incident?`,
                    { kind: 'change', id: change.findingId, label: change.summary }
                  )}
                </li>
              ))}
            </ul>
          )}
          {insights.response.upstreamIncidents.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Upstream incidents
              </h4>
              <ul className="divide-y divide-border">
                {insights.response.upstreamIncidents.map(item => (
                  <li key={item.findingId} id={`finding-${item.findingId}`} className={ITEM_CLASS}>
                    <Link
                      href={incidentHref(item.incidentId)}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.serviceName} · {formatLead(item.leadMinutes)} this one ·{' '}
                      {item.status.toLowerCase()}
                    </p>
                    {ask(
                      item.title,
                      `Could the upstream incident ${quote(item.title)} on ${item.serviceName} be causing this one?`,
                      { kind: 'upstream', id: item.findingId, label: item.title }
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights.response.metricAnomalies && insights.response.metricAnomalies.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Metrics that moved
              </h4>
              <ul className="divide-y divide-border" aria-label="Metric anomalies">
                {insights.response.metricAnomalies.map(item => (
                  <li key={item.findingId} id={`finding-${item.findingId}`} className={ITEM_CLASS}>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.leadMinutes >= 0
                        ? `${formatLead(item.leadMinutes)} onset`
                        : `${-item.leadMinutes} min after onset`}{' '}
                      · {RELATION_LABEL[item.relation]} ({item.serviceName}) ·{' '}
                      {formatMetric(item.value)} vs usual {formatMetric(item.baselineMedian)}
                    </p>
                    {ask(
                      item.title,
                      `Could the metric change ${quote(item.title)} on ${item.serviceName} explain this incident?`,
                      { kind: 'cause', id: item.findingId, label: item.title }
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {has('runbooks') && insights.response && (
        <Section
          id="runbooks"
          headingId="runbooks-that-worked-heading"
          icon={<BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
          title="Runbooks that have worked here"
        >
          <ul className="divide-y divide-border">
            {insights.response.runbooks.map(item => (
              <li key={item.findingId} id={`finding-${item.findingId}`} className={ITEM_CLASS}>
                <Link
                  href={`/runbooks/${item.runbookId}`}
                  className="text-sm font-medium hover:underline"
                >
                  {item.name}
                </Link>
                <p className="text-xs text-muted-foreground">{runbookTrackRecord(item)}</p>
                {ask(item.name, `Which runbook fits? Would ${quote(item.name)} help here?`, {
                  kind: 'runbook',
                  id: item.findingId,
                  label: item.name,
                })}
              </li>
            ))}
          </ul>
          <a
            href="#runbook-suggested"
            className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-2 sm:min-h-8"
          >
            Run one from the Runbooks tab
          </a>
        </Section>
      )}

      {has('impact') && insights.impact && !isImpactEmpty(insights.impact) && (
        <div id="insights-impact" tabIndex={-1} className="scroll-mt-4 focus-visible:outline-none">
          <ImpactCardBody
            view={insights.impact}
            action={ask(
              'the estimated impact',
              'What is the impact of this incident on dependent services and error budgets?',
              { kind: 'impact', label: 'Impact' }
            )}
          />
        </div>
      )}

      {has('summary') && (
        <div id="insights-summary" tabIndex={-1} className="scroll-mt-4 focus-visible:outline-none">
          <IncidentAiSummary incidentId={incidentId} canPostNote={insights.canPostNote} />
        </div>
      )}

      {insights.mode !== 'OFF' && sections.length > 0 && (
        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Suggestions come from past incidents, changes and dependencies. They are hints for
          responders and never change routing or notifications.
        </p>
      )}
    </div>
  );
}

/** "Succeeded 3 of 4 completed runs on this service (75%)". */
export function runbookTrackRecord(item: { succeeded: number; eligible: number }): string {
  return item.eligible > 0
    ? `Succeeded ${item.succeeded} of ${item.eligible} completed runs on this service (${Math.round(
        (item.succeeded / item.eligible) * 100
      )}%)`
    : 'Attached to this service, not run yet';
}
