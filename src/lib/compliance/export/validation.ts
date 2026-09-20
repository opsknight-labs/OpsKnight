import { z } from 'zod';
import type { ComplianceFramework } from '../types';

export const MAX_SELECTED_CONTROLS = 50;
export const MAX_HISTORICAL_DAYS = 366;
export const MAX_EVIDENCE_RECORDS = 10_000;
export const MAX_UNCOMPRESSED_PACKAGE_BYTES = 50 * 1024 * 1024; // 50MB

export const COMPLIANCE_FRAMEWORK_ENUM = [
  'GDPR',
  'CRA',
  'SOC2',
  'ISO27001',
  'ISO27701',
  'DPDP',
  'CCPA',
] as const satisfies readonly ComplianceFramework[];

const deploymentScopeSchema = z.object({
  type: z.literal('DEPLOYMENT'),
});

const frameworkScopeSchema = z.object({
  type: z.literal('FRAMEWORK'),
  framework: z.enum(COMPLIANCE_FRAMEWORK_ENUM),
});

const controlsScopeSchema = z.object({
  type: z.literal('CONTROLS'),
  controlIds: z
    .array(z.string().trim().min(1, 'Control ID cannot be empty').max(64))
    .min(1, 'At least one control ID must be specified')
    .max(
      MAX_SELECTED_CONTROLS,
      `Cannot select more than ${MAX_SELECTED_CONTROLS} controls in a single export`
    )
    .refine(ids => new Set(ids).size === ids.length, {
      message: 'Duplicate control IDs are not permitted',
    }),
});

export const evidencePackageScopeSchema = z.discriminatedUnion('type', [
  deploymentScopeSchema,
  frameworkScopeSchema,
  controlsScopeSchema,
]);

const snapshotEvidenceSchema = z.object({
  mode: z.literal('SNAPSHOT'),
});

const historicalEvidenceSchema = z.object({
  mode: z.literal('HISTORICAL'),
  from: z.string().datetime({ message: 'from must be a valid ISO 8601 timestamp' }),
  to: z.string().datetime({ message: 'to must be a valid ISO 8601 timestamp' }),
});

export const evidenceSelectionSchema = z
  .discriminatedUnion('mode', [snapshotEvidenceSchema, historicalEvidenceSchema])
  .superRefine((data, ctx) => {
    if (data.mode === 'HISTORICAL') {
      const fromDate = new Date(data.from);
      const toDate = new Date(data.to);

      if (fromDate.getTime() > toDate.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from timestamp must be earlier than or equal to to timestamp',
          path: ['from'],
        });
        return;
      }

      const now = Date.now();
      // Allow up to 5 minutes future clock skew
      if (toDate.getTime() > now + 5 * 60 * 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'to timestamp cannot be in the future',
          path: ['to'],
        });
        return;
      }

      const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_HISTORICAL_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Historical evidence date range cannot exceed ${MAX_HISTORICAL_DAYS} days`,
          path: ['to'],
        });
      }
    }
  });

export const exportRequestSchema = z.object({
  scope: evidencePackageScopeSchema,
  evidence: evidenceSelectionSchema,
});

export type ExportRequestInput = z.infer<typeof exportRequestSchema>;
