import { createIncidentStatusRoute } from '@/lib/incidents/status-http';

/** Canonical browser/PWA incident lifecycle transport. */
export const PATCH = createIncidentStatusRoute('WEB', 'api/incidents/[id]/status');
export const POST = PATCH;
