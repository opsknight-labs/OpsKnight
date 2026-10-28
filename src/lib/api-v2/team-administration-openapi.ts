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
const membershipProperties = {
  id: text,
  teamId: text,
  userId: text,
  role,
  receiveTeamNotifications: { type: 'boolean' },
  createdAt: { type: 'string', format: 'date-time' },
};
const membership = object(membershipProperties);
export const TEAM_ADMINISTRATION_SCHEMAS: Record<string, Schema> = {
  TeamManagedService: object({
    id: text,
    name: text,
    teamId: { type: ['string', 'null'] },
    revision,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  }),
  TeamActivity: object({
    id: text,
    action: text,
    createdAt: { type: 'string', format: 'date-time' },
    actor: { oneOf: [object({ id: text, name: { type: ['string', 'null'] } }), { type: 'null' }] },
    details: {},
  }),
  TeamMembership: membership,
  TeamMembershipItem: object({ ...membershipProperties, revision }),
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
    path: '/teams/{id}/activity',
    summary: 'Read bounded team administrative activity',
    paginated: true,
    description:
      'teams:read and administrator or current team-owner permission. Same event selection and projection as the UI. Includes canonical Team and TeamMember history with bounded, redacted details and actor IDs/names; no actor emails, IP addresses or raw audit metadata. Cursors must belong to this team.',
  },
  {
    method: 'get',
    path: '/teams/{id}/services',
    summary: 'List services currently managed by the team',
    paginated: true,
  },
  {
    method: 'put',
    path: '/teams/{id}/services/{serviceId}',
    summary: 'Assign a service to a team',
    body: object({}),
    description:
      'teams:write plus current administrator or team owner. Required Idempotency-Key and concrete Service If-Match, obtained from GET /services/{serviceId} or the revision in listTeamServices. The validator is for the Service, not the Team. Owners can claim unassigned services or retain existing assignments; only administrators can move services between teams. Shared UI/REST command joins the Automation service lock. Concurrent destination changes, canonical audit and receipt are transactional. No-op assignments do not churn revisions or audits. Replay rechecks current team authority and current service ownership.',
  },
  {
    method: 'get',
    path: '/teams/{id}/members',
    summary: 'List team memberships',
    paginated: true,
    description:
      'teams:read with organization directory-read permission or membership in this team. Bounded keyset pagination; cursors must belong to the same team. Returns the parent Team ETag.',
  },
  {
    method: 'get',
    path: '/teams/{id}/members/{userId}',
    summary: 'Read one team membership and the team revision',
    description:
      'Same authority as listTeamMembers: teams:read with organization directory-read permission or membership in this team. Returns 404 when the team or membership does not exist. The ETag is the parent Team revision used by If-Match on membership changes.',
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
