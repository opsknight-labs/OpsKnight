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
  status?: number;
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

const nullableRevision = { type: ['integer', 'null'], minimum: 1 };
const invitationReview = {
  authenticationMode: { type: 'string', enum: ['PASSWORD', 'SSO'] },
  delivery: { type: 'string', enum: ['EMAIL', 'MANUAL'] },
  expectedPolicyVersion: { type: 'integer', minimum: 1, maximum: 2147483647 },
  expectedOidcConfigVersion: { ...nullableRevision, maximum: 2147483647 },
};
export const USER_INVITATION_SCHEMAS = {
  UserInvitationPolicy: object({
    mode: { type: 'string', enum: ['PASSWORD_ONLY', 'SSO_OPTIONAL', 'SSO_REQUIRED'] },
    policyVersion: { type: 'integer', minimum: 1 },
    passwordInvitationsAllowed: { type: 'boolean' },
    ssoInvitationsAllowed: { type: 'boolean' },
    oidcConfigVersion: nullableRevision,
  }),
  UserInvitation: object({
    userId: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['INVITED'] },
    authenticationMode: invitationReview.authenticationMode,
    invitationGeneration: { type: 'integer', minimum: 1 },
    expiresAt: { type: 'string', format: 'date-time' },
    notificationId: { type: ['string', 'null'] },
    deliveryStatus: { type: 'string', enum: ['QUEUED', 'MANUAL'] },
    inviteUrl: { type: ['string', 'null'], format: 'uri' },
    recipientEmail: { type: 'string', format: 'email' },
    disclosure: { type: 'string', enum: ['DISCLOSED_ONCE', 'ALREADY_DISCLOSED', 'NOT_REQUESTED'] },
  }),
  UserInvitationState: object({
    userId: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['ACTIVE', 'INVITED', 'DISABLED'] },
    invitationGeneration: { type: 'integer', minimum: 0 },
    linkingApprovalRevision: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    authenticationMode: { type: ['string', 'null'], enum: ['PASSWORD', 'SSO', null] },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    delivery: {
      oneOf: [
        object({ notificationId: { type: 'string' }, status: { type: 'string' } }),
        { type: 'null' },
      ],
    },
  }),
};
const invitationDescription =
  'Explicit users:write and a current active administrator. Required Idempotency-Key. Read GET /users/invitation-policy and echo its policyVersion and oidcConfigVersion as expectedPolicyVersion/expectedOidcConfigVersion. Password mode cannot bypass SSO Required or recovery policy. SSO approval binds the exact active issuer/configuration and creates no password token. EMAIL requires a configured provider and returns QUEUED, never a delivery claim or capability URL. MANUAL explicitly discloses a link once; persisted retry receipts strip inviteUrl and return ALREADY_DISCLOSED. Replaying never sends again or rotates a token. If the initial manual response is lost, inspect the invitation and explicitly renew with a new key. Tokens are stored only as hashes; queued content is encrypted. Account, token/approval, canonical attributed audit, notification and receipt commit atomically. Delivery rechecks current status, generation, recipient, policy and SSO approval before transport. A shared 64-active-invitation queue budget bounds pending email work. UI uses the same command and transactional notification endpoint.';
export const USER_INVITATION_OPERATIONS: typeof USER_ADMINISTRATION_OPERATIONS = [
  {
    method: 'get',
    path: '/users/invitation-policy',
    summary: 'Inspect safe invitation policy and active provider versions',
    description:
      'users:read and current active administrator. Returns no provider credentials or recovery capabilities.',
  },
  {
    method: 'post',
    path: '/users/invitations',
    status: 201,
    summary: 'Create an invited user and deliver or disclose its invitation',
    description: invitationDescription,
    body: object({
      ...invitationReview,
      name: { type: 'string', minLength: 1, maxLength: 200 },
      email: { type: 'string', format: 'email', maxLength: 320 },
      role,
    }),
  },
  {
    method: 'get',
    path: '/users/{id}/invitation',
    summary: 'Inspect invitation generation, expiry and safe delivery status',
    description:
      'users:read and current active administrator. Returns the User ETag and an opaque linkingApprovalRevision. No token hashes, bearer URLs, provider credentials or rendered email payloads. The User ETag covers User fields; the separate approval revision covers every approval writer.',
  },
  {
    method: 'post',
    path: '/users/{id}/invitation',
    summary: 'Renew a reviewed pending invitation and invalidate its older generation',
    description: `${invitationDescription} Required concrete User If-Match and expectedLinkingApprovalRevision from the invitation read, including null when absent. This separately fences child approval changes. Only INVITED users can be renewed; active/disabled accounts are not taken over. An explicit mode switch revokes the previous method capability.`,
    body: object({
      ...invitationReview,
      expectedLinkingApprovalRevision: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    }),
  },
];
