import type { V2OperationDefinition } from './openapi-registry';
type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const role = { type: 'string', enum: ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] };
export const USER_ADMINISTRATION_SCHEMAS = {
  UserAdministration: object({
    id: { type: 'string' },
    name: { type: 'string' },
    role,
    roleSource: { type: 'string', enum: ['MANUAL', 'OIDC', 'SCIM'] },
    status: { type: 'string', enum: ['ACTIVE', 'INVITED', 'DISABLED'] },
    revision: { type: 'integer', minimum: 1 },
    deactivatedAt: { type: ['string', 'null'], format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  }),
};
export const USER_ADMINISTRATION_OPERATIONS: Array<{
  method: V2OperationDefinition['method'];
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
}> = [
  {
    method: 'get',
    path: '/users/{id}/administration',
    summary: 'Read administrator-only user lifecycle state',
    description:
      'users:read plus a current active administrator role. Returns a concrete User ETag and safe metadata, excluding email, credentials, invitation capabilities and session token versions.',
  },
  {
    method: 'patch',
    path: '/users/{id}/administration',
    summary: 'Change user role or lifecycle, or revoke sessions',
    description:
      'Explicit users:write plus current active administrator role; admin:manage alone does not grant this new destructive capability. Required Idempotency-Key and concrete User If-Match from the administration read. Every User writer invalidates the revision, including SCIM/OIDC. Shared UI/REST command preserves the last active administrator, prevents self-role-change and self-deactivation, and commits one canonical attributed audit with the mutation and receipt. Role changes explicitly set the source to MANUAL, matching the UI; configured identity-provider mappings may reassert a role on subsequent synchronization. Deactivation revokes API keys, unused invitation/reset tokens, OIDC linking approvals and devices. Reactivation requires DISABLED and returns passwordless users to INVITED; it grants no login approval and restores no credentials. Session revocation increments the session security version and marks registered sessions revoked without revoking API keys. No-op role/deactivation requests have no audit or session side effects. Replay rechecks current administrator authority.',
    body: {
      oneOf: [
        object({ operation: { const: 'set-role', type: 'string' }, role }),
        ...['deactivate', 'reactivate', 'revoke-sessions'].map(operation =>
          object({ operation: { const: operation, type: 'string' } })
        ),
      ],
    },
  },
];
