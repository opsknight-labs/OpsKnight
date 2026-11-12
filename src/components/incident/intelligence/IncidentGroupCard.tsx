import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getIncidentGroupForActor,
  type IncidentGroupView as GroupView,
} from '@/lib/intelligence/incident-ux/group-view';
import IncidentGroupView from './IncidentGroupView';

/** Server wrapper for the group view: renders nothing unless the incident is grouped, or on any failure. */
export default async function IncidentGroupCard({ incidentId }: { incidentId: string }) {
  let group: GroupView | null = null;
  try {
    group = await getIncidentGroupForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Intelligence] Incident group view unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return group ? <IncidentGroupView incidentId={incidentId} group={group} /> : null;
}
