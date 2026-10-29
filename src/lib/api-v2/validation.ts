import { z } from 'zod/v3';
import { APP_ROLES, isApiScope } from '@/lib/authorization';
import { INTEGRATION_TYPES } from '@/lib/integrations/catalog';

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
});

export const IncidentListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).optional(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  serviceId: z.string().trim().min(1).optional(),
  assigneeId: z.string().trim().min(1).optional(),
  teamId: z.string().trim().min(1).optional(),
  search: z.string().trim().max(100).optional(),
});

export const IncidentCreateV2Schema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().trim().max(10000).optional().nullable(),
    serviceId: z.string().trim().min(1, 'Service ID is required'),
    urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('HIGH'),
    priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).optional().nullable(),
    assigneeId: z.string().trim().optional().nullable(),
    teamId: z.string().trim().optional().nullable(),
    dedupKey: z.string().trim().max(255).optional().nullable(),
    customFields: z
      .array(
        z.object({
          fieldId: z.string().trim().min(1),
          value: z.string(),
        })
      )
      .optional(),
  })
  .refine(data => !(data.assigneeId && data.teamId), {
    message: 'Assign an incident to either a user or a team, not both.',
    path: ['assigneeId'],
  });

export const IncidentUpdateV2Schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).optional().nullable(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
  assigneeId: z.string().trim().nullable().optional(),
});

export const IncidentAcknowledgeV2Schema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const IncidentResolveV2Schema = z.object({
  resolutionNote: z.string().trim().max(2000).optional(),
  resolutionKind: z
    .enum(['MANUAL', 'SOURCE_RECOVERY', 'AUTOMATION', 'AUTO_TIMEOUT', 'UNKNOWN'])
    .optional(),
});

export const IncidentAssignV2Schema = z
  .object({
    assigneeId: z.string().trim().nullable().optional(),
    teamId: z.string().trim().nullable().optional(),
  })
  .refine(data => !(data.assigneeId && data.teamId), {
    message: 'Assign an incident to either a user or a team, not both.',
    path: ['assigneeId'],
  })
  .refine(data => data.assigneeId !== undefined || data.teamId !== undefined, {
    // An empty body must not silently unassign; unassigning is an explicit null.
    message: 'Provide assigneeId or teamId. Use null to unassign.',
    path: ['assigneeId'],
  });

export const IncidentNoteV2Schema = z.object({
  content: z.string().trim().min(1, 'Note content cannot be empty').max(5000),
});

export const SERVICE_STATUS_VALUES = [
  'OPERATIONAL',
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
  'MAINTENANCE',
] as const;

export const ServiceListQuerySchema = PaginationQuerySchema.extend({
  teamId: z.string().trim().min(1).optional(),
  status: z.enum(SERVICE_STATUS_VALUES).optional(),
  search: z.string().trim().max(100).optional(),
});

export const ServiceCreateV2Schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  teamId: z.string().trim().min(1, 'Team ID is required'),
  escalationPolicyId: z.string().trim().min(1, 'Escalation policy ID is required'),
  status: z.enum(SERVICE_STATUS_VALUES).default('OPERATIONAL'),
});

export const ServiceUpdateV2Schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  teamId: z.string().trim().min(1).optional(),
  escalationPolicyId: z.string().trim().min(1).optional(),
  status: z.enum(SERVICE_STATUS_VALUES).optional(),
});

export const TeamCreateV2Schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const TeamUpdateV2Schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const ScheduleCreateV2Schema = z.object({
  name: z.string().trim().min(2).max(100),
  timeZone: z.string().trim().min(1).default('UTC'),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const ScheduleUpdateV2Schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  timeZone: z.string().trim().min(1).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const ScheduleOverrideV2Schema = z.object({
  userId: z.string().trim().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  replacesUserId: z.string().trim().optional().nullable(),
});

export const EscalationStepConditionSchema = z.object({
  field: z.enum(['PRIORITY', 'URGENCY', 'SUPPORT_HOURS_STATE']),
  operator: z.enum(['IN', 'NOT_IN', 'EQUALS', 'NOT_EQUALS']),
  values: z.array(z.string()).min(1),
});

export const EscalationStepSchema = z.object({
  delayMinutes: z.number().int().min(0).max(1440),
  targetType: z.enum(['USER', 'SCHEDULE', 'TEAM']),
  targetId: z.string().trim().min(1),
  notificationChannels: z
    .array(
      z.enum(['EMAIL', 'SMS', 'VOICE', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP', 'MICROSOFT_TEAMS'])
    )
    .optional(),
  notifyOnlyTeamLead: z.boolean().optional(),
  conditions: z.array(EscalationStepConditionSchema).optional(),
});

export const EscalationPolicyCreateV2Schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  steps: z.array(EscalationStepSchema).min(1, 'At least one escalation step is required'),
});

export const EscalationPolicyUpdateV2Schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  steps: z.array(EscalationStepSchema).optional(),
});

export const IntegrationUpdateV2Schema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    snsTopicArn: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^arn:(aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/)
      .optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one supported field is required.');

export const IntegrationCreateV2Schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(INTEGRATION_TYPES).default('EVENTS_API_V2'),
    snsTopicArn: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'CLOUDWATCH' && !value.snsTopicArn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snsTopicArn'],
        message: 'CloudWatch requires an SNS topic ARN.',
      });
    }
    if (
      value.snsTopicArn &&
      !/^arn:(aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(
        value.snsTopicArn
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snsTopicArn'],
        message: 'A valid exact AWS SNS Topic ARN is required.',
      });
    }
  });

export const IntegrationTestV2Schema = z
  .object({
    payload: z.unknown().optional(),
  })
  .strict();

