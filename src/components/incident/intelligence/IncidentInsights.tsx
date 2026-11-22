import Link from 'next/link';
import type { ComponentProps } from 'react';
import { ArrowRight, BookOpen, Layers, Sparkles } from 'lucide-react';
import {
  buildStripChips,
  incidentInsightsForRequest,
  incidentTimeAxisForRequest,
  insightsSections,
  showsFreshnessDot,
} from '@/lib/intelligence/incident-ux/strip';
import { toIntelligenceTimelineEvents } from '@/lib/intelligence/incident-ux/timeline-overlay';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import IncidentRecurrence from '@/components/incident/IncidentRecurrence';
import AdhocRunbookLauncher from '@/components/incident/runbooks/AdhocRunbookLauncher';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import InsightsInspectorHost from './InsightsInspectorHost';
import InsightsSections, { runbookTrackRecord } from './InsightsSections';
import IntelligenceStrip from './IntelligenceStrip';

/**
 * Intelligence on the incident page, as four small server components that share ONE per-request read
 * (`incidentInsightsForRequest`): the strip with the inspector behind it, the hero's group line, the suggested
 * runbooks at the top of the Runbooks tab, and the Timeline tab with its intelligence overlay. Each renders
 * nothing when there is nothing to say, when the service's mode is OFF, or on any failure. The caller wraps
 * each in Suspense with an empty (or core-only) fallback so none of them can delay or break the incident.
 */

type Presentation = 'desktop' | 'mobile';

