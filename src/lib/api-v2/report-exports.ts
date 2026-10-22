import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { authorize, AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { projectReportMetric, ReportQueryV2Schema } from './report-query';

export const ReportExportRequestV2Schema = ReportQueryV2Schema;
export const ReportExportIdV2Schema = z.object({ id: z.string().min(1) }).strict();
export const REPORT_EXPORT_TTL_MS = 72 * 60 * 60 * 1000;
const MAX_EXPORT_BYTES = 512 * 1024;

export function assertGlobalReportAccess(actor: AuthorizationActor) {
  for (const action of [AUTHORIZATION_ACTIONS.REPORT_READ, AUTHORIZATION_ACTIONS.INCIDENT_READ]) {
    const decision = authorize({ actor, action });
    if (!decision.allowed || decision.scope !== 'global') {
      throw new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: 'Report exports require global incident and report access.' });
    }
  }
}

export async function processReportExportJob(exportId: string, jobId: string, claimToken?: string | null) {
  const record = await prisma.reportExport.findUnique({
    where: { id: exportId },
    include: { job: { select: { status: true, claimToken: true } } },
  });
  if (!record || record.jobId !== jobId || record.expiresAt <= new Date() || record.encryptedPayload) return;
  if (record.job.status !== 'PROCESSING' || record.job.claimToken !== claimToken) return;
  const key = await prisma.apiKey.findUnique({
    where: { id: record.apiKeyId },
    select: { id: true, userId: true, scopes: true, revokedAt: true, expiresAt: true },
  });
  if (!key || key.userId !== record.userId || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, role: true, status: true, teamMemberships: { select: { teamId: true } } },
  });
  const baseActor = user && authorizationActorFromUser(user);
  if (!baseActor) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  const actor = { ...baseActor, apiKey: { id: key.id, scopes: key.scopes } };
  assertGlobalReportAccess(actor);
  const query = ReportExportRequestV2Schema.parse(record.query);
  const result = await calculateActorSLAMetrics(actor, {
    windowDays: query.windowDays,
    ...(query.serviceId ? { serviceId: query.serviceId } : {}),
  });
  const bytes = Buffer.from(JSON.stringify({
    generatedAt: new Date().toISOString(),
    windowDays: query.windowDays,
    serviceId: query.serviceId ?? null,
    metrics: Object.fromEntries(query.metrics.map(metric => [metric, projectReportMetric(metric, result)])),
  }));
  if (bytes.length > MAX_EXPORT_BYTES) throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
  const encryptedPayload = await encrypt(bytes.toString('base64'));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await prisma.$transaction(async tx => {
    const current = await tx.backgroundJob.findUnique({ where: { id: jobId }, select: { status: true, claimToken: true } });
    if (current?.status !== 'PROCESSING' || current.claimToken !== claimToken) return;
    await tx.reportExport.updateMany({
      where: { id: exportId, encryptedPayload: null, expiresAt: { gt: new Date() } },
      data: { encryptedPayload, checksum, sizeBytes: bytes.length },
    });
  });
}

export async function decryptReportExport(encryptedPayload: string, expectedChecksum: string) {
  const bytes = Buffer.from(await decrypt(encryptedPayload), 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== expectedChecksum) {
    throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'The export integrity check failed.' });
  }
  return bytes;
}

export async function expireDueReportExports(now = new Date()) {
  const due = await prisma.reportExport.findMany({
    where: { expiresAt: { lte: now }, encryptedPayload: { not: null } },
    select: { id: true },
    take: 500,
  });
  if (!due.length) return { count: 0 };
  return prisma.reportExport.updateMany({
    where: { id: { in: due.map(record => record.id) }, expiresAt: { lte: now }, encryptedPayload: { not: null } },
    data: { encryptedPayload: null },
  });
}
