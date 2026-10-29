import { z } from 'zod/v3';

// Deliberately 24 days, not 30: incident snapshots are signed PostgreSQL INTEGER ms.
export const MAX_INCIDENT_SLA_TARGET_MS = 24 * 24 * 60 * 60 * 1000;
const target = z.number().int().positive().max(MAX_INCIDENT_SLA_TARGET_MS);
export const incidentSlaPolicyInputSchema = z
  .object({
    scopeKey: z
      .string()
      .regex(/^(workspace|service:.+)$/)
      .max(256),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    inheritWorkspace: z.boolean(),
    baseAckTargetMs: target.nullable(),
    baseResolveTargetMs: target.nullable(),
    rules: z
      .array(
        z
          .object({
            priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']),
            ackTargetMs: target,
            resolveTargetMs: target,
            label: z.string().trim().max(120).optional(),
          })
          .strict()
      )
      .max(5),
  })
  .strict()
  .superRefine((input, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (input.scopeKey === 'workspace' && input.inheritWorkspace) {
      issue('Workspace policy cannot inherit from another scope.');
    }
    if (input.inheritWorkspace) {
      if (input.baseAckTargetMs !== null || input.baseResolveTargetMs !== null)
        issue('Inherited policy must not contain base targets.');
    } else if (input.baseAckTargetMs === null || input.baseResolveTargetMs === null) {
      issue('Both base targets are required when not inheriting.');
    }
    if (
      input.baseAckTargetMs !== null &&
      input.baseResolveTargetMs !== null &&
      input.baseAckTargetMs > input.baseResolveTargetMs
    )
      issue('Acknowledgement target must not exceed resolution target.');
    if (new Set(input.rules.map(rule => rule.priority)).size !== input.rules.length)
      issue('Duplicate priority rules are not allowed.');
    for (const rule of input.rules)
      if (rule.ackTargetMs > rule.resolveTargetMs)
        issue(`${rule.priority}: acknowledgement target must not exceed resolution target.`);
  });
export type IncidentSlaPolicyInput = z.infer<typeof incidentSlaPolicyInputSchema>;
