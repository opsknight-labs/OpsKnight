import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapLaunchDarklyChange } from '@/lib/intelligence/changes/mappers';

/** POST /api/integrations/launchdarkly?integrationId=xxx — LaunchDarkly webhook → FEATURE_FLAG change. */
export const POST = changeWebhookRoute(mapLaunchDarklyChange);
