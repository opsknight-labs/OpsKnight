/**
 * OpenAPI 3.1 specification for OpsKnight Public REST API v2
 */

export function getOpenApiV2Spec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpsKnight Enterprise Public REST API',
      version: '2.0.0',
      description:
        'Secure, high-performance, enterprise-grade REST API platform for OpsKnight incident management, on-call schedules, escalations, automation, runbooks, and administration.',
      contact: {
        name: 'OpsKnight Engineering',
        url: 'https://opsknight.com',
      },
    },
    servers: [
      {
        url: '/api/v2',
        description: 'OpsKnight API v2 Root',
      },
    ],
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    tags: [
      { name: 'Incidents', description: 'Incident lifecycle, assignment, notes, and timeline' },
      { name: 'Services', description: 'Service inventory, configuration, and dependencies' },
      { name: 'Teams', description: 'Team organization and memberships' },
      { name: 'Users', description: 'Safe directory and user details' },
      { name: 'Schedules', description: 'On-call rotations, layers, overrides, and live on-call lookups' },
      { name: 'Escalation Policies', description: 'Multi-step escalation rules and target routing' },
      { name: 'Integrations', description: 'Inbound integration health and status' },
      { name: 'Notifications', description: 'Outbound delivery history and safe retry' },
      { name: 'Status Pages', description: 'Status pages, components, and public incident announcements' },
      { name: 'Runbooks', description: 'Automated remediation workflows and execution tracking' },
      { name: 'Service Accounts', description: 'Automation identities and fine-grained token credentials' },
      { name: 'Audit Logs', description: 'Tamper-evident audit activity search' },
      { name: 'Reports', description: 'SLA metrics, resolution rates, and operational analytics' },
      { name: 'Postmortems', description: 'Incident retrospectives and root cause analysis' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Standard Bearer token (API Key or Service Account token)',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'OpsKnight API Key header',
        },
      },
      schemas: {
        ProblemDetails: {
          type: 'object',
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            code: { type: 'string' },
            requestId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            retryable: { type: 'boolean' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
            meta: { type: 'object' },
          },
          required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'requestId', 'timestamp'],
        },
        Pagination: {
          type: 'object',
          properties: {
            limit: { type: 'integer', default: 20 },
            nextCursor: { type: 'string', nullable: true },
            hasMore: { type: 'boolean' },
            total: { type: 'integer' },
          },
          required: ['limit', 'hasMore'],
        },
        Incident: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'] },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'], nullable: true },
            urgency: { type: 'string', enum: ['HIGH', 'LOW'] },
            serviceId: { type: 'string' },
            service: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
            assignee: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            acknowledgedAt: { type: 'string', format: 'date-time', nullable: true },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
          },
          required: ['id', 'title', 'status', 'urgency', 'serviceId', 'createdAt', 'updatedAt'],
        },
      },
      responses: {
        ProblemError: {
          description: 'RFC 9457 Problem Details error response',
          content: {
            'application/problem+json': {
              schema: {
                $ref: '#/components/schemas/ProblemDetails',
              },
            },
          },
        },
      },
    },
    paths: {
      '/incidents': {
        get: {
          tags: ['Incidents'],
          summary: 'List incidents with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'priority', in: 'query', schema: { type: 'string' } },
            { name: 'urgency', in: 'query', schema: { type: 'string' } },
            { name: 'serviceId', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Success' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Incidents'],
          summary: 'Create incident with idempotency',
          parameters: [
            { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': { description: 'Created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '409': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}': {
        get: {
          tags: ['Incidents'],
          summary: 'Get incident details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' }, '404': { $ref: '#/components/responses/ProblemError' } },
        },
        patch: {
          tags: ['Incidents'],
          summary: 'Update incident metadata',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' }, '400': { $ref: '#/components/responses/ProblemError' } },
        },
      },
      '/incidents/{id}/acknowledge': {
        post: {
          tags: ['Incidents'],
          summary: 'Acknowledge incident via certified domain lifecycle',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' } },
        },
      },
      '/incidents/{id}/resolve': {
        post: {
          tags: ['Incidents'],
          summary: 'Resolve incident via certified domain lifecycle',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' } },
        },
      },
      '/services': {
        get: {
          tags: ['Services'],
          summary: 'List services with cursor pagination',
          responses: { '200': { description: 'Success' } },
        },
        post: {
          tags: ['Services'],
          summary: 'Create a new service',
          responses: { '201': { description: 'Created' } },
        },
      },
      '/schedules': {
        get: {
          tags: ['Schedules'],
          summary: 'List on-call schedules',
          responses: { '200': { description: 'Success' } },
        },
      },
      '/schedules/{id}/on-call': {
        get: {
          tags: ['Schedules'],
          summary: 'Calculate effective on-call users at timestamp or range',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'at', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Success' } },
        },
      },
      '/escalation-policies': {
        get: {
          tags: ['Escalation Policies'],
          summary: 'List escalation policies',
          responses: { '200': { description: 'Success' } },
        },
        post: {
          tags: ['Escalation Policies'],
          summary: 'Create escalation policy',
          responses: { '201': { description: 'Created' } },
        },
      },
      '/runbooks': {
        get: {
          tags: ['Runbooks'],
          summary: 'List available runbooks',
          responses: { '200': { description: 'Success' } },
        },
      },
      '/runbooks/{id}/execute': {
        post: {
          tags: ['Runbooks'],
          summary: 'Trigger safe runbook execution',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '202': { description: 'Accepted' } },
        },
      },
      '/service-accounts': {
        get: {
          tags: ['Service Accounts'],
          summary: 'List automation service accounts',
          responses: { '200': { description: 'Success' } },
        },
        post: {
          tags: ['Service Accounts'],
          summary: 'Create automation service account',
          responses: { '201': { description: 'Created' } },
        },
      },
      '/service-accounts/{id}/tokens': {
        post: {
          tags: ['Service Accounts'],
          summary: 'Issue a new fine-grained token for a service account',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Created' } },
        },
      },
      '/postmortems': {
        get: {
          tags: ['Postmortems'],
          summary: 'List incident postmortems with cursor pagination',
          responses: { '200': { description: 'Success' } },
        },
        post: {
          tags: ['Postmortems'],
          summary: 'Create incident postmortem',
          responses: { '201': { description: 'Created' } },
        },
      },
      '/postmortems/{id}': {
        get: {
          tags: ['Postmortems'],
          summary: 'Get postmortem details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' } },
        },
        patch: {
          tags: ['Postmortems'],
          summary: 'Update postmortem content or status',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' } },
        },
        delete: {
          tags: ['Postmortems'],
          summary: 'Delete postmortem',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'No Content' } },
        },
      },
    },
  };
}
