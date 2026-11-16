import Link from 'next/link';
import type { ComponentProps } from 'react';
import { BookOpen, Layers } from 'lucide-react';
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

/** The strip under the command bar and the inspector it opens. */
export default async function IncidentInsights({
  incidentId,
  presentation = 'desktop',
}: {
  incidentId: string;
  presentation?: Presentation;
}) {
  const insights = await incidentInsightsForRequest(incidentId);
  if (!insights) return null;
  const sections = insightsSections(insights);
  // Already resolved (cached) by incidentInsightsForRequest; the recurrence loader checks the postmortems switch.
  const actor = await getCurrentAuthorizationActor().catch(() => null);
  const routePrefix = presentation === 'mobile' ? '/m' : '';
  const assistant =
    presentation === 'mobile' ? insights.squire.mobileEnabled : insights.squire.enabled;
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
      <InsightsInspectorHost sections={sections} presentation={presentation}>
        <InsightsSections
          insights={insights}
          sections={sections}
          routePrefix={routePrefix}
          assistantName={assistant ? insights.squire.name : undefined}
          recurrence={actor && <IncidentRecurrence incidentId={incidentId} actor={actor} />}
        />
      </InsightsInspectorHost>
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
