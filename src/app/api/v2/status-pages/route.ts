import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  logV2Audit,
  parsePaginationParams,
  StatusPageCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { createStatusPage, StatusPageAdminError } from '@/lib/status-pages/admin';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const search = searchParams.get('search')?.trim();

    const filters: Prisma.StatusPageWhereInput[] = [];
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.StatusPageWhereInput);
    }

    const where: Prisma.StatusPageWhereInput = filters.length > 0 ? { AND: filters } : {};

    const pages = await prisma.statusPage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        isDefault: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            services: true,
            subscriptions: true,
          },
        },
      },
    });

    const mapped = pages.map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      isDefault: p.isDefault,
      enabled: p.enabled,
      serviceCount: p._count.services,
      subscriberCount: p._count.subscriptions,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    const result = formatCursorPagination(mapped, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = StatusPageCreateV2Schema.parse(body);

    const page = await createStatusPage({
      name: validated.name,
      slug: validated.slug,
      makeDefault: validated.isDefault,
    });

    await logV2Audit({
      action: 'status_page.created',
      entityType: 'STATUS_PAGE',
      entityId: page.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: page.name, slug: page.slug },
    });

    return apiV2Created(page, { headers: rlHeaders });
  } catch (error) {
    if (error instanceof StatusPageAdminError) {
      return apiV2Error(
        new AppError({
          code: error.code,
          userMessage: error.message,
        }),
        req
      );
    }
    return apiV2Error(error, req);
  }
}
