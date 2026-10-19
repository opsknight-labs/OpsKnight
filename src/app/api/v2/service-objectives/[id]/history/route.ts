import prisma from '@/lib/prisma';
import { z } from 'zod';
import { defineV2Route, type V2RouteHandlerResult } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ObjectiveParams } from '@/lib/api-v2/service-objectives';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import {
  readObjectiveSnapshots,
  readObjectiveLegacyHistory,
} from '@/lib/api-v2/service-objective-history';
type ObjectiveRecord = Awaited<ReturnType<typeof readObjectiveSnapshots>>['data'][number];
type LegacyRecord = Awaited<ReturnType<typeof readObjectiveLegacyHistory>>['data'][number];
type HistoryItem =
  | { source: 'OBJECTIVE'; id: string; periodEnd: Date; record: ObjectiveRecord }
  | { source: 'LEGACY_INCIDENT_SLA'; id: string; periodEnd: Date; record: LegacyRecord };
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: PaginationQuerySchema.extend({
    source: z.enum(['OBJECTIVE', 'LEGACY_INCIDENT_SLA']).default('OBJECTIVE'),
  }).strict(),
  handler: async ({
    actor,
    params,
    pagination,
    query,
  }): Promise<V2RouteHandlerResult<HistoryItem[]>> => {
    if (query.source === 'LEGACY_INCIDENT_SLA') {
      const page = await readObjectiveLegacyHistory(
        prisma,
        actor,
        params.id,
        pagination.limit,
        pagination.cursor
      );
      return {
        data: page.data.map(record => ({
          source: 'LEGACY_INCIDENT_SLA' as const,
          id: record.id,
          periodEnd: record.date,
          record,
        })),
        pagination: page.pagination,
        headers: { 'Cache-Control': 'no-store' },
      };
    }
    const page = await readObjectiveSnapshots(
      prisma,
      actor,
      params.id,
      pagination.limit,
      pagination.cursor
    );
    return {
      data: page.data.map(record => ({
        source: 'OBJECTIVE' as const,
        id: record.id,
        periodEnd: record.periodEnd,
        record,
      })),
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
