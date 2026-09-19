import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isStatusPageSlug } from '@/lib/validation';
import {
  createStatusPage,
  deleteStatusPage,
  StatusPageAdminError,
  MAX_STATUS_PAGES,
} from '@/lib/status-pages/admin';

const CreatePageSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().refine(isStatusPageSlug, 'Invalid status page slug.'),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  try {
    await assertAdmin();
    const pages = await prisma.statusPage.findMany({
      select: { id: true, name: true, slug: true, isDefault: true, enabled: true, updatedAt: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return jsonOk({ pages, canCreate: pages.length < MAX_STATUS_PAGES }, 200);
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
    const page = await createStatusPage({
      name: parsed.data.name,
      slug: parsed.data.slug,
      makeDefault: parsed.data.isDefault,
    });
    return jsonOk({ page }, 201);
  } catch (error) {
    if (error instanceof StatusPageAdminError && error.code === 'STATUS_PAGE_LIMIT_REACHED') {
      return jsonError(error.message, 403, { code: error.code });
    }
    return jsonError('Failed to create status page.', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return jsonError('Status page id is required.', 400);
    const replacementDefaultId = new URL(req.url).searchParams.get('replacementDefaultId');
    await deleteStatusPage(id, replacementDefaultId || undefined);
    return jsonOk({ success: true }, 200);
  } catch (error) {
    return jsonError(
      error instanceof StatusPageAdminError ? error.message : 'Failed to delete status page.',
      error instanceof StatusPageAdminError && error.code === 'STATUS_PAGE_NOT_FOUND' ? 404 : 409
    );
  }
}
