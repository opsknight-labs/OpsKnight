import 'server-only';
import prisma from '@/lib/prisma';
import { lockControlActor, type ControlActor } from './actor';
import { securityEvent } from './security-events';

/** Opaque database handle; never expose or accept the JWT/session capability. */
export async function revokeAuthenticationSession(actor: ControlActor, id: string) {
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    await tx.$queryRaw`SELECT "id" FROM "UserDevice" WHERE "id" = ${id} FOR UPDATE`;
    const session = await tx.userDevice.findUniqueOrThrow({ where: { id } });
    if (!session.platform.startsWith('session:') || !session.deviceId.startsWith('session:'))
      throw new Error('Select a registered authentication session.');
    if (session.platform.startsWith('session:REVOKED:')) return;
    const method = session.platform === 'session:OIDC' ? 'oidc' : 'credentials';
    await tx.userDevice.update({
      where: { id },
      data: { platform: `session:REVOKED:${session.platform.slice('session:'.length)}` },
    });
    await securityEvent(tx, 'auth.session.revoked', actor.id, {
      userId: session.userId,
      method,
      sessionHandle: id,
    });
  });
}

export async function cleanAuthenticationCeremonies() {
  await cleanAuthenticationAlerts();
  const expiry = new Date(Date.now() - 86400000);
  await prisma.$transaction([
    prisma.authenticationFailureWindow.deleteMany({ where: { expiresAt: { lt: expiry } } }),
    prisma.emergencyChallenge.deleteMany({ where: { expiresAt: { lt: expiry } } }),
    prisma.oidcTestFlow.deleteMany({ where: { expiresAt: { lt: expiry } } }),
  ]);
}

/** Retain terminal delivery metadata for 90 days; never delete pending intents or audit evidence.
 * Four indexed batches cap work per scheduler pass, including installations with old backlogs.
 */
export async function cleanAuthenticationAlerts() {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  for (const column of ['acceptedAt', 'deliveredAt', 'cancelledAt', 'failedAt'] as const) {
    const where = {
      [column]: { lt: cutoff },
      ...(column === 'acceptedAt' ? { deliveredAt: null, failedAt: null, cancelledAt: null } : {}),
    };
    const batch = await prisma.authenticationAlert.findMany({
      where,
      orderBy: { [column]: 'asc' },
      take: 1000,
      select: { id: true },
    });
    if (batch.length)
      await prisma.authenticationAlert.deleteMany({
        where: { ...where, id: { in: batch.map(row => row.id) } },
      });
  }
}
