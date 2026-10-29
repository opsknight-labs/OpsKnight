import type { McpClient, McpPolicy } from '@prisma/client';
import { isCimdHostAllowed } from './cimd';

export const DEFAULT_ASSISTANT_SCOPES = ['incidents:read', 'services:read', 'schedules:read'];

export function effectiveMcpClientScopes(
  client: Pick<McpClient, 'metadataUrl' | 'scopes' | 'dynamicRegistration' | 'revokedAt'>,
  policy: McpPolicy | null
): string[] | null {
  if (client.revokedAt) return null;
  if (client.dynamicRegistration) {
    if (!policy?.dcrEnabled || client.metadataUrl) return null;
    return client.scopes.filter(scope => policy.dcrScopes.includes(scope));
  }
  if (client.metadataUrl) {
    if (!policy || !isCimdHostAllowed(policy, new URL(client.metadataUrl).hostname)) return null;
    return client.scopes.filter(scope => policy.cimdScopes.includes(scope));
  }
  return client.scopes;
}
