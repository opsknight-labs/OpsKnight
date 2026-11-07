import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapUnleashChange } from '@/lib/intelligence/changes/mappers';

/** POST /api/integrations/unleash?integrationId=xxx — Unleash webhook addon → FEATURE_FLAG change. */
export const POST = changeWebhookRoute(mapUnleashChange);
