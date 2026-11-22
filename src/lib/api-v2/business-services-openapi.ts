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
const OVERRIDE_STATUSES = [
  'OPERATIONAL',
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
  'MAINTENANCE',
];
const layout: Schema = { type: 'string', enum: ['FLAT', 'BUSINESS', 'BUSINESS_EXPANDABLE'] };

const input = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  tier: { type: ['string', 'null'], maxLength: 40 },
  ownerTeamId: nullableString,
  memberServiceIds: ids(200),
  followerUserIds: ids(500),
};

export const BUSINESS_SERVICE_SCHEMAS: Record<string, Schema> = {
  BusinessService: object({
    id,
    name: string,
    description: nullableString,
    tier: nullableString,
    ownerTeam: { oneOf: [object({ id, name: string }), { type: 'null' }] },
    members: { type: 'array', items: object({ id, name: string, status: string }) },
    followers: { type: 'array', items: object({ id, name: string }) },
    createdAt: date,
    updatedAt: date,
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
        displayName: nullableString,
        order: { type: 'integer' },
        showOnPage: { type: 'boolean' },
        showMembers: { type: 'boolean' },
        statusOverride: { type: ['string', 'null'], enum: [...OVERRIDE_STATUSES, null] },
        statusOverrideUntil: { type: ['string', 'null'], format: 'date-time' },
      }),
    },
  }),
  // P4
  BusinessServiceSupporting: object({
    businessServiceId: id,
    supportingBusinessServiceIds: ids(100),
  }),
  BusinessServiceImportResult: object({
    applied: { type: 'boolean' },
    summary: object({
      create: { type: 'integer' },
      update: { type: 'integer' },
      unchanged: { type: 'integer' },
      invalid: { type: 'integer' },
    }),
    changes: {
      type: 'array',
      items: object({
        line: { type: 'integer' },
        name: string,
        action: { type: 'string', enum: ['create', 'update', 'unchanged'] },
        fields: { type: 'array', items: string },
        membersAdded: { type: 'array', items: string },
        membersRemoved: { type: 'array', items: string },
      }),
    },
    issues: {
      type: 'array',
      items: object({ line: { type: 'integer' }, name: string, message: string }, [
        'line',
        'message',
      ]),
    },
  }),
  StatusPageBusinessServiceOverride: object({
    statusPageId: id,
    businessServiceId: id,
    status: { type: ['string', 'null'], enum: [...OVERRIDE_STATUSES, null] },
    until: { type: ['string', 'null'], format: 'date-time' },
  }),
  StakeholderNotification: object({
    incidentId: id,
    businessServices: { type: 'array', items: object({ id, name: string }) },
    recipientCount: { type: 'integer' },
    emailCount: { type: 'integer' },
  }),
};

export const BUSINESS_SERVICE_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}[] = [
  {
    method: 'get',
    path: '/business-services',
    summary: 'List business services the caller can see',
    description:
      'Org-wide readers see every business service; others see those owned by, or containing services of, their teams.',
    paginated: true,
  },
  {
    method: 'post',
    path: '/business-services',
    summary: 'Create a business service',
    description: 'Requires an Idempotency-Key and Responder or Admin access.',
    status: 201,
    body: object(input, ['name']),
  },
  { method: 'get', path: '/business-services/{id}', summary: 'Read a business service' },
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
            'Per business service id: display name, page visibility and member visibility.',
          additionalProperties: object(
            {
              displayName: { type: ['string', 'null'], maxLength: 200 },
              showOnPage: { type: 'boolean' },
              showMembers: { type: 'boolean' },
            },
            []
          ),
        },
      },
      ['serviceLayout', 'businessServiceIds']
    ),
  },
  // P4: nesting, import, status-page overrides, stakeholder updates.
  {
    method: 'put',
    path: '/business-services/{id}/supporting',
    summary: 'Set the business services this one depends on',
    description:
      'Replaces the set. Responder or Admin. Rejected with VALIDATION_FAILED when an added dependency would create a cycle.',
    body: object({ businessServiceIds: ids(100) }),
  },
  {
    method: 'post',
    path: '/business-services/import',
    summary: 'Import business services from CSV, YAML or a Backstage catalog',
    description:
      'At most 1000 business services and 2 MB. Pass ?dryRun=true for the diff only. A real run applies every row in one transaction, or nothing when any row has an issue. Rows match existing business services by name; blank fields are left unchanged.',
    body: object({
      format: { type: 'string', enum: ['csv', 'yaml', 'backstage'] },
      content: { type: 'string', minLength: 1, maxLength: 2 * 1024 * 1024 },
    }),
  },
  {
    method: 'put',
    path: '/status-pages/{id}/business-services/{businessServiceId}/override',
    summary: 'Pin or clear a business service status on a status page',
    description:
      'A component-group override shown instead of the computed status until `until` (default and maximum 30 days ahead). `status: null` clears it. Applies immediately and is audited.',
    body: object(
      {
        status: { type: ['string', 'null'], enum: [...OVERRIDE_STATUSES, null] },
        until: { type: ['string', 'null'], format: 'date-time' },
      },
      ['status']
    ),
  },
  {
    method: 'post',
    path: '/incidents/{id}/stakeholder-notify',
    summary: 'Send a stakeholder update for an incident',
    description:
      'Email and in-app update to followers and subscribed teams of the business services the incident impacts. Never pages. At most 3 per incident every 10 minutes. Requires note access to the incident.',
    body: object(
      {
        phase: { type: 'string', enum: ['investigating', 'identified', 'monitoring', 'resolved'] },
        message: { type: 'string', minLength: 1, maxLength: 2000 },
        businessServiceIds: ids(100),
      },
      ['phase', 'message']
    ),
  },
];