export const IntegrationCredentialRotateV2Schema = z
  .object({
    credential: z.enum(['routing-key', 'signature-secret']).default('signature-secret'),
    overlapSeconds: z.number().int().min(0).max(86400).default(3600),
  })
  .strict();

export const StatusPageCreateV2Schema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must consist of lowercase letters, numbers, and hyphens'),
  isDefault: z.boolean().default(false),
  // Status pages have no description column; reject rather than silently drop it.
  description: z
    .never({ message: 'description is not supported for status pages over REST.' })
    .optional(),
});

export const StatusPageUpdateV2Schema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  isDefault: z.boolean().optional(),
  description: z
    .never({ message: 'description is not supported for status pages over REST.' })
    .optional(),
  enabled: z.boolean().optional(),
});

export const StatusPageAnnouncementV2Schema = z.object({
  title: z.string().trim().min(2).max(200),
  message: z.string().trim().min(1).max(5000),
  type: z.string().trim().default('INFO'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
  isActive: z.boolean().default(true),
  services: z.array(z.string().trim().min(1)).optional(),
});

export const RunbookExecuteV2Schema = z.object({
  expectedPlanDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  incidentId: z.string().trim().optional().nullable(),
  serviceId: z.string().trim().optional().nullable(),
  bindingId: z.string().trim().optional().nullable(),
  parameters: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .describe(
      'Inputs for unbound execution only; service rules use saved inputs and reject non-empty per-execution parameters.'
    ),
});

export const ServiceAccountCreateV2Schema = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.enum(APP_ROLES as unknown as [string, ...string[]]).default('RESPONDER'),
  description: z.string().trim().max(1000).optional(),
  teamIds: z.array(z.string().trim().min(1)).optional(),
});

export const ServiceAccountTokenIssueV2Schema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(
      z.string().trim().refine(isApiScope, {
        message: 'Invalid API scope. Scopes must belong to the API scope registry.',
      })
    )
    .min(1, 'At least one scope is required'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  /** Explicit decision to issue a token without an expiry; mutually exclusive with expiresInDays. */
  neverExpires: z.boolean().optional(),
});

export const PostmortemListQuerySchema = z.object({
  incidentId: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
  isPublic: z
    .enum(['true', 'false'])
    .optional()
    .transform(val => (val === undefined ? undefined : val === 'true')),
  search: z.string().trim().max(100).optional(),
});

export const PostmortemImpactV2Schema = z
  .object({
    usersAffected: z.number().int().min(0).max(1_000_000_000).optional(),
    downtimeMinutes: z.number().int().min(0).max(10_000_000).optional(),
    errorRate: z.number().min(0).max(100).optional(),
    servicesAffected: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    slaBreaches: z.number().int().min(0).max(1_000_000_000).optional(),
    revenueImpact: z.number().min(0).max(1_000_000_000_000).optional(),
    apiErrors: z.number().int().min(0).max(1_000_000_000).optional(),
    performanceDegradation: z.number().min(0).max(100).optional(),
  })
  .strict();

export const PostmortemTimelineV2Schema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(100),
        timestamp: z.string().datetime(),
        type: z.enum(['DETECTION', 'ESCALATION', 'MITIGATION', 'RESOLUTION']),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000),
        actor: z.string().trim().max(200).optional(),
      })
      .strict()
  )
  .max(100)
  .refine(
    events => new Set(events.map(event => event.id)).size === events.length,
    'Timeline event IDs must be unique.'
  );

export const PostmortemFactorsV2Schema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(100),
        category: z.enum(['TECHNICAL', 'PROCESS', 'HUMAN', 'EXTERNAL', 'OTHER']),
        description: z.string().trim().min(1).max(2000),
        evidence: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
      })
      .strict()
  )
  .max(30)
  .refine(
    entries => new Set(entries.map(entry => entry.id)).size === entries.length,
    'Contributing-factor IDs must be unique.'
  );

export const PostmortemFiveWhysV2Schema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(100),
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().min(1).max(2000),
      })
      .strict()
  )
  .max(10)
  .refine(
    entries => new Set(entries.map(entry => entry.id)).size === entries.length,
    'Five-whys step IDs must be unique.'
  );

export const PostmortemCreateV2Schema = z
  .object({
    incidentId: z.string().trim().min(1),
    title: z.string().trim().min(2).max(200).optional(),
    summary: z.string().trim().min(5).max(5000),
    rootCause: z.string().trim().max(5000).optional(),
    resolution: z.string().trim().max(5000).optional(),
    mitigation: z.string().trim().max(5000).optional(),
    impact: PostmortemImpactV2Schema.optional(),
    timeline: PostmortemTimelineV2Schema.optional(),
    contributingFactors: PostmortemFactorsV2Schema.optional(),
    fiveWhys: PostmortemFiveWhysV2Schema.optional(),
    lessons: z.string().trim().max(5000).optional(),
    status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED']).default('DRAFT'),
    isPublic: z.boolean().default(true),
  })
  .strict();

export const PostmortemUpdateV2Schema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    summary: z.string().trim().min(5).max(5000).optional(),
    rootCause: z.string().trim().max(5000).optional(),
    resolution: z.string().trim().max(5000).optional(),
    mitigation: z.string().trim().max(5000).optional(),
    impact: PostmortemImpactV2Schema.optional(),
    timeline: PostmortemTimelineV2Schema.optional(),
    contributingFactors: PostmortemFactorsV2Schema.optional(),
    fiveWhys: PostmortemFiveWhysV2Schema.optional(),
    lessons: z.string().trim().max(5000).optional(),
    status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
    isPublic: z.boolean().optional(),
  })
  .strict();
