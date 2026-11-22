type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const id: Schema = { type: 'string', minLength: 1 };
const date: Schema = { type: 'string', format: 'date-time' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const ids = (maxItems: number): Schema => ({
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength: 100 },
  maxItems,
});
const layout: Schema = { type: 'string', enum: ['FLAT', 'BUSINESS', 'BUSINESS_EXPANDABLE'] };

const tier: Schema = { type: ['string', 'null'], enum: ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3', null] };
const urgency: Schema = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] };
const status: Schema = {
  type: 'string',
  enum: ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE', 'UNKNOWN'],
};
const source: Schema = { type: 'string', enum: ['DIRECT', 'DEPENDENCY', 'NESTED', 'MANUAL'] };
const nullableDate: Schema = { type: ['string', 'null'], format: 'date-time' };
const windowQuery: Record<string, Schema> = {
  from: { type: 'string', format: 'date-time', description: 'Default: 30 days before to.' },
  to: { type: 'string', format: 'date-time', description: 'Default: now. At most 400 days wide.' },
};

const input = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  tier: { type: ['string', 'null'], maxLength: 40 },
  ownerTeamId: nullableString,
  memberServiceIds: ids(200),
  followerUserIds: ids(500),
  criticality: tier,
  impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
  impactMaxPriority: { type: ['string', 'null'], pattern: '^[Pp][1-9]$' },
  nonCriticalServiceIds: ids(200),
  dependsOnBusinessServiceIds: ids(50),
};

/** Why a business service has its status; the worst reason is first. */
const reason: Schema = {
  type: 'object',
  required: ['kind', 'status'],
  properties: {
    kind: { type: 'string', enum: ['DIRECT', 'DEPENDENCY', 'NESTED', 'MANUAL', 'MAINTENANCE'] },
    status,
    incidentId: string,
    serviceId: string,
    viaServiceId: string,
    childBusinessServiceId: string,
    depth: { type: 'integer' },
    urgency,
    markedById: nullableString,
    maintenanceWindowId: string,
  },
  additionalProperties: false,
};
const health: Schema = object({
  status,
  since: nullableDate,
  reasons: { type: 'array', items: reason },
  openIncidentCount: { type: 'integer', minimum: 0 },
  memberCount: { type: 'integer', minimum: 0 },
  impactedMemberCount: { type: 'integer', minimum: 0 },
  computedAt: date,
});

export const BUSINESS_SERVICE_SCHEMAS: Record<string, Schema> = {
  BusinessService: object({
    id,
    name: string,
    description: nullableString,
    tier: nullableString,
    criticality: tier,
    impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
    impactMaxPriority: nullableString,
    ownerTeam: { oneOf: [object({ id, name: string }), { type: 'null' }] },
    members: {
      type: 'array',
      items: object({ id, name: string, status: string, critical: { type: 'boolean' } }),
    },
    dependsOn: { type: 'array', items: object({ id, name: string }) },
    followers: { type: 'array', items: object({ id, name: string }) },
    health: { oneOf: [health, { type: 'null' }] },
    createdAt: date,
    updatedAt: date,
  }),
  BusinessServiceIncident: object({
    id,
    title: string,
    urgency,
    source,
    impactStartedAt: date,
    impactEndedAt: nullableDate,
  }),
  BusinessServiceImpactTimeline: object({
    businessServiceId: id,
    window: object({ from: date, to: date }),
    impactMinutes: { type: 'number', minimum: 0 },
    uptimePercent: { type: 'number', minimum: 0, maximum: 100 },
    incidentCount: { type: 'integer', minimum: 0 },
    mttaMinutes: { type: ['number', 'null'] },
    mttrMinutes: { type: ['number', 'null'] },
    entries: {
      type: 'array',
      items: object({
        incidentId: id,
        incidentTitle: string,
        urgency,
        source,
        excluded: { type: 'boolean' },
        startedAt: date,
        endedAt: nullableDate,
      }),
    },
  }),
  IncidentBusinessServiceImpactChange: object({
    incidentId: id,
    businessServiceId: id,
    impacted: { type: 'boolean' },
    changed: { type: 'boolean' },
  }),
  BusinessServiceDeletion: object({ id, deleted: { const: true } }),
  StatusPageBusinessServices: object({
    statusPageId: id,
    serviceLayout: layout,
    businessServices: {
      type: 'array',
      items: object({
        businessServiceId: id,
        name: string,
        order: { type: 'integer' },
        showOnPage: { type: 'boolean' },
      }),
    },
  }),
};

