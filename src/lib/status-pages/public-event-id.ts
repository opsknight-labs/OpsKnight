import { createHmac } from 'node:crypto';

/** Domain-separated HMACs keep public identifiers stable without disclosing internal ids. */
const INCIDENT_EVENT_ID_DOMAIN = 'opsknight:public-status-event:v1';
const INCIDENT_UPDATE_ID_DOMAIN = 'opsknight:public-status-update:v1';

function publicStatusId(domain: string, ...parts: string[]): string {
  const digest = createHmac('sha256', domain)
    .update(parts.join(':'))
    .digest('hex')
    .slice(0, 32);
  return `evt_${digest}`;
}

export function publicStatusIncidentEventId(pageId: string, incidentId: string): string {
  return publicStatusId(INCIDENT_EVENT_ID_DOMAIN, pageId, incidentId);
}

export function publicStatusIncidentUpdateEventId(
  pageId: string,
  incidentId: string,
  eventId: string
): string {
  return publicStatusId(INCIDENT_UPDATE_ID_DOMAIN, pageId, incidentId, eventId);
}
