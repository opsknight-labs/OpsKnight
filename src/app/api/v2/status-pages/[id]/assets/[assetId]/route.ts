import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({
  id: z.string().cuid(), assetId: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const page = await prisma.statusPage.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!page) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
    const asset = await prisma.statusPageAsset.findFirst({
      where: { id: params.assetId, statusPageId: page.id },
      select: { id: true, contentType: true, createdAt: true },
    });
    if (!asset) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: {
      statusPageId: page.id, assetId: asset.id, contentType: asset.contentType, createdAt: asset.createdAt,
      url: `/api/status-page/logo/${encodeURIComponent(page.id)}?asset=${asset.id}`,
    }, headers: { 'Cache-Control': 'private, no-store' } };
  },
});

function referencesAsset(value: unknown, assetId: string): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value, 'https://opsknight.com');
      return url.searchParams.get('asset') === assetId;
    } catch { return false; }
  }
  if (Array.isArray(value)) return value.some(entry => referencesAsset(entry, assetId));
  if (value && typeof value === 'object') {
    return Object.values(value).some(entry => referencesAsset(entry, assetId));
  }
  return false;
}

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema, querySchema: z.object({}).strict(),
  idempotent: true, idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    if (!await tx!.statusPage.count({ where: { id: params.id } })) {
      throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
    }
  },
  handler: async ({ params, actor, apiKey, tx }) => {
    await tx!.$queryRaw`SELECT "id" FROM "StatusPage" WHERE "id" = ${params.id} FOR UPDATE`;
    const page = await tx!.statusPage.findUnique({
      where: { id: params.id }, select: { id: true, branding: true,
        snapshot: { select: { payload: true } } },
    });
    if (!page) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
    const asset = await tx!.statusPageAsset.findFirst({
      where: { id: params.assetId, statusPageId: page.id }, select: { id: true },
    });
    if (!asset) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (referencesAsset(page.branding, asset.id) || referencesAsset(page.snapshot?.payload, asset.id)) {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'The asset is still used by the draft or published page.' });
    }
    await tx!.statusPageAsset.delete({ where: { id: asset.id } });
    await logV2Audit({
      action: 'status_page.asset_deleted', entityType: 'STATUS_PAGE', entityId: page.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { assetId: asset.id }, tx,
    });
    return { status: 204 };
  },
});
