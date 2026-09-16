import 'server-only';

import prisma from '@/lib/prisma';

export interface ErasureVerificationResult {
  verified: boolean;
  issues: string[];
}

/**
 * Post-execution assertions that a subject's identifying data is actually
 * gone. Runs after the erasure transaction commits (see execute.ts) — this is
 * the "VERIFY" step of the DISCOVER→PREVIEW→VALIDATE→EXECUTE→VERIFY→COMPLETE
 * model. originalEmail must be captured by the caller *before* the user row
 * is deleted; there is nothing left to look up it from afterwards.
 */
export async function verifySubjectErasure(
  subjectId: string,
  options: { originalEmail?: string | null } = {}
): Promise<ErasureVerificationResult> {
  const issues: string[] = [];
  const originalEmail = options.originalEmail?.toLowerCase() ?? null;

  const [
    stillExists,
    teamMemberships,
    incidentWatchers,
    onCallShifts,
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
    prisma.user.findUnique({ where: { id: subjectId }, select: { id: true } }),
    prisma.teamMember.count({ where: { userId: subjectId } }),
    prisma.incidentWatcher.count({ where: { userId: subjectId } }),
    prisma.onCallShift.count({ where: { userId: subjectId } }),
    prisma.onCallLayerUser.count({ where: { userId: subjectId } }),
    prisma.onCallOverride.count({
      where: { OR: [{ userId: subjectId }, { replacesUserId: subjectId }] },
    }),
    prisma.userToken.count({ where: { userId: subjectId } }),
    originalEmail
      ? prisma.userToken.count({ where: { identifier: originalEmail } })
      : Promise.resolve(0),
    prisma.oidcConfig.count({ where: { updatedBy: subjectId } }),
    prisma.slackIntegration.count({ where: { installedBy: subjectId } }),
    prisma.auditLog.count({ where: { actorId: subjectId } }),
    originalEmail
      ? prisma.auditLog.count({ where: { actorEmail: originalEmail } })
      : Promise.resolve(0),
    originalEmail
      ? prisma.auditLog.count({ where: { targetEmail: originalEmail } })
      : Promise.resolve(0),
  ]);

  if (stillExists) issues.push('User row still exists.');
  if (teamMemberships > 0) issues.push(`${teamMemberships} team membership row(s) remain.`);
  if (incidentWatchers > 0) issues.push(`${incidentWatchers} incident watcher row(s) remain.`);
  if (onCallShifts > 0) issues.push(`${onCallShifts} on-call shift row(s) remain.`);
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
