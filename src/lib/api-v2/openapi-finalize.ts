import { enterpriseOpenApiPaths, ENTERPRISE_SCHEMAS } from './enterprise-openapi';
import { ENDPOINT_SAMPLES } from './endpoint-samples';
import { V2_MUTATION_CONTRACT } from './mutation-contract';
import { V2_OPERATIONS, type V2OperationDefinition } from './openapi-registry';
import { API_SCOPE_REGISTRY } from '@/lib/api-scope-registry';
import type { ApiScope } from '@/lib/authorization';

/**
 * Turns the hand-written path/schema descriptions into the published contract by
 * applying everything that must be uniform across operations, from the canonical
 * registry and the mutation contract rather than by hand per operation:
 *
 * - OpenAPI 3.1 / JSON Schema 2020-12 nullability (`nullable: true` is 3.0 syntax
 *   and is not understood by 3.1 validators and generators);
 * - stable operationId, required scope, idempotency and concurrency metadata;
 * - typed success responses that match the runtime envelope;
 * - the headers and error responses every client must handle (429 with
 *   Retry-After, 412 and 409 where applicable, Idempotency-Key, If-Match, ETag).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing
type Json = Record<string, any>;

const ENVELOPE_META = {
  requestId: { type: 'string' },
  timestamp: { type: 'string', format: 'date-time' },
};

function convertNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertNullable);
  if (!node || typeof node !== 'object') return node;
  const input = node as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'nullable') continue;
    // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
    out[key] = convertNullable(value);
  }
  if (input.nullable === true) {
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
    } else if (Array.isArray(out.type)) {
      if (!out.type.includes('null')) out.type = [...out.type, 'null'];
    } else if (out.$ref) {
      const { $ref, ...rest } = out;
      return { ...rest, oneOf: [{ $ref }, { type: 'null' }] };
    }
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}

const extraSchemas: Json = {
  IncidentAvailableActions: {
    type: 'object', properties: {
      incidentId: { type: 'string' }, incidentStatus: { type: 'string' },
      observedAt: { type: 'string', format: 'date-time' }, advisory: { type: 'boolean' },
      actions: { type: 'array', items: { type: 'object', properties: {
        operationId: { type: 'string' }, method: { type: 'string' }, path: { type: 'string' },
        allowed: { type: 'boolean' }, stateEligible: { type: 'boolean' },
      }, required: ['operationId', 'method', 'path', 'allowed', 'stateEligible'] } },
      runbookExecution: { type: 'object', properties: {
        requiresRunbookSelection: { type: 'boolean' }, previewPath: { type: 'string' },
        allowedToAttemptPreview: { type: 'boolean' },
      }, required: ['requiresRunbookSelection', 'previewPath', 'allowedToAttemptPreview'] },
    }, required: ['incidentId', 'incidentStatus', 'observedAt', 'advisory', 'actions', 'runbookExecution'],
  },
  IncidentAlertSummary: {
    type: 'object', properties: {
      id: { type: 'string' }, incidentId: { type: ['string', 'null'] }, serviceId: { type: 'string' },
      status: { type: 'string' }, correlationHash: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
    }, required: ['id', 'incidentId', 'serviceId', 'status', 'correlationHash', 'createdAt'],
  },
  IncidentNotificationAttempt: {
    allOf: [
      { $ref: '#/components/schemas/NotificationDeliveryAttempt' },
      { type: 'object', properties: { notification: {
        type: 'object', properties: { channel: { type: 'string' }, status: { type: 'string' } },
        required: ['channel', 'status'],
      } }, required: ['notification'] },
    ],
  },
  IncidentResponseActivity: {
    type: 'object',
    properties: {
      incident: { type: 'object', properties: {
        id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' },
        serviceId: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
        acknowledgedAt: { type: ['string', 'null'], format: 'date-time' },
        resolvedAt: { type: ['string', 'null'], format: 'date-time' },
        resolutionKind: { type: ['string', 'null'] },
        automationDecision: { type: ['object', 'null'], properties: {
          mode: { type: 'string' }, routeType: { type: 'string' },
          escalationPolicyId: { type: ['string', 'null'] }, matchedRouteRuleId: { type: ['string', 'null'] },
          evaluationAt: { type: 'string', format: 'date-time' },
        } },
      }, required: ['id', 'title', 'status', 'serviceId', 'createdAt', 'acknowledgedAt', 'resolvedAt', 'resolutionKind', 'automationDecision'] },
      alerts: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
        id: { type: 'string' }, status: { type: 'string' }, correlationHash: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
      }, required: ['id', 'status', 'correlationHash', 'createdAt'] } },
      events: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
        id: { type: 'string' }, type: { type: ['string', 'null'] }, createdAt: { type: 'string', format: 'date-time' },
      }, required: ['id', 'type', 'createdAt'] } },
      notifications: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
        id: { type: 'string' }, channel: { type: 'string' }, status: { type: 'string' }, attempts: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' }, sentAt: { type: ['string', 'null'], format: 'date-time' },
        deliveredAt: { type: ['string', 'null'], format: 'date-time' }, failedAt: { type: ['string', 'null'], format: 'date-time' },
      }, required: ['id', 'channel', 'status', 'attempts', 'createdAt', 'sentAt', 'deliveredAt', 'failedAt'] } },
      executions: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
        id: { type: 'string' }, runbookId: { type: 'string' }, status: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' }, startedAt: { type: ['string', 'null'], format: 'date-time' },
        completedAt: { type: ['string', 'null'], format: 'date-time' }, recoveryOutcome: { type: ['string', 'null'] },
        runbook: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      }, required: ['id', 'runbookId', 'status', 'createdAt', 'startedAt', 'completedAt', 'recoveryOutcome', 'runbook'] } },
      truncated: { type: 'object', properties: {
        alerts: { type: 'boolean' }, events: { type: 'boolean' }, notifications: { type: 'boolean' }, executions: { type: 'boolean' },
      }, required: ['alerts', 'events', 'notifications', 'executions'] },
    },
    required: ['incident', 'alerts', 'events', 'notifications', 'executions', 'truncated'],
  },
  RunbookExecutionSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' }, runbookId: { type: 'string' }, incidentId: { type: 'string' },
      status: { type: 'string' }, triggeredByType: { type: 'string' },
      startedAt: { type: ['string', 'null'], format: 'date-time' },
      completedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      recoveryOutcome: { type: ['string', 'null'] },
      runbook: { type: 'object', properties: {
        id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' },
      }, required: ['id', 'name', 'slug'] },
    },
    required: ['id', 'runbookId', 'incidentId', 'status', 'triggeredByType', 'startedAt', 'completedAt', 'createdAt', 'recoveryOutcome', 'runbook'],
  },
  NotificationDeliveryAttempt: {
    type: 'object',
    description: 'Delivery metadata. Provider message IDs and raw error text are intentionally omitted.',
    properties: {
      id: { type: 'string' }, notificationId: { type: 'string' }, ordinal: { type: 'integer' },
      outcome: { type: 'string' }, provider: { type: ['string', 'null'] },
      errorCode: { type: ['string', 'null'] },
      startedAt: { type: 'string', format: 'date-time' },
      finishedAt: { type: ['string', 'null'], format: 'date-time' },
      reconciliationDeadline: { type: ['string', 'null'], format: 'date-time' },
      latencyMs: { type: ['integer', 'null'] },
    },
    required: ['id', 'notificationId', 'ordinal', 'outcome', 'provider', 'errorCode', 'startedAt', 'finishedAt', 'reconciliationDeadline', 'latencyMs'],
  },
  NotificationFeedback: {
    type: 'object',
    properties: {
      notificationId: { type: 'string' },
      events: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
        id: { type: 'string' }, provider: { type: 'string' }, eventType: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
        processedAt: { type: ['string', 'null'], format: 'date-time' },
        quarantinedAt: { type: ['string', 'null'], format: 'date-time' },
      }, required: ['id', 'provider', 'eventType', 'occurredAt', 'processedAt', 'quarantinedAt'] } },
      truncated: { type: 'object', properties: {
        correlation: { type: 'boolean' }, events: { type: 'boolean' },
      }, required: ['correlation', 'events'] },
    },
    required: ['notificationId', 'events', 'truncated'],
  },
  EscalationPolicyDependencies: {
    type: 'object',
    properties: {
      policyId: { type: 'string' },
      services: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] } },
      usage: { type: 'object', properties: { services: { type: 'integer' }, versionRefs: { type: 'integer' }, decisions: { type: 'integer' } }, required: ['services', 'versionRefs', 'decisions'] },
      truncated: { type: 'object', properties: { services: { type: 'boolean' }, targets: { type: 'boolean' } }, required: ['services', 'targets'] },
      targets: { type: 'array', items: { type: 'object', properties: {
        stepId: { type: 'string' }, stepOrder: { type: 'integer' }, targetType: { type: 'string', enum: ['USER', 'TEAM', 'SCHEDULE'] },
        targetId: { type: ['string', 'null'] }, exists: { type: 'boolean' },
      }, required: ['stepId', 'stepOrder', 'targetType', 'targetId', 'exists'] } },
      valid: { type: 'boolean' },
      deletionAllowed: { type: 'boolean' },
    },
    required: ['policyId', 'services', 'usage', 'truncated', 'targets', 'valid', 'deletionAllowed'],
  },
  ActionResult: {
    type: 'object',
    properties: { success: { type: 'boolean' }, message: { type: 'string' } },
    required: ['success'],
  },
  IncidentTransition: {
    type: 'object',
    description: 'Fields returned after an acknowledge or resolve transition.',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      status: {
        type: 'string',
        enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
      },
      priority: { type: ['string', 'null'] },
      urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      acknowledgedAt: { type: ['string', 'null'], format: 'date-time' },
      resolvedAt: { type: ['string', 'null'], format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'title', 'status', 'urgency', 'updatedAt'],
  },
  IncidentAssignment: {
    type: 'object',
    description: 'Assignment state after POST /incidents/{id}/assign.',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      assigneeId: { type: ['string', 'null'] },
      teamId: { type: ['string', 'null'] },
      assignee: {
        type: ['object', 'null'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } },
      },
      team: {
        type: ['object', 'null'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'status', 'updatedAt'],
  },
  ScheduleOnCall: {
    type: 'object',
    properties: {
      schedule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          timeZone: { type: 'string' },
        },
      },
      at: { type: 'string', format: 'date-time' },
      onCallUsers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            timeZone: { type: ['string', 'null'] },
          },
        },
      },
    },
    required: ['schedule', 'at', 'onCallUsers'],
  },
  ScheduleOverride: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      scheduleId: { type: 'string' },
      userId: { type: 'string' },
      replacesUserId: { type: ['string', 'null'] },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'scheduleId', 'userId', 'startDate', 'endDate'],
  },
  ScheduleOverrideCancellation: {
    type: 'object',
    properties: { id: { type: 'string' }, cancelled: { type: 'boolean', const: true } },
    required: ['id', 'cancelled'],
  },
  ScheduleCoverage: {
    type: 'object',
    properties: {
      schedule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          timeZone: { type: 'string' },
          revision: { type: 'integer' },
        },
        required: ['id', 'name', 'timeZone', 'revision'],
      },
      start: { type: 'string', format: 'date-time' },
      end: { type: 'string', format: 'date-time' },
      shifts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
          },
          required: ['userId', 'start', 'end'],
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
          },
          required: ['start', 'end'],
        },
      },
    },
    required: ['schedule', 'start', 'end', 'shifts', 'gaps'],
  },
  ServiceNotificationSettings: {
    type: 'object',
    properties: {
      serviceId: { type: 'string' },
      revision: { type: 'integer' },
      serviceNotificationChannels: {
        type: 'array',
        items: { type: 'string', enum: ['SLACK', 'WEBHOOK', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP', 'MICROSOFT_TEAMS'] },
      },
      serviceNotifyOnTriggered: { type: 'boolean' },
      serviceNotifyOnAck: { type: 'boolean' },
      serviceNotifyOnResolved: { type: 'boolean' },
      serviceNotifyOnSlaBreach: { type: 'boolean' },
    },
    required: ['serviceId', 'revision', 'serviceNotificationChannels', 'serviceNotifyOnTriggered', 'serviceNotifyOnAck', 'serviceNotifyOnResolved', 'serviceNotifyOnSlaBreach'],
  },
  ServiceSupportHours: {
    type: 'object',
    properties: {
      policy: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              scopeKey: { type: 'string' },
              version: { type: 'integer' },
              timezone: { type: 'string' },
              inheritWorkspace: { type: 'boolean' },
              mode: { type: 'string', enum: ['INHERIT', 'ALWAYS', 'SCHEDULED'] },
              windows: {
                type: 'array',
                items: { type: 'object', properties: {
                  dayOfWeek: { type: 'integer' }, startMinute: { type: 'integer' }, endMinute: { type: 'integer' },
                }, required: ['dayOfWeek', 'startMinute', 'endMinute'] },
              },
              exceptions: {
                type: 'array',
                items: { type: 'object', properties: {
                  localDate: { type: 'string', format: 'date' }, available: { type: 'boolean' },
                  startMinute: { type: ['integer', 'null'] }, endMinute: { type: ['integer', 'null'] },
                  label: { type: ['string', 'null'] },
                }, required: ['localDate', 'available', 'startMinute', 'endMinute', 'label'] },
              },
            },
            required: ['scopeKey', 'version', 'timezone', 'inheritWorkspace', 'mode', 'windows', 'exceptions'],
          },
        ],
      },
    },
    required: ['policy'],
  },
  ServiceClassificationPolicy: {
    type: 'object',
    properties: {
      policy: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              scopeKey: { type: 'string' },
              version: { type: 'integer' },
              derivePriorityFromUrgency: { type: 'boolean' },
              priorityFallbackMode: { type: 'string', enum: ['INHERIT', 'ENABLED', 'DISABLED'] },
              rules: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: {
                  type: 'object',
                  properties: {
                    matchValue: { type: 'string', enum: ['critical', 'error', 'warning', 'info'] },
                    priorityMode: { type: 'string', enum: ['INHERIT', 'FALLBACK', 'SET', 'CLEAR'] },
                    priority: { type: ['string', 'null'], enum: ['P1', 'P2', 'P3', 'P4', 'P5', null] },
                    urgencyMode: { type: 'string', enum: ['INHERIT', 'SET', 'DEFAULT'] },
                    urgency: { type: ['string', 'null'], enum: ['HIGH', 'MEDIUM', 'LOW', null] },
                  },
                  required: ['matchValue', 'priorityMode', 'priority', 'urgencyMode', 'urgency'],
                },
              },
            },
            required: ['scopeKey', 'version', 'derivePriorityFromUrgency', 'priorityFallbackMode', 'rules'],
          },
        ],
      },
    },
    required: ['policy'],
  },
  ServiceSlaPolicy: {
    type: 'object',
    properties: {
      policy: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              scopeKey: { type: 'string' },
              version: { type: 'integer' },
              inheritWorkspace: { type: 'boolean' },
              baseAckTargetMs: { type: ['integer', 'null'] },
              baseResolveTargetMs: { type: ['integer', 'null'] },
              rules: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
                    ackTargetMs: { type: 'integer' },
                    resolveTargetMs: { type: 'integer' },
                    label: { type: ['string', 'null'] },
                  },
                  required: ['priority', 'ackTargetMs', 'resolveTargetMs', 'label'],
                },
              },
            },
            required: ['scopeKey', 'version', 'inheritWorkspace', 'baseAckTargetMs', 'baseResolveTargetMs', 'rules'],
          },
        ],
      },
    },
    required: ['policy'],
  },
  RunbookExecutionStarted: {
    type: 'object',
    properties: {
      executionId: { type: 'string' },
      status: { type: 'string' },
      runbookId: { type: 'string' },
      incidentId: { type: ['string', 'null'] },
      serviceId: { type: ['string', 'null'] },
      message: { type: 'string' },
    },
    required: ['executionId', 'status', 'runbookId'],
  },
  RunbookStep: {
    type: 'object',
    description:
      'Read-only step summary. Step configuration (commands, URLs, environment, secret references) is never returned.',
    properties: {
      key: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      riskClass: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      requiresApproval: { type: 'boolean' },
      requiresAgent: { type: 'boolean' },
      timeoutSeconds: { type: ['integer', 'null'] },
      maxRetries: { type: ['integer', 'null'] },
      precheckSteps: { type: 'array', items: { $ref: '#/components/schemas/RunbookStep' } },
      verificationSteps: { type: 'array', items: { $ref: '#/components/schemas/RunbookStep' } },
    },
    required: ['key', 'name', 'type', 'requiresApproval', 'requiresAgent'],
  },
  ServiceAccountTokenIssued: {
    type: 'object',
    description: 'The `token` value is shown exactly once and cannot be retrieved again.',
    properties: {
      token: { type: 'string' },
      apiKey: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          prefix: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
        required: ['id', 'name', 'prefix', 'scopes', 'createdAt'],
      },
    },
    required: ['token', 'apiKey'],
  },
};

const rateLimitHeaders: Json = {
  'X-RateLimit-Limit': { description: 'Requests allowed per window.', schema: { type: 'integer' } },
  'X-RateLimit-Remaining': {
    description: 'Requests left in the window.',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Unix time at which the window resets.',
    schema: { type: 'integer' },
  },
};

const extraResponses: Json = {
  RateLimited: {
    description:
      'Rate limit exceeded, or authentication attempts are being throttled. Wait Retry-After seconds.',
    headers: {
      'Retry-After': {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer' },
      },
      ...rateLimitHeaders,
    },
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  },
  PreconditionFailed: {
    description: 'If-Match did not match the current ETag; the resource changed since it was read.',
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  },
  Conflict: {
    description:
      'The request conflicts with current state, or the Idempotency-Key was already used for a different request.',
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  },
};

function successEnvelope(op: V2OperationDefinition, paginated: boolean): Json {
  const ref = { $ref: `#/components/schemas/${op.schema}` };
  const data = op.kind === 'list' ? { type: 'array', items: ref } : ref;
  return {
    type: 'object',
    properties: {
      data,
      ...(paginated ? { pagination: { $ref: '#/components/schemas/Pagination' } } : {}),
      ...ENVELOPE_META,
    },
    required: ['data', 'requestId', 'timestamp'],
  };
}

function hasParam(operation: Json, name: string, location: string): boolean {
  return (operation.parameters ?? []).some((p: Json) => p.name === name && p.in === location);
}

function addParam(operation: Json, param: Json) {
  operation.parameters = [...(operation.parameters ?? []), param];
}

const successStatus = (operation: Json): string | undefined =>
  Object.keys(operation.responses ?? {}).find(code => code.startsWith('2'));

export function finalizeOpenApiSpec(base: Json): Json {
  const spec = convertNullable(base) as Json;
  for (const [path, methods] of Object.entries(enterpriseOpenApiPaths())) {
    // eslint-disable-next-line security/detect-object-injection -- path comes from the static enterprise operation catalog
    spec.paths[path] = { ...spec.paths[path], ...methods };
  }

  spec.components.schemas = {
    ...spec.components.schemas,
    ...ENTERPRISE_SCHEMAS,
    ...(convertNullable(extraSchemas) as Json),
  };
  spec.components.responses = { ...spec.components.responses, ...extraResponses };
  // Fields returned by GET /incidents/{id} that the base description omitted.
  Object.assign(spec.components.schemas.Incident.properties, {
    assigneeId: { type: ['string', 'null'] },
    team: {
      type: ['object', 'null'],
      properties: { id: { type: 'string' }, name: { type: 'string' } },
    },
    snoozedUntil: { type: ['string', 'null'], format: 'date-time' },
    slaPausedMs: {
      type: ['integer', 'null'],
      description: 'Milliseconds the SLA clock was paused.',
    },
    slaAckElapsedMs: { type: ['integer', 'null'] },
    slaResolveElapsedMs: { type: ['integer', 'null'] },
  });
  spec.components.schemas.Runbook.properties.steps = {
    type: 'array',
    items: { $ref: '#/components/schemas/RunbookStep' },
  };

  for (const definition of V2_OPERATIONS) {
    const operation = spec.paths?.[definition.path]?.[definition.method] as Json | undefined;
    if (!operation) continue;

    operation.operationId = definition.operationId;
    operation['x-required-scope'] = definition.scope;
    if (definition.operationId === 'getIncidentResponseActivity') {
      operation['x-additional-required-scopes'] = ['notifications:read', 'runbooks:read'];
    }
    if (definition.operationId === 'listRunbookExecutions') {
      operation['x-additional-required-scopes'] = ['incidents:read'];
    }
    if (definition.operationId === 'listIncidentRunbookExecutions') {
      operation['x-additional-required-scopes'] = ['runbooks:read'];
    }
    if (definition.operationId === 'listIncidentNotificationAttempts') {
      operation['x-additional-required-scopes'] = ['notifications:read'];
    }
    operation.description = [
      operation.description,
      `Requires API scope \`${definition.scope}\` (${API_SCOPE_REGISTRY[definition.scope as ApiScope]?.title ?? definition.scope}).`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const contractKey = `${definition.method.toUpperCase()} ${`/api/v2${definition.path}`.replace(/\{(\w+)\}/g, '[$1]')}`;
    // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
    const contract = V2_MUTATION_CONTRACT[contractKey];
    if (contract) {
      operation['x-idempotency'] = contract.idempotency;
      operation['x-concurrency'] = contract.concurrency;
      if (
        (contract.idempotency === 'required' || contract.idempotency === 'supported') &&
        !hasParam(operation, 'Idempotency-Key', 'header')
      ) {
        addParam(operation, {
          name: 'Idempotency-Key',
          in: 'header',
          required: contract.idempotency === 'required',
          description:
            'Makes retries safe. A replay returns the original result with `Idempotency-Replayed: true`. ' +
            'Keys are scoped to the credential and operation and retained for 7 days; reusing a key with a different body returns 409.',
          schema: { type: 'string', minLength: 1, maxLength: 200 },
        });
      }
      if (contract.concurrency === 'etag' && !hasParam(operation, 'If-Match', 'header')) {
        addParam(operation, {
          name: 'If-Match',
          in: 'header',
          required: contract.preconditionRequired ?? false,
          description: contract.preconditionRequired
            ? 'Concrete strong revision ETag from the resource read documented for this operation. Wildcards are rejected (400); stale or weak validators return 412.'
            : 'ETag from a previous read. The change is applied only if the resource is unchanged; otherwise 412.',
          schema: { type: 'string' },
        });
      }
    }

    // Request examples are the samples that tests validate against the runtime Zod schemas.
    const sample = ENDPOINT_SAMPLES[`${definition.method.toUpperCase()} ${definition.path}`];
    const jsonBody = operation.requestBody?.content?.['application/json'];
    if (sample && jsonBody && !jsonBody.example) jsonBody.example = sample;

    const responses = (operation.responses ??= {}) as Json;
    const okCode = successStatus(operation);
    if (okCode && definition.kind !== 'none') {
      // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
      const ok = responses[okCode] as Json;
      if (definition.kind === 'binary') {
        ok.content = { 'application/json': { schema: { type: 'string', format: 'binary' } } };
        ok.headers = {
          ...(ok.headers ?? {}),
          'Content-Disposition': { description: 'Attachment filename.', schema: { type: 'string' } },
          'X-Content-SHA256': { description: 'SHA-256 checksum of the downloaded bytes.', schema: { type: 'string' } },
        };
      } else if (!ok.content) {
        const paginated = definition.kind === 'list' && hasParam(operation, 'limit', 'query');
        ok.content = {
          'application/json': { schema: successEnvelope(definition, paginated) },
        };
      }
      ok.headers = {
        ...(ok.headers ?? {}),
        ...rateLimitHeaders,
        ...((definition.method === 'get' && contractIsEtagResource(definition)) ||
        (definition.method === 'post' && definition.path === '/users/invitations')
          ? { ETag: etagHeader }
          : {}),
        ...(contract?.concurrency === 'etag' && contract.responseEtag !== false
          ? { ETag: etagHeader }
          : {}),
      };
    }

    if (definition.operationId === 'executeRunbook') {
      responses['412'] = { $ref: '#/components/responses/PreconditionFailed' };
    }
    if (!responses['429']) responses['429'] = { $ref: '#/components/responses/RateLimited' };
    if (contract?.preconditionRequired) {
      responses['428'] = {
        description: 'If-Match is required.',
        ...spec.components.responses.ProblemError,
      };
    }
    if (contract?.concurrency === 'etag' && !responses['412']) {
      responses['412'] = { $ref: '#/components/responses/PreconditionFailed' };
    }
    if (
      (contract?.idempotency === 'required' || contract?.idempotency === 'supported') &&
      !responses['409']
    ) {
      responses['409'] = { $ref: '#/components/responses/Conflict' };
    }
    if (!responses['401']) responses['401'] = { $ref: '#/components/responses/ProblemError' };
    responses.default = { $ref: '#/components/responses/ProblemError' };
  }

  spec.info.version = '2.0.0';
  return spec;
}

const etagHeader = {
  description:
    'Version of the resource. Send it back as If-Match to make a later change conditional.',
  schema: { type: 'string' },
};

const ETAG_RESOURCES = new Set([
  '/users/{id}/administration',
  '/users/{id}/invitation',
  '/teams/{id}/lead',
  '/teams/{id}/members',
  '/service-objectives/{id}',
  '/status-pages/{id}/publication',
  '/status-pages/{id}/services',
  '/status-pages/{id}/appearance',
  '/status-pages/{id}/privacy',
  '/status-pages/{id}/content',
  '/status-pages/{id}/settings',
  '/services/{id}/runbook-rules/{ruleId}',
  '/runbooks/{id}',
  '/runbooks/{id}/metadata',
  '/services/{id}/automation',
  '/teams/{id}',
  '/services/{id}',
  '/schedules/{id}',
  '/escalation-policies/{id}',
  '/integrations/{id}',
]);
function contractIsEtagResource(definition: V2OperationDefinition): boolean {
  return ETAG_RESOURCES.has(definition.path);
}
