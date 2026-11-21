import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapArgoCdChange } from '@/lib/intelligence/changes/mappers';

/** POST /api/integrations/argocd?integrationId=xxx — Argo CD notification webhook → DEPLOY change. */
export const POST = changeWebhookRoute(mapArgoCdChange);
