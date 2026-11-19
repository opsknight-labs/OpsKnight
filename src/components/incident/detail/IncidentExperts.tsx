import { cache } from 'react';
import { logger } from '@/lib/logger';
import { resolveUserActor } from '@/lib/authorization-actors';
import { loadIncidentExperts } from '@/lib/intelligence/triage/experts';
import IncidentExpertsLine from './IncidentExpertsLine';

// The responders card renders in up to three layout slots; one read per request.
const expertsFor = cache((viewerId: string, incidentId: string) =>
  resolveUserActor(viewerId)
    .then(actor => (actor ? loadIncidentExperts(actor, incidentId) : []))
    .catch((error: unknown) => {
      logger.warn('intelligence.experts.unavailable', { incidentId, error });
      return [];
    })
);

/** Server entry for the "Experts" line. Quiet: nothing while the switch is off, empty or failing. */
export default async function IncidentExperts({
  incidentId,
  viewerId,
  onAddWatcher,
}: {
  incidentId: string;
  viewerId: string;
  onAddWatcher: (formData: FormData) => void | Promise<void>;
}) {
  const experts = await expertsFor(viewerId, incidentId);
  return experts.length > 0 ? (
    <IncidentExpertsLine experts={experts} onAddWatcher={onAddWatcher} />
  ) : null;
}
