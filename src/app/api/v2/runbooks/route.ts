import { z } from 'zod';
import { runbookReadWhere } from '@/lib/authorization-filters';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { CreateRunbookV2Schema, projectAuthoringVersion } from '@/lib/api-v2/runbook-authoring';
import { createRunbook } from '@/lib/runbooks/versioning';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  parsePaginationParams,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const search = searchParams.get('search')?.trim();

    const filters: Prisma.RunbookWhereInput[] = [
      runbookReadWhere(actor),
      { archivedAt: null },
      { publishedVersionId: { not: null } },
    ];

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.RunbookWhereInput);
    }

    const where: Prisma.RunbookWhereInput = { AND: filters };

    const runbooks = await prisma.runbook.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        publishedVersion: {
          select: {
            id: true,
            version: true,
            publishedAt: true,
          },
        },
        _count: {
          select: {
            executions: true,
            bindings: true,
          },
        },
      },
    });

    const mapped = runbooks.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      version: r.publishedVersion?.version ?? 1,
      publishedAt: r.publishedVersion?.publishedAt ?? null,
      executionCount: r._count.executions,
      bindingCount: r._count.bindings,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    const result = formatCursorPagination(mapped, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  bodySchema: CreateRunbookV2Schema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    const runbook = await createRunbook(body, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return {
      status: 201,
      data: {
        id: runbook.id,
        name: runbook.name,
        slug: runbook.slug,
        description: runbook.description,
        draftVersionId: runbook.draftVersionId,
        draftVersion: projectAuthoringVersion(runbook.draftVersion),
      },
      headers: { Location: `/api/v2/runbooks/${runbook.id}/versions` },
    };
  },
});
