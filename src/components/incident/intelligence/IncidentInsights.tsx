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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
import { cn } from '@/lib/utils';

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
  /** `card`: the compact AI briefing card under the title card (desktop); `strip`: chips (phones). */
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

  // The AI briefing card only when an AI wrote a briefing. Intelligence off, or Basic mode (no AI provider):
  // no AI card; the plain chip strip below carries whatever the analysis found, and the inspector behind it.
  const aiBriefing = insights.mode === 'OFF' ? null : (insights.proactive?.briefing ?? null);
  if (variant === 'card' && aiBriefing?.ai) {
    const briefing = aiBriefing;
    const ai = aiBriefing.ai;
    const chips = buildStripChips(insights);
    const freshness = showsFreshnessDot(insights.analysis) ? insights.analysis : null;
    const changes = briefing.refs.changes.slice(0, 2);
    const causes = ai.possibleCauses.slice(0, 2);
    const nextStep = (ai.nextSteps.length ? ai.nextSteps : briefing.nextSteps)[0];
    // The card already is the briefing and lists the changes, so those two chips would only repeat it.
    const cardChips = chips.filter(
      chip => chip.id !== 'briefing' && !(chip.id === 'why' && changes.length)
    );
    const firstSection = sections[0];
    const facts = [
      ai.currentState && {
        label: 'Summary',
        body: (
          <p
            className="line-clamp-3 text-xs leading-relaxed text-foreground/90"
            title={ai.currentState}
          >
            {ai.currentState}
          </p>
        ),
      },
      causes.length > 0 && {
        label: 'Possible causes, to verify',
        body: (
          <ul className="space-y-1">
            {causes.map(cause => (
              <li
                key={cause}
                className="flex gap-1.5 text-xs leading-snug text-foreground"
                title={cause}
              >
                <span aria-hidden="true" className="text-muted-foreground">
                  –
                </span>
                <span className="line-clamp-2">{cause}</span>
              </li>
            ))}
          </ul>
        ),
      },
      changes.length > 0 && {
        label: 'Changes before onset',
        body: (
          <ul className="space-y-1">
            {changes.map(change => (
              <li
                key={change.id}
                className="flex gap-1.5 text-xs leading-snug"
                title={change.label}
              >
                <span aria-hidden="true" className="text-muted-foreground">
                  –
                </span>
                <a
                  href="?insights=why"
                  data-insights-open="why"
                  className="line-clamp-2 min-w-0 text-foreground underline-offset-2 hover:underline"
                >
                  {change.label}
                  <span className="tabular-nums text-muted-foreground">
                    {' '}
                    · {beforeOnset(change.minutesBefore)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ),
      },
    ].filter(Boolean) as Array<{ label: string; body: React.ReactNode }>;
    // The columns are clamped; hovering (or focusing) one shows it in full, with every cause and change.
    const full: Record<string, React.ReactNode> = {
      Summary: <p className="text-xs leading-relaxed text-foreground">{ai.currentState}</p>,
      'Possible causes, to verify': (
        <ul className="space-y-1.5">
          {ai.possibleCauses.map(cause => (
            <li key={cause} className="flex gap-1.5 leading-snug text-foreground">
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              {cause}
            </li>
          ))}
        </ul>
      ),
      'Changes before onset': (
        <ul className="space-y-1.5">
          {briefing.refs.changes.map(change => (
            <li key={change.id} className="flex gap-1.5 leading-snug text-foreground">
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              <span>
                {change.label}
                <span className="tabular-nums text-muted-foreground">
                  {' '}
                  · {beforeOnset(change.minutesBefore)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ),
    };
    return (
      <>
        {/* Under the title card: what is happening (headline), why (summary, causes, changes), what to do.
            Its AI identity is the Investigation panel's: the dark mark and the "written with AI" line. */}
        <section
          aria-labelledby="ai-briefing-heading"
          className="min-w-0 rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs"
        >
          <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3 pb-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-xs"
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 basis-80">
              <p className="text-2xs text-muted-foreground">
                <span
                  id="ai-briefing-heading"
                  role="heading"
                  aria-level={2}
                  className="font-semibold text-foreground"
                >
                  AI briefing
                </span>
                {' · written with AI, check before acting'}
              </p>
              <p className="mt-0.5 font-display text-base font-semibold leading-snug tracking-tight text-foreground">
                {ai.headline}
              </p>
              {nextStep && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground" title={nextStep}>
                  <span className="font-medium text-foreground">Next:</span> {nextStep}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">
              <IntelligenceStrip
                incidentId={incidentId}
                chips={cardChips}
                freshness={freshness}
                touch={presentation === 'mobile'}
                bare
              />
              {firstSection && (
                <a
                  href={`?insights=${firstSection}`}
                  data-insights-open={firstSection}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-semibold text-background shadow-xs transition-colors hover:bg-foreground/85 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Open investigation
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <kbd
                    className="hidden rounded border border-background/25 px-1 font-mono text-2xs font-normal text-background/70 lg:inline"
                    title="Keyboard shortcut: I"
                  >
                    I
                  </kbd>
                </a>
              )}
            </div>
          </div>
          {facts.length > 0 && (
            // Hairlines between columns; the facts line up under the headline's text, not under the mark.
            <dl className="grid min-w-0 gap-y-3 border-t border-border/60 px-4 py-2.5 gap-x-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-0 lg:divide-x lg:divide-border/60">
              {facts.map((fact, index) => (
                <HoverCard key={fact.label} openDelay={250} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <div
                      tabIndex={0}
                      className={cn(
                        'min-w-0 cursor-default rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                        index > 0 && 'lg:pl-4',
                        index < facts.length - 1 && 'lg:pr-4'
                      )}
                    >
                      <dt className="mb-1 text-2xs font-semibold text-muted-foreground">
                        {fact.label}
                      </dt>
                      <dd>{fact.body}</dd>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-xs">
                    <p className="mb-1.5 text-2xs font-semibold text-muted-foreground">
                      {fact.label}
                    </p>
                    {full[fact.label]}
                  </HoverCardContent>
                </HoverCard>
              ))}
            </dl>
          )}
        </section>
        {inspector}
      </>
    );
  }

  // The strip (phones, and desktop when there is no AI briefing). On desktop, a strip with no chips would be
  // a bare freshness dot under the title card, so it shows only when there is something to open.
  const stripChips = insights.mode === 'OFF' ? [] : buildStripChips(insights);
  const stripFreshness = showsFreshnessDot(insights.analysis) ? insights.analysis : null;
  // Desktop with no chips: show the dot only while analysis is under way or paused, never a lone "out of date".
  const showStrip =
    insights.mode !== 'OFF' &&
    (stripChips.length > 0 ||
      (Boolean(stripFreshness) && (variant === 'strip' || stripFreshness?.status !== 'STALE')));
  return (
    <>
      {showStrip && (
        <IntelligenceStrip
          incidentId={incidentId}
          chips={stripChips}
          freshness={stripFreshness}
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
