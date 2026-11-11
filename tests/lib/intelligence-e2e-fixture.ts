import type { PrismaClient } from '@prisma/client';

/**
 * Browser specs that need intelligence visible on an incident switch the engine on in SUGGEST mode for the
 * run and put back exactly what they found. Specs run one at a time (one Playwright worker), so the global
 * settings row and the global policy are safe to borrow as long as they are restored.
 */
export async function enableSuggestMode(
  prisma: PrismaClient,
  adminId: string
): Promise<() => Promise<void>> {
  const settings = await prisma.intelligenceSettings.findUnique({ where: { id: 'default' } });
  const policy = await prisma.intelligencePolicy.findFirst({ where: { scopeKey: 'global' } });

  if (settings) {
    if (!settings.enabled)
      await prisma.intelligenceSettings.update({
        where: { id: 'default' },
        data: { enabled: true },
      });
  } else {
    await prisma.intelligenceSettings.create({ data: { id: 'default', enabled: true } });
  }

  let createdPolicyId: string | null = null;
  if (!policy) {
    const created = await prisma.intelligencePolicy.create({
      data: { scopeKey: 'global', headVersion: 1 },
    });
    await prisma.intelligencePolicyVersion.create({
      data: {
        policyId: created.id,
        version: 1,
        mode: 'SUGGEST',
        definition: { schemaVersion: 1 },
        createdById: adminId,
      },
    });
    createdPolicyId = created.id;
  }

  return async () => {
    if (createdPolicyId) {
      // Policy versions are append-only by trigger; a fixture has to lift it to remove its own rows.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "IntelligencePolicyVersion" DISABLE TRIGGER USER'
      );
      try {
        await prisma.intelligencePolicyVersion.deleteMany({ where: { policyId: createdPolicyId } });
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "IntelligencePolicyVersion" ENABLE TRIGGER USER'
        );
      }
      await prisma.intelligencePolicy.deleteMany({ where: { id: createdPolicyId } });
    }
    if (!settings) await prisma.intelligenceSettings.deleteMany({ where: { id: 'default' } });
    else if (!settings.enabled)
      await prisma.intelligenceSettings.update({
        where: { id: 'default' },
        data: { enabled: false },
      });
  };
}

/** A similar-incident finding newer than anything the background worker writes, so it is the one shown. */
export async function seedSimilarFinding(
  prisma: PrismaClient,
  incidentId: string,
  precedentId: string
) {
  await prisma.intelligenceFinding.deleteMany({
    where: { incidentId, kind: 'SIMILAR_INCIDENT', engineVersion: 'e2e' },
  });
  await prisma.intelligenceFinding.create({
    data: {
      incidentId,
      generation: 1_000_000,
      engineVersion: 'e2e',
      policyVersion: 1,
      kind: 'SIMILAR_INCIDENT',
      rank: 1,
      confidence: 0.91,
      subjectRef: precedentId,
      evidence: {
        type: 'similarity',
        calibrated: false,
        tier: 'FTS',
        components: {
          tokens: 0.9,
          template: 0.95,
          labels: 0,
          sameService: 1,
          recency: 0.5,
          resolved: 1,
        },
        matchedTokenCount: 5,
      },
    },
  });
}
