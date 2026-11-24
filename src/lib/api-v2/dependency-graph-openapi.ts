/** OpenAPI schemas and operation descriptions for /dependency-graph (insights, views, edge stats). */
type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const id: Schema = { type: 'string', minLength: 1 };
const date: Schema = { type: 'string', format: 'date-time' };
const int: Schema = { type: 'integer', minimum: 0 };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: Schema, maxItems = 500): Schema => ({ type: 'array', items, maxItems });
const status: Schema = {
  type: 'string',
  enum: ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE', 'UNKNOWN'],
};
const origin: Schema = { type: 'string', enum: ['DECLARED', 'OBSERVED'] };
const edgeRef = object({
  upstreamServiceId: id,
  downstreamServiceId: id,
  upstreamName: nullableString,
  downstreamName: nullableString,
  origin,
  since: date,
});
const statusChange = object({ id, name: nullableString, from: status, to: status });
const visibility: Schema = { type: 'string', enum: ['PRIVATE', 'TEAM', 'ORG'] };
const viewConfig: Schema = object(
  {
    focus: nullableString,
    hops: { type: 'integer', minimum: 1, maximum: 3 },
    filters: { type: 'object', additionalProperties: true },
    mode: string,
    pinned: array(
      object({ id, x: { type: 'number' }, y: { type: 'number' } }),
      200
    ),
  },
  []
);
const viewInput = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  visibility,
  teamId: nullableString,
  config: viewConfig,
};

export const DEPENDENCY_GRAPH_SCHEMAS: Record<string, Schema> = {
  DependencyGraphAt: object({
    at: date,
    truncated: { type: 'boolean' },
    services: array(object({ id, name: string, teamId: nullableString, status, openIncidentCount: int })),
    businessServices: array(
      object({ id, name: string, criticality: nullableString, status, openIncidentCount: int })
    ),
    dependencies: array(
      object({
        upstreamServiceId: id,
        downstreamServiceId: id,
        state: { type: 'string', enum: ['ACTIVE', 'SUGGESTED'] },
        origin,
        since: date,
      }),
      5000
    ),
    members: array(object({ businessServiceId: id, serviceId: id, critical: { type: 'boolean' } }), 5000),
    supports: array(object({ parentId: id, childId: id })),
    notes: array(string, 10),
  }),
  DependencyGraphDiff: object({
    since: date,
    until: date,
    truncated: { type: 'boolean' },
    addedDependencies: array(edgeRef, 100),
    removedDependencies: array(edgeRef, 100),
    newlySuggestedDependencies: array(edgeRef, 100),
    awaitingReview: object({ count: int, items: array(edgeRef, 100) }),
    serviceStatusChanges: array(statusChange, 100),
    businessServiceStatusChanges: array(statusChange, 100),
  }),
  DependencyGraphSpof: object({
    threshold: int,
    truncated: { type: 'boolean' },
    singlePointsOfFailure: array(
      object({
        serviceId: id,
        name: string,
        fanOut: int,
        businessServiceCount: int,
        criticalBusinessServiceCount: int,
        articulationPoint: { type: 'boolean' },
        reasons: array({ type: 'string', enum: ['NO_OWNER_TEAM', 'NO_ON_CALL'] }, 2),
        score: int,
      }),
      100
    ),
    articulationPoints: array(object({ serviceId: id, name: nullableString, fanOut: int }), 100),
  }),
  DependencyGraphSimulation: object({
    seeds: array(object({ id, name: string }), 20),
    maxDepth: int,
    truncated: { type: 'boolean' },
    affectedServices: array(object({ id, name: string, distance: int }), 500),
    possiblyDegradedServices: array(object({ id, name: string, distance: int }), 500),
    affectedBusinessServices: array(
      object({
        id,
        name: string,
        criticality: nullableString,
        currentStatus: status,
        projectedStatus: status,
      })
    ),
    exposure: object({
      note: string,
      revenuePerHourCents: { type: ['integer', 'null'] },
      customers: { type: ['integer', 'null'] },
    }),
  }),
  DependencyGraphView: object({
    id,
    name: string,
    ownerId: id,
    teamId: nullableString,
    visibility,
    config: { type: 'object', additionalProperties: true },
    shared: { type: 'boolean' },
    shareExpiresAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: date,
    updatedAt: date,
  }),
  DependencyGraphViewShare: object({ token: string, expiresAt: date }),
  DependencyGraphEdgeStatsResult: object({
    accepted: int,
    rejected: array(object({ index: int, reason: string }), 200),
  }),
};

