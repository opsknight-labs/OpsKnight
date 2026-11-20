import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapKubernetesRolloutChange } from '@/lib/intelligence/changes/deploy-mappers';

/**
 * POST /api/integrations/kubernetes-rollouts?integrationId=xxx — a forwarded Kubernetes Event about an Argo
 * Rollouts Rollout (kubernetes-event-exporter or similar) → DEPLOY change. Generic HMAC like the other
 * change endpoints.
 */
export const POST = changeWebhookRoute(mapKubernetesRolloutChange);