/** "12m before", "18h before", "3d before": change lead time the way people say it. */
function beforeOnset(minutes: number): string {
  if (minutes < 60) return `${minutes}m before`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h before`;
  return `${Math.round(minutes / 1440)}d before`;
}

/**
 * The strip under the command bar (or, as variant "card", the AI briefing card beside the description)
 * and the inspector it opens.
 */
export default async function IncidentInsights({
  incidentId,
  presentation = 'desktop',
  variant = 'strip',
}: {
  incidentId: string;
  presentation?: Presentation;
  variant?: 'strip' | 'card';
}) {
  const insights = await incidentInsightsForRequest(incidentId);
  if (!insights) return null;
  const sections = insightsSections(insights);
  // Already resolved (cached) by incidentInsightsForRequest; the recurrence loader checks the postmortems switch.
  const actor = await getCurrentAuthorizationActor().catch(() => null);
  const routePrefix = presentation === 'mobile' ? '/m' : '';
  const assistant =
    presentation === 'mobile' ? insights.squire.mobileEnabled : insights.squire.enabled;
  const inspector = (
    <InsightsInspectorHost sections={sections} presentation={presentation}>
      <InsightsSections
        insights={insights}
        sections={sections}
        routePrefix={routePrefix}
        assistantName={assistant ? insights.squire.name : undefined}
        recurrence={actor && <IncidentRecurrence incidentId={incidentId} actor={actor} />}
      />
    </InsightsInspectorHost>
  );

  if (variant === 'card') {
    const briefing = insights.proactive?.briefing ?? null;
    const chips = buildStripChips(insights);
    const freshness = showsFreshnessDot(insights.analysis) ? insights.analysis : null;
    // Off: say so in one line instead of disappearing (only intelligence managers reach this, see the caller).
    if (insights.mode === 'OFF')
      return (
        <>
          <section
            aria-labelledby="ai-briefing-heading"
            className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card px-3.5 py-2.5 text-card-foreground"
          >
            <h2
              id="ai-briefing-heading"
              className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              AI briefing is off for this service
            </h2>
            <Link
              href="/settings/intelligence"
              className="shrink-0 text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              Turn on
            </Link>
          </section>
          {inspector}
        </>
      );
    // Nothing to say yet: keep the inspector reachable but show no card.
    if (!briefing && chips.length === 0 && !freshness) return inspector;
    const headline = briefing ? (briefing.ai?.headline ?? briefing.headline) : null;
    const currentState = briefing?.ai?.currentState ?? null;
    const changes = briefing?.refs.changes.slice(0, 2) ?? [];
    const causes = briefing?.ai?.possibleCauses.slice(0, 2) ?? [];
    const nextStep = (briefing?.ai?.nextSteps.length ? briefing.ai.nextSteps : briefing?.nextSteps)?.[0];
    // The card already is the briefing and lists the changes, so those two chips would only repeat it.
    const cardChips = chips.filter(chip => chip.id !== 'briefing' && !(chip.id === 'why' && changes.length));
    const firstSection = sections[0];
    return (
      <>
        <section
          aria-labelledby="ai-briefing-heading"
          className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3.5 py-2">
            <h2
              id="ai-briefing-heading"
              className="flex items-center gap-2 text-xs font-semibold text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              AI briefing
            </h2>
            {briefing && (
              <span className="text-2xs text-muted-foreground">
                {briefing.ai ? 'Written with AI' : 'Basic mode'} · check before acting
              </span>
            )}
          </header>
          <div className="space-y-3 px-3.5 py-3">
            {headline ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold leading-snug text-foreground">{headline}</p>
                {currentState && (
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {currentState}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No briefing yet. What the analysis found so far:
              </p>
            )}

            {causes.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Possible causes · to verify
                </h3>
                <ul className="space-y-1">
                  {causes.map(cause => (
                    <li key={cause} className="flex gap-2 text-xs leading-snug text-foreground">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-elevated" />
                      <span>{cause}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {changes.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Changes before onset
                </h3>
                <ul className="space-y-1">
                  {changes.map(change => (
                    <li key={change.id} className="flex gap-2 text-xs leading-snug">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                      <a
                        href="?insights=why"
                        data-insights-open="why"
                        className="min-w-0 text-foreground underline-offset-2 hover:underline"
                      >
                        {change.label}
                        <span className="text-muted-foreground"> · {beforeOnset(change.minutesBefore)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {nextStep && (
              <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Next
                </span>
                <span className="text-xs font-medium leading-snug text-foreground">{nextStep}</span>
              </div>
            )}

            <IntelligenceStrip
              incidentId={incidentId}
              chips={cardChips}
              freshness={freshness}
              touch={presentation === 'mobile'}
              bare
            />
          </div>
          {firstSection && (
            <footer className="flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2">
              <a
                href={`?insights=${firstSection}`}
                data-insights-open={firstSection}
                className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open investigation
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <kbd
                className="hidden rounded border border-border bg-muted px-1 font-mono text-2xs text-muted-foreground lg:inline"
                title="Keyboard shortcut: I"
              >
                I
              </kbd>
            </footer>
          )}
        </section>
        {inspector}
      </>
    );
  }

  return (
    <>
      {insights.mode !== 'OFF' && (
        <IntelligenceStrip
          incidentId={incidentId}
          chips={buildStripChips(insights)}
          freshness={showsFreshnessDot(insights.analysis) ? insights.analysis : null}
          touch={presentation === 'mobile'}
        />
      )}
      {inspector}
    </>
  );
}

/**
 * One slim line under the title when the incident is a storm parent or child. The full group (mini timeline,
 * ungroup controls) lives in the inspector's Related section, which "View group" opens.
 */
export async function IncidentGroupLine({
  incidentId,
  presentation = 'desktop',
}: {
  incidentId: string;
  presentation?: Presentation;
}) {
  const insights = await incidentInsightsForRequest(incidentId);
  const group = insights && insights.mode !== 'OFF' ? insights.group : null;
  if (!group) return null;
  const routePrefix = presentation === 'mobile' ? '/m' : '';
  const incidents = group.members.filter(member => member.kind === 'INCIDENT').length;
  const alerts = group.members.length - incidents;
  const counted = [
    incidents ? `${incidents} grouped ${incidents === 1 ? 'incident' : 'incidents'}` : null,
    alerts ? `${alerts} grouped ${alerts === 1 ? 'alert' : 'alerts'}` : null,
  ]
    .filter(Boolean)
    .join(' and ');
  return (
    <p
      data-testid="incident-group-line"
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
    >
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {group.role === 'PARENT' ? (
        <span>Parent of {counted || 'a group'}</span>
      ) : group.parent ? (
        <span>
          Grouped under{' '}
          <Link
            href={`${routePrefix}/incidents/${group.parent.id}`}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
          >
            {group.parent.ref} {group.parent.title}
          </Link>
        </span>
      ) : (
        <span>Grouped under a parent incident you cannot view</span>
      )}
      {!group.parentHidden && (
        <>
          <span aria-hidden="true">·</span>
          <a
            href="?insights=related"
            data-insights-open="related"
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 sm:min-h-0"
          >
            View group
          </a>
        </>
      )}
    </p>
  );
}

/** "Suggested for this incident" at the top of the core Runbooks tab: recommended runbooks with their record. */
export async function SuggestedRunbooks({ incidentId }: { incidentId: string }) {
  const insights = await incidentInsightsForRequest(incidentId);
  const runbooks = insights && insights.mode !== 'OFF' ? (insights.response?.runbooks ?? []) : [];
  if (!insights || runbooks.length === 0) return null;
  return (
    <section
      id="runbook-suggested"
      aria-labelledby="runbook-suggested-heading"
      className="mb-4 scroll-mt-24 space-y-2 rounded-lg border border-border bg-muted/20 p-4"
    >
      <div className="space-y-1">
        <h3
          id="runbook-suggested-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Suggested for this incident
        </h3>
        <p className="text-xs text-muted-foreground">
          Runbooks that have worked on this service before. A suggestion, not an instruction:
          nothing runs until you start it.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {runbooks.map(item => (
          <li
            key={item.findingId}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0">
              <Link
                href={`/runbooks/${item.runbookId}`}
                className="text-sm font-medium hover:underline"
              >
                {item.name}
              </Link>
              <p className="text-xs text-muted-foreground">{runbookTrackRecord(item)}</p>
            </div>
            {insights.canExecuteRunbooks && (
              <AdhocRunbookLauncher
                incidentId={incidentId}
                initialRunbookId={item.runbookId}
                label="Run on this incident"
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type TimelineProps = ComponentProps<typeof IncidentTimeline>;

/**
 * The core Timeline with intelligence events merged in. Rendered under Suspense with the plain timeline as
 * its fallback, so the core events never wait for (or depend on) the intelligence read.
 */
export async function IncidentTimelineWithIntelligence(
  props: Omit<TimelineProps, 'intelligenceEvents'> & { incidentId: string }
) {
  const [axis, insights] = await Promise.all([
    incidentTimeAxisForRequest(props.incidentId),
    incidentInsightsForRequest(props.incidentId),
  ]);
  const events = toIntelligenceTimelineEvents(
    axis,
    insights && insights.mode !== 'OFF' ? insights.proactive?.briefing : null
  );
  return <IncidentTimeline {...props} intelligenceEvents={events} />;
}
