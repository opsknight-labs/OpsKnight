import { createIncidentStatusRoute } from '@/lib/incidents/status-http';

/**
 * Backward-compatible transport for installed/older PWA clients.
 * New clients use /api/incidents/:id/status; both routes share one HTTP/domain contract.
 */
export const PATCH = createIncidentStatusRoute('MOBILE', 'api.mobile.incident.status');
export const POST = PATCH;
