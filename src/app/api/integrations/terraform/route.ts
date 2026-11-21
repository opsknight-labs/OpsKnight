import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapTerraformChange } from '@/lib/intelligence/changes/mappers';

/** POST /api/integrations/terraform?integrationId=xxx — HCP Terraform run notification → INFRA change. */
export const POST = changeWebhookRoute(mapTerraformChange);
