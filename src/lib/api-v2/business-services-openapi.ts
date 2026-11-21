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
    body: object({ serviceLayout: layout, businessServiceIds: ids(200) }),
  },
];
