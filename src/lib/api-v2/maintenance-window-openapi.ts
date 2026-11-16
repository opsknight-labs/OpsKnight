type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const date: Schema = { type: 'string', format: 'date-time' };
const nullableDate: Schema = { type: ['string', 'null'], format: 'date-time' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });

const endBehavior: Schema = { type: 'string', enum: ['RESUME_FIRING', 'RESOLVE_HELD'] };
const inputProperties = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  serviceIds: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 64 },
    minItems: 1,
    maxItems: 200,
  },
  startsAt: date,
  endsAt: date,
  endBehavior: { ...endBehavior, default: 'RESUME_FIRING' },
  publishToStatusPage: { type: 'boolean', default: false },
};

export const MAINTENANCE_WINDOW_SCHEMAS: Record<string, Schema> = {
  MaintenanceWindow: object({
    id: string,
    revision: { type: 'integer', minimum: 0 },
    title: string,
    description: { type: ['string', 'null'] },
    startsAt: date,
    endsAt: date,
    endBehavior,
    publishToStatusPage: { type: 'boolean' },
    phase: { type: 'string', enum: ['UPCOMING', 'ACTIVE', 'ENDED'] },
    serviceIds: { type: 'array', items: string },
    heldIncidentCount: { type: 'integer', minimum: 0 },
    endProcessedAt: nullableDate,
    createdAt: date,
    updatedAt: date,
  }),
};

export const MAINTENANCE_WINDOW_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
  query?: Record<string, Schema>;
}[] = [
  {
    method: 'get',
    path: '/maintenance-windows',
    summary: 'List maintenance windows touching services the caller can read',
    paginated: true,
    query: {
      serviceId: { type: 'string', minLength: 1, maxLength: 64 },
      phase: { type: 'string', enum: ['UPCOMING', 'ACTIVE', 'ENDED'] },
    },
  },
  {
    method: 'post',
    path: '/maintenance-windows',
    summary: 'Schedule a maintenance window that holds new incidents on its services',
    status: 201,
    body: object(inputProperties, ['title', 'serviceIds', 'startsAt', 'endsAt']),
    description:
      'Requires an Idempotency-Key. Non-admin callers must belong to the owning team of every listed service. Windows last at most 7 days and cannot start in the past.',
  },
  {
    method: 'get',
    path: '/maintenance-windows/{id}',
    summary: 'Read a maintenance window with a strong ETag',
  },
  {
    method: 'patch',
    path: '/maintenance-windows/{id}',
    summary: 'Change an upcoming or active maintenance window using a concrete revision',
    body: { ...object(inputProperties, []), minProperties: 1 },
    description:
      'Requires If-Match and an Idempotency-Key. Ended windows cannot change, and the start of an active window is fixed. Non-admin callers must belong to the owning team of every current and requested service.',
  },
  {
    method: 'delete',
    path: '/maintenance-windows/{id}',
    summary: 'Delete an upcoming maintenance window',
    status: 204,
    description: 'Active windows must be ended instead; ended windows are retained as history.',
  },
  {
    method: 'post',
    path: '/maintenance-windows/{id}/end',
    summary: 'End an active maintenance window now and release its held incidents',
    body: object({}),
    description:
      'Ending an already-ended window returns it unchanged. Held incidents are released according to endBehavior; the scheduler retries any release that fails.',
  },
];
