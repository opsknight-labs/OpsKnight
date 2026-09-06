import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isStatusPageSlug } from '@/lib/validation';

const CreatePageSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().refine(isStatusPageSlug, 'Invalid status page slug.'),
  isDefault: z.boolean().optional(),
});

class DefaultPageDeleteError extends Error {}

export async function GET() {
  try {
    await assertAdmin();
    const pages = await prisma.statusPage.findMany({
      select: { id: true, name: true, slug: true, isDefault: true, enabled: true, updatedAt: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return jsonOk({ pages }, 200);
  } catch {
    return jsonError('Unauthorized', 403);
  }
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin();
    const parsed = CreatePageSchema.safeParse(await req.json());
    if (!parsed.success)
      return jsonError('Invalid status page.', 400, { issues: parsed.error.issues });
    const page = await prisma.$transaction(async tx => {
      const count = await tx.statusPage.count();
      const makeDefault = parsed.data.isDefault === true || count === 0;
      if (makeDefault)
        await tx.statusPage.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.statusPage.create({
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          isDefault: makeDefault,
          enabled: false,
        },
      });
    });
    return jsonOk({ page }, 201);
  } catch {
    return jsonError('Failed to create status page.', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return jsonError('Status page id is required.', 400);
    await prisma.$transaction(async tx => {
      const page = await tx.statusPage.findUnique({ where: { id }, select: { isDefault: true } });
      if (!page) return;
      if (page.isDefault && (await tx.statusPage.count()) > 1) {
        throw new DefaultPageDeleteError();
      }
      await tx.statusPage.delete({ where: { id } });
    });
    return jsonOk({ success: true }, 200);
  } catch (error) {
    return jsonError(
      error instanceof DefaultPageDeleteError
        ? 'Choose another default status page before deleting this page.'
        : 'Failed to delete status page.',
      409
    );
  }
}
