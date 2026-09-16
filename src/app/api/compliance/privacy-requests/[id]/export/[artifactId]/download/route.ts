import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { downloadExportArtifact } from '@/lib/privacy/export/artifact';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const actor = await assertCapability(CAPABILITIES.PRIVACY_EXPORT);
    const { id, artifactId } = await params;

    // Belt-and-suspenders: the artifact must actually belong to the request in
    // the URL, not just exist somewhere. Its own ID is already unguessable.
    const artifact = await prisma.privacyExportArtifact.findUnique({
      where: { id: artifactId },
      select: { requestId: true },
    });
    if (!artifact || artifact.requestId !== id) {
      return jsonError(new AppError({ code: 'PRIVACY_EXPORT_NOT_FOUND' }));
    }

    const { buffer, requestId } = await downloadExportArtifact(artifactId, { id: actor.id });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="opsknight-privacy-export-${requestId}.zip"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
