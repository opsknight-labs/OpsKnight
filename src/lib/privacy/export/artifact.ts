import 'server-only';

import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { encrypt, decrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors/app-error';
import { isAutomatedPrivacyRequestType } from '@/lib/privacy/requests';
import { generateSubjectExport } from './exporter';

export const EXPORT_ARTIFACT_TTL_HOURS = 72;

export interface ExportActor {
  id: string;
}

/**
 * Generates and stores an encrypted export artifact for a request. Emits
 * started/completed/failed audit events — never the exported content itself.
 */
export async function createExportArtifact(requestId: string, actor: ExportActor) {
  const request = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    throw new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
  }
  if (!isAutomatedPrivacyRequestType(request.requestType)) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: `${request.requestType} requests are not yet automated and require manual fulfilment.`,
    });
  }

  await emitAuditEvent({
    action: 'privacy.export.started',
    source: 'UI',
    target: { type: 'PRIVACY_REQUEST', id: requestId },
    actor: { type: 'USER', id: actor.id },
  });

  let generated: Awaited<ReturnType<typeof generateSubjectExport>>;
  try {
    generated = await generateSubjectExport({
      requestId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unknown export failure';
    const failed = await prisma.privacyExportArtifact.create({
      data: {
        requestId,
        status: 'FAILED',
        failureReason,
        expiresAt: new Date(Date.now() + EXPORT_ARTIFACT_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    await emitAuditEvent({
      action: 'privacy.export.failed',
      source: 'UI',
      target: { type: 'PRIVACY_EXPORT_ARTIFACT', id: failed.id },
      actor: { type: 'USER', id: actor.id },
      metadata: { requestId },
    });
    throw error;
  }

  const encryptedPayload = await encrypt(generated.buffer.toString('base64'));
  const expiresAt = new Date(Date.now() + EXPORT_ARTIFACT_TTL_HOURS * 60 * 60 * 1000);

  const artifact = await prisma.$transaction(async tx => {
    const created = await tx.privacyExportArtifact.create({
      data: {
        requestId,
        status: 'READY',
        encryptedPayload,
        checksum: generated.checksum,
        sizeBytes: generated.sizeBytes,
        expiresAt,
      },
    });

    await emitAuditEvent(
      {
        action: 'privacy.export.completed',
        source: 'UI',
        target: { type: 'PRIVACY_EXPORT_ARTIFACT', id: created.id },
        actor: { type: 'USER', id: actor.id },
        metadata: { requestId, checksum: generated.checksum, sizeBytes: generated.sizeBytes },
      },
      tx
    );

    return created;
  });

  // Never return encryptedPayload to callers — it is write-only from here on.
  const { encryptedPayload: _omit, ...safeArtifact } = artifact;
  return safeArtifact;
}

/**
 * Validates and decrypts an artifact for download. Re-downloads are allowed
 * until expiry (expiry + auth + audit are the controls, not single-use).
 */
export async function downloadExportArtifact(artifactId: string, actor: ExportActor) {
  const artifact = await prisma.privacyExportArtifact.findUnique({ where: { id: artifactId } });
  if (!artifact) {
    throw new AppError({ code: 'PRIVACY_EXPORT_NOT_FOUND' });
  }

  if (artifact.expiresAt.getTime() <= Date.now()) {
    if (artifact.status !== 'EXPIRED') {
      await expireArtifact(artifact.id);
    }
    throw new AppError({ code: 'PRIVACY_EXPORT_EXPIRED' });
  }

  if (artifact.status === 'FAILED' || artifact.status === 'PENDING') {
    throw new AppError({ code: 'PRIVACY_EXPORT_NOT_READY' });
  }
  if (artifact.status === 'EXPIRED' || !artifact.encryptedPayload) {
    throw new AppError({ code: 'PRIVACY_EXPORT_EXPIRED' });
  }

  const buffer = Buffer.from(await decrypt(artifact.encryptedPayload), 'base64');

  await prisma.$transaction(async tx => {
    await tx.privacyExportArtifact.update({
      where: { id: artifact.id },
      data: {
        status: 'DOWNLOADED',
        downloadCount: { increment: 1 },
        lastDownloadedAt: new Date(),
      },
    });
    await emitAuditEvent(
      {
        action: 'privacy.export.downloaded',
        source: 'UI',
        target: { type: 'PRIVACY_EXPORT_ARTIFACT', id: artifact.id },
        actor: { type: 'USER', id: actor.id },
        metadata: { requestId: artifact.requestId, checksum: artifact.checksum },
      },
      tx
    );
  });

  return { buffer, checksum: artifact.checksum, requestId: artifact.requestId };
}

/** Marks an artifact expired and discards its encrypted payload. Safe to call more than once. */
export async function expireArtifact(artifactId: string) {
  const result = await prisma.privacyExportArtifact.updateMany({
    where: { id: artifactId, status: { not: 'EXPIRED' } },
    data: { status: 'EXPIRED', encryptedPayload: null },
  });
  if (result.count > 0) {
    await emitAuditEvent({
      action: 'privacy.export.expired',
      source: 'SYSTEM',
      target: { type: 'PRIVACY_EXPORT_ARTIFACT', id: artifactId },
    });
  }
  return result.count > 0;
}

/** Batch sweep for a scheduled cleanup job. Idempotent — already-expired rows are skipped. */
export async function expireDuePrivacyExportArtifacts(now: Date = new Date()) {
  const due = await prisma.privacyExportArtifact.findMany({
    where: { expiresAt: { lte: now }, status: { not: 'EXPIRED' } },
    select: { id: true },
    take: 500,
  });
  let count = 0;
  for (const { id } of due) {
    if (await expireArtifact(id)) count += 1;
  }
  return count;
}
