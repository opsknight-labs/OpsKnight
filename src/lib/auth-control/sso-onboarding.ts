import 'server-only';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { getControlActor, lockControlActor } from './actor';
import { authenticationOrigin } from './origin';
import { securityEvent } from './security-events';

const invitationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z
      .string()
      .email()
      .max(320)
      .transform(value => value.toLowerCase()),
    role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']),
    userId: z.string().min(1).optional(),
  })
  .strict();

/** A bound, expiring first-link approval; never creates a password capability. */
export async function inviteSsoUser(input: z.input<typeof invitationSchema>) {
  const values = invitationSchema.parse(input);
  const actor = await getControlActor();
  if (actor.kind !== 'admin')
    throw new Error('Ordinary administrator access required for user invitations.');
  const origin = await authenticationOrigin();
  const { user, generation } = await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor, false);
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const provider = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
    if (policy.mode === 'PASSWORD_ONLY' || !provider?.enabled)
      throw new Error('Activate an SSO connection before inviting an SSO-only user.');
    let user;
    if (values.userId) {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${values.userId} FOR UPDATE`;
      user = await tx.user.findUniqueOrThrow({ where: { id: values.userId } });
      if (user.status !== 'INVITED' || user.email.toLowerCase() !== values.email)
        throw new Error('Only a pending invitation can be renewed.');
    } else {
      user = await tx.user.create({
        data: {
          name: values.name,
          email: values.email,
          role: values.role,
          roleSource: 'MANUAL',
          status: 'INVITED',
          invitedAt: new Date(),
          invitationGeneration: 1,
        },
      });
    }
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const binding = {
      approvedById: actor.id,
      approvedAt: new Date(),
      expiresAt,
      consumedAt: null,
      revokedAt: null,
      providerConfigId: provider.id,
      issuerFingerprint: oidcTrustFingerprint(provider.issuer, provider.clientId),
      expectedEmail: user.email.toLowerCase(),
      configVersion: provider.configVersion,
    };
    const approval = await tx.oidcLinkingApproval.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...binding },
      update: { ...binding, generation: { increment: 1 } },
    });
    await tx.userToken.deleteMany({
      where: { userId: user.id, type: { in: ['INVITE', 'PASSWORD_RESET'] }, usedAt: null },
    });
    await securityEvent(tx, 'auth.user.sso.invited', actor.id, {
      userId: user.id,
      configVersion: provider.configVersion,
      expiresAt: expiresAt.toISOString(),
    });
    return { user, generation: approval.generation };
  });
  return {
    success: true as const,
    ssoOnly: true as const,
    inviteUrl: `${origin}/login`,
    recipientEmail: user.email,
    userId: user.id,
    generation,
  };
}
