import { z } from 'zod/v3';
import { jsonError } from '@/lib/api-response';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { toPortableRunbook } from '@/lib/runbooks/portable';

export const dynamic = 'force-dynamic';

const inputSchema = z.object({ id: z.string().cuid(), version: z.string().cuid().optional() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  } catch {
    return jsonError('Runbook export unavailable or access denied.', 403);
  }
  const input = inputSchema.safeParse({
    ...(await params),
    version: new URL(request.url).searchParams.get('version') || undefined,
  });
  if (!input.success) return jsonError('Invalid runbook or version identifier.', 400);

  const runbook = await prisma.runbook.findUnique({
    where: { id: input.data.id },
    select: {
      name: true,
      slug: true,
      description: true,
      tags: true,
      publishedVersionId: true,
      draftVersionId: true,
    },
  });
  if (!runbook) return jsonError('Runbook not found.', 404);

  const versionId = input.data.version ?? runbook.publishedVersionId ?? runbook.draftVersionId;
  const version = versionId
    ? await prisma.runbookVersion.findFirst({
        where: { id: versionId, runbookId: input.data.id },
        select: {
          version: true,
          definition: true,
          inputs: { orderBy: { sequence: 'asc' } },
        },
      })
    : null;
  if (!version) return jsonError('Runbook version not found.', 404);

  const filename = `${runbook.slug.replace(/[^a-z0-9-]/g, '-')}-v${version.version}.runbook.json`;
  return new Response(JSON.stringify(toPortableRunbook(runbook, version), null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
