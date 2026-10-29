import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, assertCanViewService, getUserPermissions } from '@/lib/rbac';
import { sanitizeCompressedArtifact } from '@/lib/runbooks/artifact-safety';
import { emitAuditEvent } from '@/lib/audit';
import { createHash } from 'node:crypto';
import { jsonError } from '@/lib/api-response';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const permissions = await getUserPermissions();
    if (!permissions.capabilities.includes(CAPABILITIES.RUNBOOK_ARTIFACT_DOWNLOAD))
      return jsonError('Sensitive Runbook artifact download permission required.', 403);
    const canReadAll = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL);
    if (!canReadAll && !permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED))
      return jsonError('Runbook read permission required.', 403);
    const { id } = await context.params;
    const boundary = await prisma.runbookArtifact.findUnique({
      where: { id: z.string().cuid().parse(id) },
      select: {
        attempt: {
          select: {
            executionStep: {
              select: { execution: { select: { id: true, incidentId: true, serviceId: true } } },
            },
          },
        },
      },
    });
    if (!boundary) return jsonError('Runbook artifact not found.', 404);
    if (!canReadAll) {
      const execution = boundary.attempt.executionStep.execution;
      if (execution.incidentId) await assertCanViewIncident(execution.incidentId);
      else if (execution.serviceId) await assertCanViewService(execution.serviceId);
      else return jsonError('Runbook artifact has no scoped access boundary.', 403);
    }
    const artifact = await prisma.runbookArtifact.findUnique({
      where: { id: z.string().cuid().parse(id) },
    });
    if (!artifact) return jsonError('Runbook artifact not found.', 404);
    const sanitized = await sanitizeCompressedArtifact(artifact.content);
    await emitAuditEvent({
      action: 'runbook.artifact.downloaded',
      source: 'UI',
      target: { type: 'RUNBOOK_EXECUTION', id: boundary.attempt.executionStep.execution.id },
      actor: { type: 'USER', id: permissions.id },
      metadata: {
        artifactId: artifact.id,
        attemptId: artifact.attemptId,
        sanitizedBytes: sanitized.content.length,
      },
    });
    return new Response(new Uint8Array(sanitized.content), {
      headers: {
        'x-content-sha256': createHash('sha256').update(sanitized.content).digest('hex'),
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
