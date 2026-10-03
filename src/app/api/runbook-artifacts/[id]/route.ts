import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
    const { id } = await context.params;
    const artifact = await prisma.runbookArtifact.findUnique({
      where: { id: z.string().cuid().parse(id) },
    });
    if (!artifact) return jsonError('Runbook artifact not found.', 404);
    return new Response(new Uint8Array(artifact.content), {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="runbook-${artifact.attemptId}.log.gz"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
