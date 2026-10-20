/**
 * OpenAPI 3.1 specification for OpsKnight Public REST API v2
 */

import { finalizeOpenApiSpec } from './openapi-finalize';

function buildBaseSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpsKnight Enterprise Public REST API',
      version: '2.0.0',
      description:
        'Secure, high-performance, enterprise-grade REST API platform for OpsKnight incident management, on-call schedules, escalations, automation, runbooks, and administration.',
      license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
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
      {
        name: 'Users',
        description: 'User directory, role/lifecycle administration and invitations',
      },
      {
        name: 'Schedules',
        description: 'On-call rotations, layers, overrides, and live on-call lookups',
      },
      {
        name: 'Escalation Policies',
        description: 'Multi-step escalation rules and target routing',
      },
      { name: 'Integrations', description: 'Inbound integration health and status' },
      { name: 'Notifications', description: 'Outbound delivery history and safe retry' },
      {
        name: 'Status Pages',
        description: 'Status pages, components, and public incident announcements',
      },
      {
        name: 'Service Objectives',
        description:
          'Versioned measurement contracts, authorized history and bounded asynchronous evaluations',
      },
      { name: 'Runbooks', description: 'Automated remediation workflows and execution tracking' },
      {
        name: 'Service Accounts',
        description: 'Automation identities and fine-grained token credentials',
      },
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
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'requestId',
            'timestamp',
          ],
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
            status: {
              type: 'string',
              enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
            },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'], nullable: true },
            urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
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
            teamId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            acknowledgedAt: { type: 'string', format: 'date-time', nullable: true },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
          },
          required: ['id', 'title', 'status', 'urgency', 'serviceId', 'createdAt', 'updatedAt'],
        },
        IncidentNote: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            incidentId: { type: 'string' },
            userId: { type: 'string' },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
          required: ['id', 'content', 'createdAt'],
        },
        IncidentTimelineEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            incidentId: { type: 'string' },
            type: { type: 'string' },
            message: { type: 'string' },
            metadata: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'incidentId', 'type', 'message', 'createdAt'],
        },
        Service: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            revision: {
              type: 'integer',
              readOnly: true,
              description:
                'Monotonic version of this resource; it is the value of the ETag header on detail reads.',
            },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE'],
            },
            teamId: { type: 'string' },
            team: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            escalationPolicyId: { type: 'string' },
            escalationPolicy: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            openIncidentsCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: [
            'id',
            'name',
            'status',
            'teamId',
            'escalationPolicyId',
            'createdAt',
            'updatedAt',
          ],
        },
        Team: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            revision: {
              type: 'integer',
              readOnly: true,
              description:
                'Monotonic version of this resource; it is the value of the ETag header on detail reads.',
            },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            memberCount: { type: 'integer' },
            serviceCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'createdAt', 'updatedAt'],
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            status: { type: 'string' },
            timeZone: { type: 'string' },
            department: { type: 'string', nullable: true },
            jobTitle: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'email', 'role', 'status'],
        },
        Schedule: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            revision: {
              type: 'integer',
              readOnly: true,
              description:
                'Monotonic version of this resource; it is the value of the ETag header on detail reads.',
            },
            name: { type: 'string' },
            timeZone: { type: 'string' },
            description: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'timeZone', 'createdAt', 'updatedAt'],
        },
        EscalationPolicy: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            revision: {
              type: 'integer',
              readOnly: true,
              description:
                'Monotonic version of this resource; it is the value of the ETag header on detail reads.',
            },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            stepCount: { type: 'integer' },
            serviceCount: { type: 'integer' },
            steps: { type: 'array', items: { type: 'object' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'createdAt', 'updatedAt'],
        },
        Integration: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            revision: {
              type: 'integer',
              readOnly: true,
              description:
                'Monotonic version of this resource; it is the value of the ETag header on detail reads.',
            },
            name: { type: 'string' },
            type: { type: 'string' },
            enabled: { type: 'boolean' },
            snsTopicArn: { type: ['string', 'null'], description: 'Configured CloudWatch SNS topic; absent for other provider types.' },
            serviceId: { type: 'string' },
            service: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'type', 'enabled', 'serviceId', 'createdAt', 'updatedAt'],
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            channel: { type: 'string' },
            status: { type: 'string' },
            incidentId: { type: 'string', nullable: true },
            userId: { type: 'string' },
            failureReason: { type: 'string', nullable: true },
            sentAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'channel', 'status', 'userId', 'createdAt'],
        },
        StatusPage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            isDefault: { type: 'boolean' },
            enabled: { type: 'boolean' },
            description: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            publication: {
              type: 'object',
              description:
                'Present on PATCH. The change is committed before the public page is republished; this reports whether the page is live, still publishing, or failed and awaiting background reconciliation.',
              properties: {
                status: { type: 'string', enum: ['LIVE', 'PUBLISHING', 'FAILED', 'DISABLED'] },
                revision: { type: 'string' },
                lastError: { type: 'string', nullable: true },
                stale: { type: 'boolean' },
              },
              required: ['status', 'revision'],
            },
          },
          required: ['id', 'name', 'slug', 'isDefault', 'enabled', 'createdAt', 'updatedAt'],
        },
        StatusPageAnnouncement: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            message: { type: 'string' },
            type: { type: 'string' },
            isActive: { type: 'boolean' },
            startDate: { type: 'string', format: 'date-time', nullable: true },
            endDate: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'title', 'message', 'type', 'isActive', 'createdAt'],
        },
        Runbook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string', nullable: true },
            version: { type: 'integer' },
            steps: { type: 'array', items: { type: 'object' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'slug', 'version', 'createdAt', 'updatedAt'],
        },
        RunbookExecution: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            runbookId: { type: 'string' },
            runbook: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
              },
            },
            incidentId: { type: 'string', nullable: true },
            status: { type: 'string' },
            triggeredByUserId: { type: 'string', nullable: true },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            steps: { type: 'array', items: { type: 'object' } },
          },
          required: ['id', 'runbookId', 'status', 'startedAt'],
        },
        ServiceAccount: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            description: { type: 'string', nullable: true },
            status: { type: 'string' },
            teamIds: { type: 'array', items: { type: 'string' } },
            activeTokensCount: {
              type: 'integer',
              description: 'Unrevoked, unexpired tokens (database aggregate).',
            },
            tokensTotal: {
              type: 'integer',
              description: 'List: non-revoked tokens. Detail: every token ever issued.',
            },
            tokensTruncated: {
              type: 'boolean',
              description:
                'True when `tokens` holds only the newest tokens; counts above cover all of them.',
            },
            tokens: {
              type: 'array',
              description: 'The newest tokens only (bounded).',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  prefix: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] },
                  createdAt: { type: 'string', format: 'date-time' },
                  lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
                  expiresAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'role', 'status', 'createdAt'],
        },
        AuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            action: { type: 'string' },
            entityType: { type: 'string' },
            entityId: { type: 'string', nullable: true },
            actorId: { type: 'string', nullable: true },
            actorEmail: { type: 'string', nullable: true },
            actorName: { type: 'string', nullable: true },
            details: { type: 'object', nullable: true },
            ip: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'action', 'entityType', 'createdAt'],
        },
        MetricsReport: {
          type: 'object',
          properties: {
            windowDays: { type: 'integer' },
            serviceId: { type: 'string', nullable: true },
            slaCompliancePercent: { type: 'number' },
            meanTimeToAcknowledgeMinutes: { type: 'number', nullable: true },
            meanTimeToResolveMinutes: { type: 'number', nullable: true },
            totalIncidents: { type: 'integer' },
            resolvedIncidents: { type: 'integer' },
            byPriority: { type: 'object' },
            statusMix: { type: 'array', items: { type: 'object' } },
          },
          required: ['windowDays', 'slaCompliancePercent', 'totalIncidents', 'resolvedIncidents'],
        },
        Postmortem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            incidentId: { type: 'string' },
            title: { type: 'string', nullable: true },
            summary: { type: 'string' },
            rootCause: { type: 'string', nullable: true },
            resolution: { type: 'string', nullable: true },
            mitigation: { type: 'string', nullable: true },
            impact: { type: 'string', nullable: true },
            lessons: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] },
            isPublic: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'incidentId', 'summary', 'status', 'isPublic', 'createdAt', 'updatedAt'],
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
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
              },
            },
            {
              name: 'priority',
              in: 'query',
              schema: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
            },
            {
              name: 'urgency',
              in: 'query',
              schema: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            },
            { name: 'serviceId', in: 'query', schema: { type: 'string' } },
            { name: 'assigneeId', in: 'query', schema: { type: 'string' } },
            { name: 'teamId', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Paginated incident collection',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Incident' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
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
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'serviceId'],
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    serviceId: { type: 'string' },
                    urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'HIGH' },
                    priority: {
                      type: 'string',
                      enum: ['P1', 'P2', 'P3', 'P4', 'P5'],
                      nullable: true,
                    },
                    assigneeId: { type: 'string', nullable: true },
                    teamId: { type: 'string', nullable: true },
                    dedupKey: { type: 'string', nullable: true },
                    customFields: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Incident created successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '409': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}': {
        get: {
          tags: ['Incidents'],
          summary: 'Get incident details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Incident detail record' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Incidents'],
          summary: 'Update incident metadata atomically',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    priority: {
                      type: 'string',
                      enum: ['P1', 'P2', 'P3', 'P4', 'P5'],
                      nullable: true,
                    },
                    urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                    status: {
                      type: 'string',
                      enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
                    },
                    assigneeId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated incident details' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}/acknowledge': {
        post: {
          tags: ['Incidents'],
          summary: 'Acknowledge incident via certified domain lifecycle',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { note: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Incident acknowledged' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}/resolve': {
        post: {
          tags: ['Incidents'],
          summary: 'Resolve incident via certified domain lifecycle',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    resolutionNote: { type: 'string' },
                    resolutionKind: {
                      type: 'string',
                      enum: ['MANUAL', 'SOURCE_RECOVERY', 'AUTOMATION', 'AUTO_TIMEOUT', 'UNKNOWN'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Incident resolved' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}/assign': {
        post: {
          tags: ['Incidents'],
          summary: 'Assign incident to a user or team',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    assigneeId: { type: 'string', nullable: true },
                    teamId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Incident assigned successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}/notes': {
        get: {
          tags: ['Incidents'],
          summary: 'List incident notes',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'List of notes on the incident' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Incidents'],
          summary: 'Add note to incident',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['content'],
                  properties: { content: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Note added successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/incidents/{id}/timeline': {
        get: {
          tags: ['Incidents'],
          summary: 'List incident timeline events with cursor pagination',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated timeline events' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/services': {
        get: {
          tags: ['Services'],
          summary: 'List services with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'teamId', in: 'query', schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE'],
              },
            },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated service collection' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Services'],
          summary: 'Create a new service',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'teamId', 'escalationPolicyId'],
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    teamId: { type: 'string' },
                    escalationPolicyId: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: [
                        'OPERATIONAL',
                        'DEGRADED',
                        'PARTIAL_OUTAGE',
                        'MAJOR_OUTAGE',
                        'MAINTENANCE',
                      ],
                      default: 'OPERATIONAL',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Service created successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/services/{id}': {
        get: {
          tags: ['Services'],
          summary: 'Get service details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Services'],
          summary: 'Update service details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    teamId: { type: 'string' },
                    escalationPolicyId: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: [
                        'OPERATIONAL',
                        'DEGRADED',
                        'PARTIAL_OUTAGE',
                        'MAJOR_OUTAGE',
                        'MAINTENANCE',
                      ],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Service updated successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Services'],
          summary: 'Delete service (safely verifying no active incidents or objective history)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service deleted successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/services/{id}/notification-settings': {
        get: {
          tags: ['Services'],
          summary: 'Read service notification policy',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Service notification policy' } },
        },
        patch: {
          tags: ['Services'],
          summary: 'Update service notification policy',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    serviceNotificationChannels: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'string', enum: ['SLACK', 'WEBHOOK', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP', 'MICROSOFT_TEAMS'] } },
                    serviceNotifyOnTriggered: { type: 'boolean' },
                    serviceNotifyOnAck: { type: 'boolean' },
                    serviceNotifyOnResolved: { type: 'boolean' },
                    serviceNotifyOnSlaBreach: { type: 'boolean' },
                  },
                  minProperties: 1,
                },
              },
            },
          },
          responses: { '200': { description: 'Updated service notification policy' } },
        },
      },
      '/teams': {
        get: {
          tags: ['Teams'],
          summary: 'List teams with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated team list' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Teams'],
          summary: 'Create a new team',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Team created successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/teams/{id}': {
        get: {
          tags: ['Teams'],
          summary: 'Get team details with member and service relations',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Team details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Teams'],
          summary: 'Update team name or description',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Team updated successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Teams'],
          summary: 'Delete team (safely checking associated services and members)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Team deleted successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List users with cursor pagination and role filtering',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'role', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated user directory' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get user details with safe profile fields',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'User profile details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules': {
        get: {
          tags: ['Schedules'],
          summary: 'List on-call schedules',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated on-call schedules' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Schedules'],
          summary: 'Create a new on-call schedule',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    timeZone: { type: 'string', default: 'UTC' },
                    description: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Schedule created successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules/{id}': {
        get: {
          tags: ['Schedules'],
          summary: 'Get schedule details with rotation layers',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Schedule details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Schedules'],
          summary: 'Update schedule name or timezone',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    timeZone: { type: 'string' },
                    description: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Schedule updated successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Schedules'],
          summary: 'Delete schedule (safely checking escalation policy references)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Schedule deleted successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules/{id}/on-call': {
        get: {
          tags: ['Schedules'],
          summary: 'Calculate the effective on-call users at a point in time',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'at', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': { description: 'Effective on-call personnel' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules/{id}/overrides': {
        get: {
          tags: ['Schedules'],
          summary: 'List overrides for a schedule',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Schedule overrides' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Schedules'],
          summary: 'Create schedule override with domain validation',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'startDate', 'endDate'],
                  properties: {
                    userId: { type: 'string' },
                    startDate: { type: 'string', format: 'date-time' },
                    endDate: { type: 'string', format: 'date-time' },
                    replacesUserId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Schedule override created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules/{id}/overrides/{overrideId}': {
        delete: {
          tags: ['Schedules'],
          summary: 'Cancel a schedule override',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'overrideId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Schedule override cancelled' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/schedules/{id}/coverage': {
        get: {
          tags: ['Schedules'],
          summary: 'Calculate bounded effective coverage and gaps',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'start', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
            { name: 'end', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': { description: 'Effective shifts and uncovered intervals' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/escalation-policies': {
        get: {
          tags: ['Escalation Policies'],
          summary: 'List escalation policies',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated escalation policies' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Escalation Policies'],
          summary: 'Create escalation policy',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'steps'],
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    steps: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['delayMinutes', 'targetType', 'targetId'],
                        properties: {
                          delayMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
                          targetType: { type: 'string', enum: ['USER', 'SCHEDULE', 'TEAM'] },
                          targetId: { type: 'string' },
                          notificationChannels: { type: 'array', items: { type: 'string' } },
                          notifyOnlyTeamLead: { type: 'boolean' },
                          conditions: { type: 'array', items: { type: 'object' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Escalation policy created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/escalation-policies/{id}': {
        get: {
          tags: ['Escalation Policies'],
          summary: 'Get escalation policy details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Escalation policy details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Escalation Policies'],
          summary: 'Update escalation policy rules or metadata',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    steps: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Escalation policy updated' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Escalation Policies'],
          summary: 'Delete escalation policy (safely checking service usage)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Escalation policy deleted' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/integrations': {
        get: {
          tags: ['Integrations'],
          summary: 'List incoming integrations scoped by accessible services',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'serviceId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated integration collection' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/integrations/{id}': {
        get: {
          tags: ['Integrations'],
          summary: 'Get integration details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Integration details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Integrations'],
          summary: 'Update integration name or enabled status',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Integration updated' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List notification delivery audit records',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'channel', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'incidentId', in: 'query', schema: { type: 'string' } },
            { name: 'userId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated notifications' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/notifications/{id}/retry': {
        post: {
          tags: ['Notifications'],
          summary: 'Retry a failed notification delivery safely through central control plane',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Notification requeued successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/status-pages': {
        get: {
          tags: ['Status Pages'],
          summary: 'List status pages with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated status pages' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Status Pages'],
          summary: 'Create a new status page',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'slug'],
                  properties: {
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    isDefault: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Status page created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '409': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/status-pages/{id}': {
        get: {
          tags: ['Status Pages'],
          summary: 'Get status page configuration',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Status page details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Status Pages'],
          summary: 'Update status page settings with certified publication workflows',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    isDefault: { type: 'boolean' },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Status page updated' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/status-pages/{id}/announcements': {
        get: {
          tags: ['Status Pages'],
          summary: 'List status page incident announcements',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Announcements list' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Status Pages'],
          summary: 'Publish announcement on status page',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'message'],
                  properties: {
                    title: { type: 'string' },
                    message: { type: 'string' },
                    type: { type: 'string', default: 'INFO' },
                    startDate: { type: 'string', format: 'date-time' },
                    endDate: { type: 'string', format: 'date-time', nullable: true },
                    isActive: { type: 'boolean', default: true },
                    services: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Announcement created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/runbooks': {
        get: {
          tags: ['Runbooks'],
          summary: 'List available runbooks',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated runbook collection' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/runbooks/{id}': {
        get: {
          tags: ['Runbooks'],
          summary: 'Get runbook summary and step summaries (step configuration is never returned)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Runbook details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/runbooks/{id}/execute': {
        post: {
          tags: ['Runbooks'],
          summary: 'Trigger safe runbook execution with idempotency',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Unique idempotency key required to prevent duplicate execution',
            },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    incidentId: { type: 'string', nullable: true },
                    serviceId: { type: 'string', nullable: true },
                    bindingId: {
                      type: 'string',
                      nullable: true,
                      description:
                        'Select an enabled service rule. Required when multiple rules match; detached rules cannot execute.',
                    },
                    expectedPlanDigest: {
                      type: 'string',
                      pattern: '^[a-f0-9]{64}$',
                      description:
                        'Digest returned by execution preview. If supplied, a changed plan returns 412 before starting work.',
                    },
                    parameters: {
                      type: 'object',
                      description:
                        'Inputs for an unbound execution, validated against the published version. Omit for service rules: their saved inputs are authoritative and non-empty parameters return HTTP 400.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '202': { description: 'Runbook execution initiated' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/runbooks/executions/{id}': {
        get: {
          tags: ['Runbooks'],
          summary: 'Get runbook execution status and step results',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Execution details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/service-accounts': {
        get: {
          tags: ['Service Accounts'],
          summary: 'List automation service accounts',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Service accounts list' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Service Accounts'],
          summary: 'Create automation service account',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string', default: 'RESPONDER' },
                    description: { type: 'string' },
                    teamIds: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Service account created' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/service-accounts/{id}': {
        get: {
          tags: ['Service Accounts'],
          summary: 'Get service account details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service account details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Service Accounts'],
          summary: 'Delete service account and revoke its tokens',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service account deleted' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/service-accounts/{id}/tokens': {
        post: {
          tags: ['Service Accounts'],
          summary: 'Issue a new fine-grained token for a service account',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'scopes'],
                  properties: {
                    name: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    expiresInDays: { type: 'integer', minimum: 1, maximum: 365 },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Token issued successfully (token value shown once)' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/service-accounts/{id}/tokens/{tokenId}': {
        delete: {
          tags: ['Service Accounts'],
          summary: 'Revoke a specific service account token immediately',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'tokenId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Token revoked successfully' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/audit-logs': {
        get: {
          tags: ['Audit Logs'],
          summary: 'List tamper-evident audit records with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'entityType', in: 'query', schema: { type: 'string' } },
            { name: 'entityId', in: 'query', schema: { type: 'string' } },
            { name: 'actorId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated audit logs' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/reports/metrics': {
        get: {
          tags: ['Reports'],
          summary: 'Calculate actor-scoped SLA compliance and MTTA/MTTR metrics',
          parameters: [
            { name: 'serviceId', in: 'query', schema: { type: 'string' } },
            { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
          ],
          responses: {
            '200': {
              description: 'Operational metrics and SLA summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/MetricsReport' },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/postmortems': {
        get: {
          tags: ['Postmortems'],
          summary: 'List incident postmortems with cursor pagination',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'incidentId', in: 'query', schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] },
            },
            { name: 'isPublic', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated postmortem collection' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
        post: {
          tags: ['Postmortems'],
          summary: 'Create incident postmortem',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['incidentId', 'summary'],
                  properties: {
                    incidentId: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    rootCause: { type: 'string' },
                    resolution: { type: 'string' },
                    mitigation: { type: 'string' },
                    lessons: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['DRAFT', 'IN_REVIEW', 'PUBLISHED'],
                      default: 'DRAFT',
                    },
                    isPublic: { type: 'boolean', default: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Postmortem created successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
      '/postmortems/{id}': {
        get: {
          tags: ['Postmortems'],
          summary: 'Get postmortem details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Postmortem details' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        patch: {
          tags: ['Postmortems'],
          summary: 'Update postmortem content or status',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    rootCause: { type: 'string' },
                    resolution: { type: 'string' },
                    mitigation: { type: 'string' },
                    lessons: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'],
                    },
                    isPublic: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Postmortem updated successfully' },
            '400': { $ref: '#/components/responses/ProblemError' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
        delete: {
          tags: ['Postmortems'],
          summary: 'Delete postmortem',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '204': { description: 'Postmortem deleted successfully' },
            '401': { $ref: '#/components/responses/ProblemError' },
            '403': { $ref: '#/components/responses/ProblemError' },
            '404': { $ref: '#/components/responses/ProblemError' },
          },
        },
      },
    },
  };
}

let cached: Record<string, unknown> | undefined;

/** The published OpenAPI 3.1 document: the hand-written description, finalised from the canonical registry. */
export function getOpenApiV2Spec(): Record<string, unknown> {
  cached ??= finalizeOpenApiSpec(buildBaseSpec());
  return cached;
}
