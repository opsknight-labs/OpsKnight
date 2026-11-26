type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const id: Schema = { type: 'string', minLength: 1 };
const date: Schema = { type: 'string', format: 'date-time' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
/** Financial fields are returned only to actors who can manage operations, so they are optional. */
const FINANCIAL_KEYS = [
  'customersTotal',
  'revenuePerHourCents',
  'currency',
  'estimatedCostCents',
  'costCents',
];
const withoutRequired = (schema: Schema, keys = FINANCIAL_KEYS): Schema => ({
  ...schema,
  required: (schema.required as string[]).filter(key => !keys.includes(key)),
});
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

const tier: Schema = {
  type: ['string', 'null'],
  enum: ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3', null],
};
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

const LINK: Schema = object({
  label: { type: 'string', minLength: 1, maxLength: 80 },
  url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2000 },
});

const LIFECYCLE = ['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED'];

const input = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  tier: { type: ['string', 'null'], maxLength: 40 },
  statusPageSummary: { type: ['string', 'null'], maxLength: 500 },
  links: { type: ['array', 'null'], maxItems: 10, items: LINK },
  ownerTeamId: nullableString,
  memberServiceIds: ids(200),
  followerUserIds: ids(500),
  criticality: tier,
  impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
  impactMaxPriority: { type: ['string', 'null'], pattern: '^[Pp][1-9]$' },
  nonCriticalServiceIds: ids(200),
  dependsOnBusinessServiceIds: ids(50),
  sloTarget: { type: ['number', 'null'], minimum: 90, maximum: 99.999 },
  sloWindowDays: { type: 'integer', enum: [7, 30, 90] },
  ownerUserId: nullableString,
  escalationPolicyId: nullableString,
  contactChannel: { type: ['string', 'null'], maxLength: 200 },
  tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 40 } },
  environment: { type: ['string', 'null'], maxLength: 40 },
  lifecycle: { type: 'string', enum: LIFECYCLE },
  lastReviewedAt: nullableDate,
  customAttributes: {
    type: ['object', 'null'],
    maxProperties: 20,
    propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,39}$' },
    additionalProperties: { type: ['string', 'number', 'boolean'] },
  },
  quorumPartialPct: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
  quorumMajorPct: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
  dependencyHopDepth: { type: 'integer', minimum: 1, maximum: 5 },
  customersTotal: { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 },
  revenuePerHourCents: {
    type: ['integer', 'null'],
    minimum: 0,
    maximum: 2_000_000_000,
    description: 'Revenue per hour of full downtime in hundredths of the currency unit.',
  },
  currency: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'ISO 4217, default USD.' },
  customerReportThreshold: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
  customerReportWindowMinutes: { type: ['integer', 'null'], minimum: 5, maximum: 1440 },
  reviewIntervalDays: { type: ['integer', 'null'], minimum: 7, maximum: 730 },
};

/** Why a business service has its status; the worst reason is first. */
const reason: Schema = {
  type: 'object',
  required: ['kind', 'status'],
  properties: {
    kind: {
      type: 'string',
      enum: ['DIRECT', 'DEPENDENCY', 'NESTED', 'MANUAL', 'MAINTENANCE', 'CUSTOMER_REPORTS'],
    },
    status,
    incidentId: string,
    serviceId: string,
    viaServiceId: string,
    childBusinessServiceId: string,
    depth: { type: 'integer' },
    urgency,
    markedById: nullableString,
    maintenanceWindowId: string,
    reportCount: { type: 'integer' },
    threshold: { type: 'integer' },
    windowMinutes: { type: 'integer' },
  },
  additionalProperties: false,
};
const health: Schema = object(
  {
    status,
    since: nullableDate,
    reasons: { type: 'array', items: reason },
    openIncidentCount: { type: 'integer', minimum: 0 },
    memberCount: { type: 'integer', minimum: 0 },
    impactedMemberCount: { type: 'integer', minimum: 0 },
    computedAt: date,
    unknownReason: { type: 'string', enum: ['NO_MEMBERS'] },
  },
  [
    'status',
    'since',
    'reasons',
    'openIncidentCount',
    'memberCount',
    'impactedMemberCount',
    'computedAt',
  ]
);

