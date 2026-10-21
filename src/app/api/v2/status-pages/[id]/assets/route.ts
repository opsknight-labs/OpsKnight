import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { parseStatusPageLogo } from '@/lib/status-pages/assets';

const paramsSchema = z.object({ id: z.string().cuid() }).strict();

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ image: z.string().min(1).max(2_800_000) }).strict(),
  handler: async ({ params, body }) => {
    const parsed = parseStatusPageLogo(body.image);
    if (!parsed) throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Provide a valid PNG, JPEG, GIF, or WebP image up to 2 MiB.' });
    const assetId = createHash('sha256').update(params.id).update(parsed.buffer).digest('hex');
    await prisma.$transaction(async tx => {
      const pages = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StatusPage" WHERE "id" = ${params.id} FOR UPDATE
      `;
      if (!pages.length) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StatusPageAsset" WHERE "id" = ${assetId} AND "statusPageId" = ${params.id}
      `;
      if (existing.length) return;
      const count = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM "StatusPageAsset" WHERE "statusPageId" = ${params.id}
      `;
      if (count[0].count >= BigInt(20)) throw new AppError({
        code: 'VALIDATION_FAILED', userMessage: 'A status page can hold at most 20 branding assets.',
      });
      await tx.$executeRaw`
        INSERT INTO "StatusPageAsset" ("id", "statusPageId", "contentType", "data")
        VALUES (${assetId}, ${params.id}, ${parsed.mime}, ${parsed.buffer})
      `;
    });
    return {
      data: {
        assetId,
        url: `/api/status-page/logo/${encodeURIComponent(params.id)}?asset=${assetId}`,
        contentType: parsed.mime,
      },
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    };
  },
});
