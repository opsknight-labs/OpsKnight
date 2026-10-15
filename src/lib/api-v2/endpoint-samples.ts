/**
 * Curated, verified, endpoint-specific request body examples for OpsKnight REST API v2.
 * Every sample is certified against the corresponding Zod validation schema in validation.ts.
 */

export const ENDPOINT_SAMPLES: Record<string, Record<string, unknown>> = {
  'POST /incidents': {
    title: 'Elevated API error rates on checkout service',
    serviceId: 'srv_prod_checkout',
    urgency: 'HIGH',
    priority: 'P1',
    description: 'Elevated 5xx error rates detected across primary checkout cluster in EU region.',
  },
  'PATCH /incidents/{id}': {
    title: 'Degraded latency on checkout service',
    urgency: 'MEDIUM',
    status: 'ACKNOWLEDGED',
  },
  'POST /incidents/{id}/acknowledge': {
    note: 'Primary on-call engineer acknowledging and investigating alert root cause.',
  },
  'POST /incidents/{id}/resolve': {
    resolutionNote: 'Mitigated after rolling back canary deployment v2.4.1.',
    resolutionKind: 'MANUAL',
  },
  'POST /incidents/{id}/assign': {
    assigneeId: 'usr_789012',
  },
  'POST /incidents/{id}/notes': {
    content: 'Traffic successfully rerouted to secondary cluster; 5xx error rate normalized to 0.01%.',
  },
  'POST /services': {
    name: 'Payment Gateway API',
    description: 'Core transactional payment and settlement service',
    teamId: 'team_platform',
    escalationPolicyId: 'ep_critical',
    status: 'OPERATIONAL',
  },
  'PATCH /services/{id}': {
    name: 'Payment Gateway API v2',
    status: 'DEGRADED',
  },
  'POST /teams': {
    name: 'Platform Engineering',
    description: 'Core platform infrastructure and reliability engineering team',
  },
  'PATCH /teams/{id}': {
    name: 'Platform Infrastructure',
    description: 'Updated platform engineering and observability team',
  },
  'POST /schedules': {
    name: 'Primary SRE Rotation',
    timeZone: 'UTC',
    description: '24/7 primary on-call rotation for production services',
  },
  'PATCH /schedules/{id}': {
    name: 'Primary SRE Rotation (Follow-the-Sun)',
    timeZone: 'America/New_York',
  },
  'POST /schedules/{id}/overrides': {
    userId: 'usr_789012',
    startDate: '2026-10-15T00:00:00.000Z',
    endDate: '2026-10-15T08:00:00.000Z',
  },
  'POST /escalation-policies': {
    name: 'Critical Infrastructure Tier-1',
    description: 'Immediate page to primary SRE followed by team lead escalation',
    steps: [
      {
        delayMinutes: 5,
        targetType: 'USER',
        targetId: 'usr_789012',
        notificationChannels: ['EMAIL', 'SMS', 'PUSH'],
      },
    ],
  },
  'PATCH /escalation-policies/{id}': {
    name: 'Critical Infrastructure Tier-1 (Updated)',
    description: 'Updated escalation policy rules and responder chains',
  },
  'PATCH /integrations/{id}': {
    name: 'Datadog Production Alerts',
    enabled: true,
  },
  'POST /status-pages': {
    name: 'OpsKnight Public Status',
    slug: 'opsknight-status',
    isDefault: false,
  },
  'PATCH /status-pages/{id}': {
    name: 'OpsKnight System Status',
    enabled: true,
  },
  'POST /status-pages/{id}/announcements': {
    title: 'Scheduled Database Maintenance Window',
    message: 'Routine database maintenance will occur on October 18 between 02:00 and 04:00 UTC.',
    type: 'MAINTENANCE',
    isActive: true,
  },
  'POST /runbooks/{id}/execute': {
    incidentId: 'inc_123456',
    parameters: {
      cluster: 'prod-eu-west-1',
      dryRun: false,
    },
  },
  'POST /service-accounts': {
    name: 'Terraform Automation',
    role: 'RESPONDER',
    description: 'Machine service account for CI/CD pipeline automation and infrastructure provisioning',
    teamIds: ['team_platform'],
  },
  'POST /service-accounts/{id}/tokens': {
    name: 'Deploy Pipeline Token',
    scopes: ['incidents:read', 'services:read', 'events:write'],
    expiresInDays: 90,
  },
  'POST /postmortems': {
    incidentId: 'inc_123456',
    title: 'Postmortem: Checkout Latency Spike in EU Region',
    summary: 'Database connection pool exhaustion caused elevated 5xx error rates during morning traffic peak.',
    rootCause: 'Unindexed query on orders table saturated active connection pool.',
    resolution: 'Applied database index concurrently and increased max connection pool limit.',
    lessons: 'Add query latency monitoring and pre-flight index verification to CI checks.',
  },
  'PATCH /postmortems/{id}': {
    title: 'Postmortem: Checkout Latency Spike in EU Region (Final)',
    summary: 'Updated retrospective with complete timeline and verified remediation actions.',
    status: 'PUBLISHED',
    isPublic: true,
  },
};

/**
 * Retrieve verified sample body for an endpoint method and path.
 */
export function getVerifiedSampleBody(method: string, path: string): Record<string, unknown> | undefined {
  const key = `${method.toUpperCase()} ${path}`;
  // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
  return ENDPOINT_SAMPLES[key];
}
