import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { ReportMetricKeySchema } from './report-query';

const metrics = z.array(ReportMetricKeySchema).min(1).max(16).refine(
  keys => new Set(keys).size === keys.length,
  'Metric keys must be unique.'
);

export const SavedReportCreateV2Schema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  metrics,
  windowDays: z.number().int().min(1).max(90).default(30),
  serviceId: z.string().trim().min(1).max(100).nullish(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'PUBLIC']).default('PRIVATE'),
  teamId: z.string().min(1).nullish(),
}).strict();

export const SavedReportUpdateV2Schema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  metrics: metrics.optional(),
  windowDays: z.number().int().min(1).max(90).optional(),
  serviceId: z.string().trim().min(1).max(100).nullish(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'PUBLIC']).optional(),
  teamId: z.string().min(1).nullish(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required.');

export const SavedReportListV2Schema = z.object({
  limit: z.string().optional(), cursor: z.string().optional(),
  search: z.string().trim().max(200).optional(),
}).strict();

export const SavedReportIdV2Schema = z.object({ id: z.string().min(1) });

export function savedReportReadWhere(actor: AuthorizationActor): Prisma.SavedReportWhereInput {
  return {
    OR: [
      { userId: actor.id },
      { visibility: 'PUBLIC' },
      { visibility: 'TEAM', team: { members: { some: { userId: actor.id } } } },
    ],
  };
}
