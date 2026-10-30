import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { assertAdmin } from '@/lib/rbac';
import {
  STATUS_PAGE_SECTION_HEADER,
  statusPageSectionFields,
} from '@/lib/status-pages/settings-sections';
import { POST } from '@/app/api/settings/status-page/route';
import { z } from 'zod/v3';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ pageId: string; section: string }> }
) {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Unauthorized', 403);
  }
  const { pageId, section } = await context.params;
  const fields = statusPageSectionFields(section);
  if (!fields) return jsonError('Unknown settings section.', 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON.', 400);
  }
  const parsed = z.record(z.unknown()).safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).some(key => !fields.has(key)))
    return jsonError('Settings do not belong to this section.', 400);
  if (!z.string().datetime().safeParse(parsed.data.expectedUpdatedAt).success)
    return jsonError('Reload this page before saving.', 409);
  if (parsed.data.id !== undefined && parsed.data.id !== pageId)
    return jsonError('Status page identity mismatch.', 400);
  return POST(
    new NextRequest(request.url, {
      method: 'POST',
      headers: { ...Object.fromEntries(request.headers), [STATUS_PAGE_SECTION_HEADER]: section },
      body: JSON.stringify({ ...parsed.data, id: pageId }),
    })
  );
}
