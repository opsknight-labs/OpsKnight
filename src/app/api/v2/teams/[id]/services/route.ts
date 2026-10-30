import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { teamParams, teamActor } from '@/lib/api-v2/team-administration';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireTeamAccess } from '@/lib/teams/administration';
import { buildCursorWhere, decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';
import { AppError } from '@/lib/errors';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ,
  paramsSchema: teamParams,
  querySchema: z
    .object({ limit: z.string().optional(), cursor: z.string().max(2048).optional() })
    .strict(),
  scopedFilter: true,
  handler: async context =>
    prisma.$transaction(
      async tx => {
        const team = await requireTeamAccess(tx, context.params.id, teamActor(context), false);
        if (context.pagination.cursor) {
          const cursor = decodeCursor(context.pagination.cursor);
          if (
            !(await tx.service.findFirst({
              where: { id: cursor.id, teamId: team.id, createdAt: new Date(cursor.createdAt) },
              select: { id: true },
            }))
          )
            throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
        }
        const rows = await tx.service.findMany({
          where: { teamId: team.id, ...buildCursorWhere(context.pagination.cursor) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: context.pagination.limit + 1,
          select: {
            id: true,
            name: true,
            teamId: true,
            revision: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return {
          ...formatCursorPagination(rows, context.pagination.limit),
          headers: { 'Cache-Control': 'no-store' },
        };
      },
      { isolationLevel: 'Serializable' }
    ),
});
