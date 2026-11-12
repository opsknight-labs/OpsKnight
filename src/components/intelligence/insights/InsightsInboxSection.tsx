import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import { listInsightsInbox } from '@/lib/intelligence/ops-insights/view';
import { OverviewSection } from '@/components/intelligence/overview/primitives';
import InsightsPanel from './InsightsPanel';

/**
 * Operations insights across every area, for the "Needs attention" inbox on /intelligence. An async server
 * component meant to sit behind its own Suspense boundary. It renders nothing when the feature is off, when
 * the viewer can see no open insight, or when loading fails: the inbox is quiet by default.
 */
export default async function InsightsInboxSection({
  actor,
  limit = 10,
}: {
  actor: AuthorizationActor;
  limit?: number;
}) {
  let inbox: Awaited<ReturnType<typeof listInsightsInbox>>;
  try {
    inbox = await listInsightsInbox(actor, { limit });
  } catch (error) {
    logger.warn('[Intelligence] Operations insights inbox not shown', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (inbox.items.length === 0) return null;
  // The assistant hand-off only shows while Squire is on; a failed status read just hides it.
  const squire = await getAiPublicStatus().catch(() => null);
  return (
    <OverviewSection
      id="overview-ops-insights"
      title="Needs attention"
      description="What OpsKnight noticed about your services, policies, schedules and runbooks. Each one links to where a person can fix it; nothing changes on its own."
    >
      <InsightsPanel
        insights={inbox.items}
        canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
        squireName={squire?.squireEnabled ? squire.squireName : null}
        label="Operations insights that need attention"
      />
      {inbox.nextCursor && (
        <p className="text-xs text-muted-foreground">
          Showing the {inbox.items.length} most severe. Accept or dismiss some to see more.
        </p>
      )}
    </OverviewSection>
  );
}
