import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { getOidcLinkingApprovalExpiry } from '@/lib/oidc-linking-approval';
import { getActiveLinkingProvider } from '@/lib/oidc-linking-status';
import { providerConfigSchema } from '@/lib/auth-control/provider-config';
import { SERVICE_ACCOUNT_DOMAIN } from '@/lib/service-account-identity';

/** One request approves at most this many people; larger directories repeat it. */
export const BULK_LINKING_LIMIT = 500;
const SAMPLE_SIZE = 10;

export const bulkLinkingInputSchema = z
  .object({
    scope: z.enum(['selected', 'domain', 'all']),
    userIds: z.array(z.string().min(1).max(64)).max(BULK_LINKING_LIMIT).optional(),
    domains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      )
      .max(100)
      .optional(),
    /** Prepare approvals for a saved configuration before it is activated. */
    revisionId: z.string().min(1).max(64).optional(),
    expiryDays: z.number().int().min(1).max(30).default(14),
  })
  .strict()
  .refine(value => value.scope !== 'selected' || (value.userIds?.length ?? 0) > 0, {
    message: 'Select at least one person.',
  })
  .refine(value => value.scope !== 'domain' || (value.domains?.length ?? 0) > 0, {
    message: 'Enter at least one domain.',
  });
export type BulkLinkingInput = z.input<typeof bulkLinkingInputSchema>;

type Target = {
  issuer: string;
  clientId: string;
  providerConfigId: string;
  configVersion: number | null;
};

/** The provider registration approvals are bound to: a saved configuration, or the active one. */
async function linkingTarget(revisionId?: string): Promise<Target> {
  if (revisionId) {
    const revision = await prisma.oidcRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new Error('This saved configuration no longer exists.');
    const config = providerConfigSchema.parse(revision.configuration);
    // A null version is rebound to the real version when this configuration is activated.
    return {
      issuer: config.issuer,
      clientId: config.clientId,
      providerConfigId: 'default',
      configVersion: null,
    };
  }
  const provider = await getActiveLinkingProvider(prisma);
  if (!provider) throw new Error('Activate single sign-on, or choose a saved configuration.');
  return {
    issuer: provider.issuer,
    clientId: provider.clientId,
    providerConfigId: provider.id,
    configVersion: provider.configVersion,
  };
}

function candidateWhere(
  input: z.infer<typeof bulkLinkingInputSchema>,
  target: Target,
  now: Date
): Prisma.UserWhereInput {
  const fingerprint = oidcTrustFingerprint(target.issuer, target.clientId);
  return {
    status: { in: ['ACTIVE', 'INVITED'] },
    NOT: [
      { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
      // Already approved for this exact provider registration.
      {
        oidcLinkingApproval: {
          consumedAt: null,
          revokedAt: null,
          issuerFingerprint: fingerprint,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    ],
    oidcIdentities: { none: { issuer: target.issuer } },
    ...(input.scope === 'selected' ? { id: { in: input.userIds ?? [] } } : {}),
    // Bulk approval by domain or for everyone never includes administrators; approve those
    // individually so each administrator link is a deliberate decision.
    ...(input.scope !== 'selected' ? { role: { not: 'ADMIN' as const } } : {}),
    ...(input.scope === 'domain'
      ? {
          OR: (input.domains ?? []).map(domain => ({
            email: { endsWith: `@${domain}`, mode: 'insensitive' as const },
          })),
        }
      : {}),
  };
}

export async function previewBulkLinking(raw: BulkLinkingInput) {
  const input = bulkLinkingInputSchema.parse(raw);
  const target = await linkingTarget(input.revisionId);
  const where = candidateWhere(input, target, new Date());
  const [count, sample] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { email: 'asc' },
      take: SAMPLE_SIZE,
    }),
  ]);
  return { count, sample, limit: BULK_LINKING_LIMIT };
}

export async function approveBulkLinking(raw: BulkLinkingInput, approvedById: string) {
  const input = bulkLinkingInputSchema.parse(raw);
  const target = await linkingTarget(input.revisionId);
  const now = new Date();
  const fingerprint = oidcTrustFingerprint(target.issuer, target.clientId);
  const expiresAt = getOidcLinkingApprovalExpiry(now, input.expiryDays);
  return prisma.$transaction(async tx => {
    const users = await tx.user.findMany({
      where: candidateWhere(input, target, now),
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
      take: BULK_LINKING_LIMIT,
    });
    for (const user of users) {
      const data = {
        approvedById,
        approvedAt: now,
        expiresAt,
        providerConfigId: target.providerConfigId,
        issuerFingerprint: fingerprint,
        expectedEmail: user.email.toLowerCase(),
        configVersion: target.configVersion,
        consumedAt: null,
        revokedAt: null,
      };
      await tx.oidcLinkingApproval.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        // A new generation makes any in-flight callback for an older approval unusable.
        update: { ...data, generation: { increment: 1 } },
      });
    }
    // Approving someone answers their pending access request.
    await tx.oidcLinkingRequest.deleteMany({
      where: { userId: { in: users.map(user => user.id) } },
    });
    const remaining = await tx.user.count({ where: candidateWhere(input, target, now) });
    return {
      approved: users.length,
      remaining,
      expiresAt: expiresAt.toISOString(),
      userIds: users.map(user => user.id),
    };
  });
}
