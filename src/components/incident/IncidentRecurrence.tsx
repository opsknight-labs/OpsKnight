import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getPostmortemRecurrenceForActor } from '@/lib/intelligence/postmortems/loaders';
import { PostmortemRecurrenceStrip } from '@/components/postmortem/PostmortemIntelligence';

/**
 * "Seen N times in 90 days; last postmortem; open action items" for the incident page. A server component
 * the incident inspector mounts inside its own Suspense boundary; it renders nothing on a first occurrence,
 * while postmortem intelligence is off, or when the read fails.
 */
export default async function IncidentRecurrence({
  incidentId,
  actor,
}: {
  incidentId: string;
  actor: AuthorizationActor;
}) {
  const recurrence = await getPostmortemRecurrenceForActor(incidentId, actor).catch(() => null);
  return <PostmortemRecurrenceStrip recurrence={recurrence} />;
}
