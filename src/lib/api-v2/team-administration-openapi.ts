import type { V2OperationDefinition } from './openapi-registry';
type Schema = Record<string, unknown>;
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const revision = { type: 'integer', minimum: 1 };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', additionalProperties: false, properties, required });
const role = { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] };
const membership = object({
  id: text,
  teamId: text,
  userId: text,
  role,
  receiveTeamNotifications: { type: 'boolean' },
  createdAt: { type: 'string', format: 'date-time' },
});
export const TEAM_ADMINISTRATION_SCHEMAS: Record<string, Schema> = {
  TeamMembership: membership,
  TeamMembershipChange: object({
    teamId: text,
    userId: text,
    revision,
    membership: { oneOf: [{ $ref: '#/components/schemas/TeamMembership' }, { type: 'null' }] },
  }),
  TeamLead: object({ teamId: text, teamLeadId: nullableText, revision }),
  TeamLeadChange: object({
    teamId: text,
    userId: nullableText,
    teamLeadId: nullableText,
    revision,
  }),
};
const description =
  'teams:write plus administrator or current team owner. SCIM-managed teams reject manual changes. Required Idempotency-Key and concrete parent Team If-Match. Membership changes by UI, SCIM and older writers invalidate this revision. Last active owner and active-member lead rules are checked transactionally. No-op writes do not audit or increment revisions. Replay rechecks current authority. Membership and role changes invalidate existing sessions. Responses exclude user credentials and email addresses.';
export const TEAM_ADMINISTRATION_OPERATIONS: Array<{
  method: V2OperationDefinition['method'];
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  paginated?: boolean;
}> = [
  {
    method: 'get',
    path: '/teams/{id}/members',
    summary: 'List team memberships',
    paginated: true,
    description:
      'teams:read with organization directory-read permission or membership in this team. Bounded keyset pagination; cursors must belong to the same team. Returns the parent Team ETag.',
  },
  {
    method: 'put',
    path: '/teams/{id}/members/{userId}',
    summary: 'Add or update a team member',
    description,
    body: object({ role, receiveTeamNotifications: { type: 'boolean' } }, ['role']),
  },
  {
    method: 'delete',
    path: '/teams/{id}/members/{userId}',
    summary: 'Remove a team member and revoke sessions',
    description,
  },
  { method: 'get', path: '/teams/{id}/lead', summary: 'Read the team lead and revision' },
  {
    method: 'put',
    path: '/teams/{id}/lead',
    summary: 'Designate or clear the team lead',
    description,
    body: object({ userId: nullableText }),
  },
];
