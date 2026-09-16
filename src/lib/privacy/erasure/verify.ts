import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export type ErasureVerificationClient = Prisma.TransactionClient | typeof prisma;

export interface ErasureVerificationResult {
  verified: boolean;
  issues: string[];
}

/**
 * Post-execution assertions that a subject's identifying data is actually
 * gone. Accepts an injectable client so execute.ts can run this *inside* the
 * same transaction as the destructive mutation — a failed verification then
 * rolls the whole transaction back (nothing was actually deleted) instead of
 * leaving a partially-erased subject that a later step must reconcile.
 * originalEmail must be captured by the caller *before* the user row is
 * deleted; there is nothing left to look it up from afterwards.
 */
export async function verifySubjectErasure(
  subjectId: string,
  options: { originalEmail?: string | null } = {},
  client: ErasureVerificationClient = prisma
): Promise<ErasureVerificationResult> {
  const issues: string[] = [];
  const originalEmail = options.originalEmail?.toLowerCase() ?? null;

  const [
    stillExists,
    teamMemberships,
    incidentWatchers,
    activeOrFutureOnCallShifts,
    onCallLayerAssignments,
    onCallOverrides,
    userTokensById,
    userTokensByEmail,
    oidcConfigAttribution,
    slackIntegrationAttribution,
    auditLogByActorId,
    auditLogByActorEmail,
    auditLogByTargetEmail,
  ] = await Promise.all([
    client.user.findUnique({ where: { id: subjectId }, select: { id: true } }),
    client.teamMember.count({ where: { userId: subjectId } }),
    client.incidentWatcher.count({ where: { userId: subjectId } }),
    client.onCallShift.count({ where: { userId: subjectId, end: { gte: new Date() } } }),
    client.onCallLayerUser.count({ where: { userId: subjectId } }),
    client.onCallOverride.count({
      where: { OR: [{ userId: subjectId }, { replacesUserId: subjectId }] },
    }),
    client.userToken.count({ where: { userId: subjectId } }),
    originalEmail
      ? client.userToken.count({ where: { identifier: originalEmail } })
      : Promise.resolve(0),
    client.oidcConfig.count({ where: { updatedBy: subjectId } }),
    client.slackIntegration.count({ where: { installedBy: subjectId } }),
    client.auditLog.count({ where: { actorId: subjectId } }),
    originalEmail
      ? client.auditLog.count({ where: { actorEmail: originalEmail } })
      : Promise.resolve(0),
    originalEmail
      ? client.auditLog.count({ where: { targetEmail: originalEmail } })
      : Promise.resolve(0),
  ]);

  if (stillExists) issues.push('User row still exists.');
  if (teamMemberships > 0) issues.push(`${teamMemberships} team membership row(s) remain.`);
  if (incidentWatchers > 0) issues.push(`${incidentWatchers} incident watcher row(s) remain.`);
  if (activeOrFutureOnCallShifts > 0)
    issues.push(`${activeOrFutureOnCallShifts} active/future on-call shift row(s) remain.`);
  if (onCallLayerAssignments > 0)
    issues.push(`${onCallLayerAssignments} on-call rotation layer row(s) remain.`);
  if (onCallOverrides > 0) issues.push(`${onCallOverrides} on-call override row(s) remain.`);
  if (userTokensById > 0)
    issues.push(`${userTokensById} security token row(s) still reference the subject by id.`);
  if (userTokensByEmail > 0)
    issues.push(`${userTokensByEmail} security token row(s) still reference the subject's email.`);
  if (oidcConfigAttribution > 0)
    issues.push('OIDC config attribution still references the subject.');
  if (slackIntegrationAttribution > 0)
    issues.push('Slack integration attribution still references the subject.');
  if (auditLogByActorId > 0)
    issues.push(`${auditLogByActorId} audit log row(s) still reference the subject by actorId.`);
  if (auditLogByActorEmail > 0)
    issues.push(`${auditLogByActorEmail} audit log row(s) still expose the subject's actor email.`);
  if (auditLogByTargetEmail > 0)
    issues.push(
      `${auditLogByTargetEmail} audit log row(s) still expose the subject's target email.`
    );

  return { verified: issues.length === 0, issues };
}
