import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformGitLabToEvent } from '@/lib/integrations/gitlab';
import type { GitLabPayload } from '@/lib/integrations/schemas';

export const POST = createIntegrationRoute<GitLabPayload>('GITLAB', transformGitLabToEvent, {
  signatureProvider: 'gitlab',
});
