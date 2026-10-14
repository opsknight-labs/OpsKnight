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
import { makeDefaultStatusPage, StatusPageAdminError } from '@/lib/status-pages/admin';
import { applyStatusPageConfigurationChange } from '@/lib/status-pages/publish-configuration';
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
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const dto = {
      id: page.id,
      name: page.name,
      slug: page.slug,
      isDefault: page.isDefault,
      enabled: page.enabled,
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
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = StatusPageUpdateV2Schema.parse(body);

    const isDefaultSpecified = validated.isDefault !== undefined;
    const hasConfigChanges =
      validated.name !== undefined ||
      validated.slug !== undefined ||
      validated.enabled !== undefined;

    if (isDefaultSpecified && hasConfigChanges) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage:
          'Updating default status page designation and general configuration in a single request is not supported. Please update default status page designation and general configuration attributes separately.',
      });
    }

    if (existing.isDefault && validated.isDefault === false) {
      throw new AppError({
        code: 'STATUS_PAGE_DEFAULT_REPLACEMENT_REQUIRED',
        userMessage: 'Cannot unset default status page directly. Designate another status page as default instead.',
      });
    }

    try {
      if (validated.isDefault === true && !existing.isDefault) {
        await makeDefaultStatusPage(id);
      }

      const hasConfigChanges =
        validated.name !== undefined ||
        validated.slug !== undefined ||
        validated.enabled !== undefined;

      if (hasConfigChanges) {
        await applyStatusPageConfigurationChange({
          pageId: id,
          actor: { id: actor.id, name: apiKey.name },
          patch: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.slug !== undefined ? { slug: validated.slug } : {}),
            ...(validated.enabled !== undefined ? { enabled: validated.enabled } : {}),
          },
        });
      }
    } catch (err) {
      if (err instanceof StatusPageAdminError) {
        throw new AppError({
          code: err.code,
          userMessage: err.message,
        });
      }
      throw err;
    }

    const updated = await prisma.statusPage.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        isDefault: true,
        enabled: true,
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
