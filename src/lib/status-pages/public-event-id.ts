import { createHmac } from 'node:crypto';

/** Domain-separated HMAC so feed GUIDs stay stable without disclosing the internal incident id. */
const EVENT_ID_DOMAIN = 'opsknight:public-status-event:v1';

export function publicStatusIncidentEventId(pageId: string, incidentId: string): string {
  const digest = createHmac('sha256', EVENT_ID_DOMAIN)
    .update(`${pageId}:${incidentId}`)
    .digest('hex')
    .slice(0, 32);
  return `evt_${digest}`;
}