export const BUSINESS_SERVICE_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  query?: Record<string, Schema>;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}[] = [
  {
    method: 'get',
    path: '/business-services',
    summary: 'List business services the caller can see',
    description:
      'Org-wide readers see every business service; others see those owned by, or containing services of, their teams. Each item carries engine health (status, reasons, open incident count).',
    paginated: true,
    query: {
      q: { type: 'string', maxLength: 120, description: 'Matches name or description.' },
      tier: { type: 'string', description: 'Comma-separated criticality tiers, e.g. TIER_0,TIER_1.' },
      status: { type: 'string', description: 'Comma-separated health statuses, e.g. MAJOR_OUTAGE.' },
      ownerTeamId: { type: 'string' },
      impactedOnly: { type: 'string', enum: ['true', 'false'] },
      sort: { type: 'string', enum: ['newest', 'name'], default: 'newest' },
    },
  },
  {
    method: 'post',
    path: '/business-services',
    summary: 'Create a business service',
    description: 'Requires an Idempotency-Key and Responder or Admin access.',
    status: 201,
    body: object(input, ['name']),
  },
  {
    method: 'get',
    path: '/business-services/{id}',
    summary: 'Read a business service with its current health',
  },
  {
    method: 'patch',
    path: '/business-services/{id}',
    summary: 'Update a business service',
    description:
      'Requires an Idempotency-Key. memberServiceIds and followerUserIds replace the whole set when present; status pages showing it also publish new members.',
    body: object(input, []),
  },
  {
    method: 'delete',
    path: '/business-services/{id}',
    summary: 'Delete a business service',
    description: 'Admins only. Technical services are not changed.',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/business-services',
    summary: 'Read the status page service layout and its business services',
  },
  {
    method: 'put',
    path: '/status-pages/{id}/business-services',
    summary: 'Set the status page service layout and ordered business services',
    description:
      'Requires If-Match and an Idempotency-Key. Member services are published with their business service; removing one withdraws the page before republishing.',
    body: object(
      {
        serviceLayout: layout,
        businessServiceIds: ids(200),
        businessServiceConfigs: {
          type: 'object',
          description:
            'Optional, keyed by business service id: displayName (null clears) and showOnPage. Absent fields stay as they are.',
          additionalProperties: object(
            { displayName: { type: ['string', 'null'], maxLength: 200 }, showOnPage: { type: 'boolean' } },
            []
          ),
        },
      },
      ['serviceLayout', 'businessServiceIds']
    ),
  },
  {
    method: 'get',
    path: '/business-services/{id}/incidents',
    summary: 'List incidents that impacted a business service',
    description:
      'Newest first, from the impact history (direct, dependency, nested and manual). Unmarked impacts are left out. At most 500.',
    query: windowQuery,
  },
  {
    method: 'get',
    path: '/business-services/{id}/impact-timeline',
    summary: 'Read the impact timeline and uptime of a business service',
    description:
      'Uptime is over the union of impact intervals, so overlapping incidents count once. Unmarked impacts are listed but excluded from the numbers.',
    query: windowQuery,
  },
  {
    method: 'put',
    path: '/incidents/{id}/business-service-impacts/{businessServiceId}',
    summary: 'Mark an incident as impacting a business service',
    description:
      'Requires an Idempotency-Key and Responder or Admin access. A manual mark counts even below the business service threshold.',
  },
  {
    method: 'delete',
    path: '/incidents/{id}/business-service-impacts/{businessServiceId}',
    summary: 'Unmark an incident as impacting a business service',
    description:
      'Requires an Idempotency-Key. The exclusion is remembered so automatic impact never re-adds it.',
  },
];
