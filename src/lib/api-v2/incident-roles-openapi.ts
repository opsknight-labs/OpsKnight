import { INCIDENT_ROLE_KEYS } from '@/lib/incidents/roles';

type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const id: Schema = { type: 'string', minLength: 1 };
const date: Schema = { type: 'string', format: 'date-time' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
export const incidentRoleKeySchema: Schema = { type: 'string', enum: [...INCIDENT_ROLE_KEYS] };
const roleKey = incidentRoleKeySchema;
const holderId: Schema = { type: 'string', minLength: 1, maxLength: 100 };

/** `{ COMMANDER: userId, … }` on incident templates. */
export const incidentTemplateDefaultRoles: Schema = {
  type: 'object',
  additionalProperties: false,
  description: 'Role holders applied to incidents created from this template.',
  properties: Object.fromEntries(INCIDENT_ROLE_KEYS.map(key => [key, holderId])),
};

export const INCIDENT_ROLE_SCHEMAS: Record<string, Schema> = {
  IncidentRole: object({
    incidentId: id,
    roleKey,
    label: string,
    rights: { type: 'string', enum: ['operator', 'contributor'] },
    holder: {
      oneOf: [
        object({ id, name: string, email: string, assignedAt: date }),
        { type: 'null' },
      ],
    },
  }),
  IncidentRoleChange: object({
    incidentId: id,
    roleKey,
    userId: { type: ['string', 'null'] },
    userName: { type: ['string', 'null'] },
    previousUserId: { type: ['string', 'null'] },
    changed: { type: 'boolean' },
  }),
};

export const INCIDENT_ROLE_OPERATIONS: {
  method: 'get' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
}[] = [
  {
    method: 'get',
    path: '/incidents/{id}/roles',
    summary: 'List incident roles and their holders',
    description:
      'Every catalog role (commander, ops lead, comms lead, scribe) in order, with its holder or null.',
  },
  {
    method: 'put',
    path: '/incidents/{id}/roles/{roleKey}',
    summary: 'Assign an incident role',
    description:
      'Requires an Idempotency-Key. Operators may take a role themselves, the commander may hand roles to others, and Responders and Admins may set any role. The holder is added as a follower.',
    body: object({ userId: holderId }),
  },
  {
    method: 'delete',
    path: '/incidents/{id}/roles/{roleKey}',
    summary: 'Clear an incident role',
    description:
      'Requires an Idempotency-Key. Managers, the commander and the current holder may clear a role.',
  },
];