const focusQuery: Record<string, Schema> = {
  focus: { type: 'string', description: 'svc:<id> or bs:<id>. Omit for the whole readable graph.' },
  hops: { type: 'integer', minimum: 1, maximum: 3, default: 2 },
};

export const DEPENDENCY_GRAPH_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  query?: Record<string, Schema>;
  body?: Schema;
  status?: number;
}[] = [
  {
    method: 'get',
    path: '/dependency-graph/at',
    summary: 'Read the dependency graph as it was at a past moment',
    description:
      'Replays dependency edges from history and recomputes service and business-service status at that time. Only what the caller can read; suggested edges only for callers who may read suggestions. Membership and nesting are current.',
    query: { at: { type: 'string', format: 'date-time' }, ...focusQuery },
  },
  {
    method: 'get',
    path: '/dependency-graph/diff',
    summary: 'Read what changed in the dependency graph since a past time',
    description:
      'Added and removed dependencies, new suggestions awaiting review, and status changes. since must be in the past and at most 400 days ago.',
    query: { since: { type: 'string', format: 'date-time' }, ...focusQuery },
  },
  {
    method: 'get',
    path: '/dependency-graph/spof',
    summary: 'List single points of failure',
    description:
      'Services whose transitive dependents reach the threshold and that have no owner team or no on-call, ranked, plus articulation points. Counted over what the caller can read.',
    query: { threshold: { type: 'integer', minimum: 1, maximum: 200, default: 5 }, ...focusQuery },
  },
  {
    method: 'get',
    path: '/dependency-graph/simulate',
    summary: 'Simulate services failing (GET form) and project the impact',
    description: 'Read-only. serviceIds is a comma-separated list of up to 20 ids.',
    query: {
      serviceIds: { type: 'string', description: 'Comma-separated service ids.' },
      maxDepth: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    },
  },
  {
    method: 'post',
    path: '/dependency-graph/simulate',
    summary: 'Simulate services failing and project the impact',
    description:
      'Read-only. Returns downstream services by distance and each business service projected status using the real health rules. Up to 20 services.',
    body: object(
      {
        serviceIds: array(id, 20),
        maxDepth: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      ['serviceIds']
    ),
  },
  {
    method: 'get',
    path: '/dependency-graph/views',
    summary: 'List saved dependency graph views the caller can see',
  },
  {
    method: 'post',
    path: '/dependency-graph/views',
    summary: 'Save a dependency graph view',
    description:
      'Requires an Idempotency-Key. TEAM views need a team the caller belongs to; ORG views need Responder or Admin.',
    status: 201,
    body: object(viewInput, ['name', 'config']),
  },
  { method: 'get', path: '/dependency-graph/views/{id}', summary: 'Read a saved dependency graph view' },
  {
    method: 'patch',
    path: '/dependency-graph/views/{id}',
    summary: 'Update a saved dependency graph view',
    description: 'Owner or Admin. Requires an Idempotency-Key.',
    body: object(viewInput, []),
  },
  {
    method: 'delete',
    path: '/dependency-graph/views/{id}',
    summary: 'Delete a saved dependency graph view',
    description: 'Owner or Admin. Also ends its embed token. Requires an Idempotency-Key.',
  },
  {
    method: 'post',
    path: '/dependency-graph/views/{id}/share',
    summary: 'Create a read-only embed token for a saved view',
    description:
      'Admin only, and only while the graphEmbed.enabled setting is on (off by default). The token is returned once; the embed at /api/graph-embed/{token} is anonymized.',
    status: 201,
    body: object({ expiresInDays: { type: 'integer', minimum: 1, maximum: 90, default: 30 } }, []),
  },
  {
    method: 'delete',
    path: '/dependency-graph/views/{id}/share',
    summary: 'Revoke the embed token of a saved view',
    description: 'Owner or Admin. Requires an Idempotency-Key.',
  },
  {
    method: 'post',
    path: '/dependency-graph/edge-stats',
    summary: 'Ingest measured request and error counts per dependency edge',
    description:
      'Up to 200 windows per call, idempotent per edge, source and window start. Requires services:write; only active edges between services the key can read are accepted.',
    body: object({
      source: { type: 'string', minLength: 1, maxLength: 64 },
      stats: array(
        object({
          upstreamServiceId: id,
          downstreamServiceId: id,
          windowStart: date,
          windowSeconds: { type: 'integer', minimum: 10, maximum: 86400 },
          requestCount: int,
          errorCount: int,
        }),
        200
      ),
    }),
  },
];
