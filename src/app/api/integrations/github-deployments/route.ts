import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapGitHubDeploymentChange } from '@/lib/intelligence/changes/deploy-mappers';

/**
 * POST /api/integrations/github-deployments?integrationId=xxx — GitHub deployment_status webhook → DEPLOY
 * change. Verified with X-Hub-Signature-256 when the integration has a signing secret.
 */
export const POST = changeWebhookRoute(mapGitHubDeploymentChange, 'github');
