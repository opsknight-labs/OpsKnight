import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  StatusPageUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_READ);

    const { id } = await params;
    const page = await prisma.statusPage.findUnique({
      where: { id },
      include: {
        services: {
          include: {
            service: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    if (!page) {
      throw new AppError({
        code: 'STATUS_PAGE_NOT_FOUND',
        status: 404,
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const dto = {
      id: page.id,
      name: page.name,
      slug: page.slug,
      isDefault: page.isDefault,
      enabled: page.enabled,
      description: page.description,
      services: page.services.map(s => s.service),
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE);

    const { id } = await params;
    const existing = await prisma.statusPage.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError({
        code: 'STATUS_PAGE_NOT_FOUND',
        status: 404,
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = StatusPageUpdateV2Schema.parse(body);

    const updated = await prisma.statusPage.update({
      where: { id },
      data: {
        name: validated.name,
        slug: validated.slug,
        isDefault: validated.isDefault,
        description: validated.description,
        enabled: validated.enabled,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isDefault: true,
        enabled: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logV2Audit({
      action: 'status_page.updated',
      entityType: 'STATUS_PAGE',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: validated,
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
