import type { PublicIncident } from './public-contract';

/** Permalink id: the real incident id when the page publishes ids, else the opaque event id. */
export const incidentLinkId = (incident: PublicIncident): string | undefined =>
  incident.id ?? incident.publicEventId;
