import { changeWebhookRoute } from '@/lib/intelligence/changes/webhook-route';
import { mapGitLabDeploymentChange } from '@/lib/intelligence/changes/deploy-mappers';

/**
 * POST /api/integrations/gitlab-deployments?integrationId=xxx — GitLab deployment event → DEPLOY change.
 * Verified with X-Gitlab-Token when the integration has a signing secret.
 */
export const POST = changeWebhookRoute(mapGitLabDeploymentChange, 'gitlab');
