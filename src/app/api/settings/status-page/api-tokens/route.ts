import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { StatusApiTokenCreateSchema, StatusApiTokenRevokeSchema } from '@/lib/validation';
import { generateApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  let admin: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    admin = await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = await req.json();
    } catch {
      return jsonError('Invalid JSON in request body.', 400);
    }

    const parsed = StatusApiTokenCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }

    const { statusPageId, name } = parsed.data;
    const { token, prefix, tokenHash } = generateApiKey();

    const apiToken = await prisma.$transaction(async tx => {
      const created = await tx.statusPageApiToken.create({
        data: {
          statusPageId,
          name: name.trim(),
          prefix,
          tokenHash,
        },
      });
      await logAudit(
        {
          action: 'status_page.api_token.created',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId: admin.id,
          details: { apiTokenId: created.id, name: created.name, prefix },
        },
        tx
      );
      return created;
    });

    logger.info('api.status_page.api_token.created', { apiTokenId: apiToken.id });
    return jsonOk({ token, apiToken }, 200);
  } catch (error) {
    logger.error('api.status_page.api_token.create_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to create token', 500);
  }
}

export async function DELETE(req: NextRequest) {
  let admin: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    admin = await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = await req.json();
    } catch {
      return jsonError('Invalid JSON in request body.', 400);
    }

    const parsed = StatusApiTokenRevokeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }

    const { id, statusPageId } = parsed.data;
    const existing = await prisma.statusPageApiToken.findFirst({ where: { id, statusPageId } });
    if (!existing) return jsonError('API token not found.', 404);
    const apiToken = await prisma.$transaction(async tx => {
      const revoked = await tx.statusPageApiToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await logAudit(
        {
          action: 'status_page.api_token.revoked',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId: admin.id,
          details: { apiTokenId: id, name: existing.name, prefix: existing.prefix },
        },
        tx
      );
      return revoked;
    });

    logger.info('api.status_page.api_token.revoked', { apiTokenId: apiToken.id });
    return jsonOk({ apiToken }, 200);
  } catch (error) {
    logger.error('api.status_page.api_token.revoke_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to revoke token', 500);
  }
}