export const BUSINESS_SERVICE_SCHEMAS: Record<string, Schema> = {
  BusinessService: withoutRequired(
    object({
      id,
      name: string,
      description: nullableString,
      tier: nullableString,
      statusPageSummary: nullableString,
      links: { type: 'array', items: LINK },
      criticality: tier,
      impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
      impactMaxPriority: nullableString,
      ownerTeam: { oneOf: [object({ id, name: string }), { type: 'null' }] },
      sloTarget: { type: ['number', 'null'] },
      sloWindowDays: { type: 'integer', enum: [7, 30, 90] },
      ownerUser: { oneOf: [object({ id, name: string }), { type: 'null' }] },
      escalationPolicy: { oneOf: [object({ id, name: string }), { type: 'null' }] },
      contactChannel: nullableString,
      tags: { type: 'array', items: string },
      environment: nullableString,
      lifecycle: { type: 'string', enum: LIFECYCLE },
      lastReviewedAt: nullableDate,
      customAttributes: { type: ['object', 'null'], additionalProperties: true },
      quorumPartialPct: { type: ['integer', 'null'] },
      quorumMajorPct: { type: ['integer', 'null'] },
      dependencyHopDepth: { type: 'integer', minimum: 1, maximum: 5 },
      customersTotal: { type: ['integer', 'null'] },
      revenuePerHourCents: { type: ['integer', 'null'] },
      currency: string,
      customerReportThreshold: { type: ['integer', 'null'] },
      customerReportWindowMinutes: { type: ['integer', 'null'] },
      reviewIntervalDays: { type: ['integer', 'null'] },
      members: {
        type: 'array',
        items: object({ id, name: string, status: string, critical: { type: 'boolean' } }),
      },
      dependsOn: { type: 'array', items: object({ id, name: string }) },
      followers: { type: 'array', items: object({ id, name: string }) },
      health: { oneOf: [health, { type: 'null' }] },
      createdAt: date,
      updatedAt: date,
    })
  ),
  BusinessServiceIncident: object({
    id,
    title: string,
    urgency,
    source,
    impactStartedAt: date,
    impactEndedAt: nullableDate,
  }),
  BusinessServiceImpactTimeline: withoutRequired(
    object({
      businessServiceId: id,
      window: object({ from: date, to: date }),
      impactMinutes: { type: 'number', minimum: 0 },
      uptimePercent: { type: 'number', minimum: 0, maximum: 100 },
      incidentCount: { type: 'integer', minimum: 0 },
      mttaMinutes: { type: ['number', 'null'] },
      mttrMinutes: { type: ['number', 'null'] },
      weightedDowntimeMinutes: { type: 'number', minimum: 0 },
      weightedUptimePercent: { type: 'number', minimum: 0, maximum: 100 },
      currency: string,
      customersTotal: { type: ['integer', 'null'] },
      estimatedCostCents: {
        type: ['integer', 'null'],
        description: 'Weighted downtime x revenue per hour; null without a revenue rate.',
      },
      entries: {
        type: 'array',
        items: withoutRequired(
          object({
            costCents: {
              type: ['integer', 'null'],
              description:
                'Null when no rate is set, the interval is excluded or the incident is unreadable.',
            },
            incidentId: {
              ...nullableString,
              description: 'Null when the caller cannot read the incident.',
            },
            incidentTitle: nullableString,
            urgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
            source,
            excluded: { type: 'boolean' },
            startedAt: date,
            endedAt: nullableDate,
          })
        ),
      },
    })
  ),
  IncidentBusinessServiceImpactChange: object({
    incidentId: id,
    businessServiceId: id,
    impacted: { type: 'boolean' },
    changed: { type: 'boolean' },
  }),
  BusinessServiceGraph: object({
    businessServiceId: id,
    hops: { type: 'integer', minimum: 1, maximum: 3 },
    truncated: { type: 'boolean' },
    businessServices: {
      type: 'array',
      items: object({
        id,
        name: string,
        criticality: tier,
        status,
        openIncidentCount: { type: 'integer', minimum: 0 },
        memberCount: { type: 'integer', minimum: 0 },
      }),
    },
    services: {
      type: 'array',
      maxItems: 500,
      items: object({
        id,
        name: string,
        teamId: nullableString,
        status,
        openIncidentCount: { type: 'integer', minimum: 0 },
      }),
    },
    dependencies: {
      type: 'array',
      description: 'downstreamServiceId depends on upstreamServiceId.',
      items: object({
        id,
        upstreamServiceId: id,
        downstreamServiceId: id,
        origin: { type: 'string', enum: ['DECLARED', 'OBSERVED'] },
        status: { type: 'string', enum: ['ACTIVE', 'SUGGESTED'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      }),
    },
    members: {
      type: 'array',
      items: object({ businessServiceId: id, serviceId: id, critical: { type: 'boolean' } }),
    },
    supports: {
      type: 'array',
      description: 'childId supports (is depended on by) parentId.',
      items: object({ parentId: id, childId: id }),
    },
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
  // Monthly service reviews
  ServiceReviewSettings: object({
    enabled: { type: 'boolean' },
    freezeWarningEnabled: { type: 'boolean' },
    dayOfMonth: { type: 'integer', minimum: 1, maximum: 28 },
    hour: { type: 'integer', minimum: 0, maximum: 23 },
    timeZone: string,
    summaryUserIds: ids(20),
  }),
  ServiceReviewRun: object({
    period: string,
    kind: { type: 'string', enum: ['DIGEST', 'SUMMARY'] },
    recipientKey: string,
    status: { type: 'string', enum: ['PENDING', 'SENT', 'SKIPPED', 'FAILED'] },
    serviceCount: { type: 'integer' },
    error: nullableString,
    createdAt: date,
  }),
  ServiceReviewRunResult: object(
    {
      period: string,
      sent: { type: 'integer' },
      skipped: { type: 'integer' },
      failed: { type: 'integer' },
      alreadySent: { type: 'integer' },
      disabled: { type: 'boolean' },
      notDue: { type: 'boolean' },
      noEmailProvider: { type: 'boolean' },
    },
    ['period', 'sent', 'skipped', 'failed', 'alreadySent']
  ),
  ServiceReviewPreview: object(
    {
      sent: { type: 'boolean' },
      period: string,
      reason: { type: 'string', enum: ['nothing_to_report'] },
      services: { type: 'integer' },
    },
    ['sent', 'period']
  ),
  StatusPageBusinessServiceOverride: object({
    statusPageId: id,
    businessServiceId: id,
    status: { type: ['string', 'null'], enum: [...OVERRIDE_STATUSES, null] },
    until: { type: ['string', 'null'], format: 'date-time' },
  }),
  BusinessServiceCustomerReport: object(
    {
      id,
      businessServiceId: id,
      source: string,
      count: { type: 'integer', minimum: 1 },
      windowStart: date,
      windowEnd: date,
      externalRef: nullableString,
      createdById: nullableString,
      createdAt: date,
      created: {
        type: 'boolean',
        description: 'False when an existing report with this externalRef was returned.',
      },
    },
    [
      'id',
      'businessServiceId',
      'source',
      'count',
      'windowStart',
      'windowEnd',
      'externalRef',
      'createdById',
      'createdAt',
    ]
  ),
  BusinessServiceTemplate: object({
    id,
    name: string,
    description: nullableString,
    criticality: tier,
    sloTarget: { type: ['number', 'null'] },
    sloWindowDays: { type: 'integer', enum: [7, 30, 90] },
    quorumPartialPct: { type: ['integer', 'null'] },
    quorumMajorPct: { type: ['integer', 'null'] },
    tags: { type: 'array', items: string },
    environment: nullableString,
    lifecycle: { type: 'string', enum: LIFECYCLE },
    links: { type: 'array', items: LINK },
    impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
    impactMaxPriority: nullableString,
    ownerTeamId: nullableString,
    ownerTeam: { oneOf: [object({ id, name: string }), { type: 'null' }] },
    createdAt: date,
    updatedAt: date,
  }),
  BusinessServiceTemplateDeletion: object({ id, deleted: { const: true } }),
  BusinessServiceBulkResult: object({
    dryRun: { type: 'boolean' },
    summary: object({ ok: { type: 'integer' }, failed: { type: 'integer' } }),
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'ok'],
        properties: {
          id,
          ok: { type: 'boolean' },
          changed: { type: 'array', items: string },
          error: string,
        },
        additionalProperties: false,
      },
    },
  }),
  StakeholderNotification: object({
    incidentId: id,
    businessServices: { type: 'array', items: object({ id, name: string }) },
    recipientCount: { type: 'integer' },
    emailCount: { type: 'integer' },
  }),
};

const templateInput = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: ['string', 'null'], maxLength: 2000 },
  criticality: tier,
  sloTarget: { type: ['number', 'null'], minimum: 90, maximum: 99.999 },
  sloWindowDays: { type: 'integer', enum: [7, 30, 90] },
  quorumPartialPct: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
  quorumMajorPct: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
  tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 40 } },
  environment: { type: ['string', 'null'], maxLength: 40 },
  lifecycle: { type: 'string', enum: LIFECYCLE },
  links: { type: ['array', 'null'], maxItems: 10, items: LINK },
  impactMinUrgency: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
  impactMaxPriority: { type: ['string', 'null'], pattern: '^[Pp][1-9]$' },
  ownerTeamId: nullableString,
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
      tier: {
        type: 'string',
        description: 'Comma-separated criticality tiers, e.g. TIER_0,TIER_1.',
      },
      status: {
        type: 'string',
        description: 'Comma-separated health statuses, e.g. MAJOR_OUTAGE.',
      },
      ownerTeamId: { type: 'string' },
      impactedOnly: { type: 'string', enum: ['true', 'false'] },
      attribute: {
        type: 'string',
        maxLength: 241,
        description:
          'Custom attribute filter as key=value, e.g. cost_center=ops. "true", "false" and numbers also match their typed values.',
      },
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
            'Optional, keyed by business service id: displayName (null clears), showOnPage and showMembers. Absent fields stay as they are.',
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
  {
    method: 'get',
    path: '/business-services/{id}/incidents',
    summary: 'List incidents that impacted a business service',
    description:
      'Newest first, from the impact history (direct, dependency, nested and manual). Only incidents the caller can read; unmarked impacts are left out. A reopened incident appears once per impact interval. At most 500.',
    query: windowQuery,
  },
  {
    method: 'get',
    path: '/business-services/{id}/impact-timeline',
    summary: 'Read the impact timeline and uptime of a business service',
    description:
      'Uptime is over the union of impact intervals, so overlapping incidents count once, and covers every interval in the window; the listed entries are the newest 500. Unmarked impacts are listed but excluded from the numbers. Incident id, title and urgency are null for incidents the caller cannot read.',
    query: windowQuery,
  },
  {
    method: 'get',
    path: '/business-services/{id}/graph',
    summary: 'Read the dependency graph around a business service',
    description:
      'Members, supporting and parent business services, and every technical service within hops dependency steps, with live health. At most 500 services; truncated says when more exist. Suggested edges appear only for callers who may read suggestions.',
    query: { hops: { type: 'integer', minimum: 1, maximum: 3, default: 1 } },
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
  {
    method: 'get',
    path: '/settings/service-reviews',
    summary: 'Read the monthly service review settings',
    description: 'Admin only. Reviews are off by default.',
  },
  {
    method: 'put',
    path: '/settings/service-reviews',
    summary: 'Update the monthly service review settings',
    description:
      'Admin only; audited. Send any subset of fields. `summaryUserIds` and `summaryEmails` must name existing active users; services opt in with includeInReview and people with receiveServiceReviews.',
    body: object(
      {
        ...{
          enabled: { type: 'boolean' },
          freezeWarningEnabled: { type: 'boolean' },
          dayOfMonth: { type: 'integer', minimum: 1, maximum: 28 },
          hour: { type: 'integer', minimum: 0, maximum: 23 },
          timeZone: string,
          summaryUserIds: ids(20),
        },
        summaryEmails: { type: 'array', maxItems: 20, items: { type: 'string', format: 'email' } },
      },
      []
    ),
  },
  {
    method: 'get',
    path: '/service-reviews/runs',
    summary: 'List recent service review runs',
    description:
      'Admins see every recipient; responders only rows addressed to themselves. Viewers have no access.',
    query: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  },
  {
    method: 'post',
    path: '/service-reviews/run',
    summary: "Run last month's service review now",
    description:
      'Admin only. Each (period, recipient) is sent once; repeating the call reports alreadySent. Nothing is sent while reviews are disabled.',
    body: object({}),
  },
  {
    method: 'post',
    path: '/service-reviews/preview',
    summary: 'Email yourself a preview of the service review',
    description:
      'Contains only business services the caller can read. Limited to 3 per hour; nothing is recorded as a monthly send.',
    body: object({}),
  },
  {
    method: 'get',
    path: '/business-services/{id}/customer-reports',
    summary: 'List customer-reported impact for a business service',
    description:
      'Newest first, at most 200 (limit, default 50). Requires read access to the business service.',
    query: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  },
  {
    method: 'post',
    path: '/business-services/{id}/customer-reports',
    summary: 'Record customer-reported impact',
    description:
      'Responder or Admin within the business service scope; requires an Idempotency-Key. Idempotent by externalRef: re-posting a reference returns the stored report (200, created false). When the business service sets customerReportThreshold, reports inside its window lift health to degraded.',
    status: 201,
    body: object(
      {
        source: {
          type: 'string',
          pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$',
          description: 'zendesk, intercom, manual, api, ...',
        },
        count: { type: 'integer', minimum: 1, maximum: 1000000 },
        windowStart: date,
        windowEnd: { ...date, description: 'Not in the future; at most 7 days after windowStart.' },
        externalRef: { type: 'string', minLength: 1, maxLength: 200 },
      },
      ['source', 'count', 'windowStart', 'windowEnd']
    ),
  },
  {
    method: 'post',
    path: '/business-services/bulk',
    summary: 'Apply one change to up to 100 business services',
    description:
      'Responder or Admin within scope; requires an Idempotency-Key. Each service succeeds or fails on its own (per-item results) and writes its own audit event. dryRun true validates and reports without writing.',
    body: object(
      {
        ids: ids(100),
        changes: object(
          {
            ownerTeamId: nullableString,
            criticality: tier,
            lifecycle: { type: 'string', enum: LIFECYCLE },
            addTags: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 40 },
            },
            removeTags: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 40 },
            },
            markReviewed: { const: true },
            sloTarget: { type: ['number', 'null'], minimum: 90, maximum: 99.999 },
            sloWindowDays: { type: 'integer', enum: [7, 30, 90] },
          },
          []
        ),
        dryRun: { type: 'boolean', default: false },
      },
      ['ids', 'changes']
    ),
  },
  {
    method: 'get',
    path: '/business-service-templates',
    summary: 'List business service templates',
    description: 'Responder or Admin (the access needed to create business services). At most 200.',
  },
  {
    method: 'post',
    path: '/business-service-templates',
    summary: 'Create a business service template',
    description: 'Responder or Admin; requires an Idempotency-Key.',
    status: 201,
    body: object(templateInput, ['name']),
  },
  {
    method: 'patch',
    path: '/business-service-templates/{id}',
    summary: 'Update a business service template',
    description: 'Responder or Admin; requires an Idempotency-Key. Only the fields sent change.',
    body: object(templateInput, []),
  },
  {
    method: 'delete',
    path: '/business-service-templates/{id}',
    summary: 'Delete a business service template',
    description:
      'Responder or Admin; requires an Idempotency-Key. Business services created from it are unchanged.',
  },
  {
    method: 'post',
    path: '/business-service-templates/{id}/instantiate',
    summary: 'Create a business service from a template',
    description:
      'Responder or Admin; requires an Idempotency-Key. Template defaults apply, and any field in the body overrides them. The template owner team must be visible to the caller.',
    status: 201,
    body: object(input, ['name']),
  },
];
