import { Prisma, PrismaClient } from '@prisma/client';
import { compileAutomation } from '@/lib/automation/compiler';
import { checksum } from '@/lib/automation/cache';
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
import {
  automationLoadSnapshot,
  type AutomationLoadProfile,
  AUTOMATION_LOAD_PROFILES,
} from '../fixtures/automation';
/** Extend the existing seed/topology/load suite with service-scoped policies. */
export async function configureAutomationLoadProfile(
  db: PrismaClient,
  serviceIds: string[],
  actorId: string,
  profile: AutomationLoadProfile
) {
  for (const serviceId of serviceIds) {
    const snapshot = automationLoadSnapshot(profile);
    const { compiled, issues } = compileAutomation(snapshot);
    if (issues.some(issue => issue.level === 'ERROR')) throw new Error('Invalid load profile');
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation:${serviceId}`}, 0))`;
      const latest = await tx.automationVersion.findFirst({
        where: { serviceId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const version = await tx.automationVersion.create({
        data: {
          serviceId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          snapshot: asJson(snapshot),
          compiledSnapshot: asJson(compiled),
          checksum: checksum(compiled),
          publishedBy: actorId,
          lintReport: asJson(issues),
        },
      });
      const mode =
        profile === 'disabled' ? 'DISABLED' : profile === 'shadow-small' ? 'SHADOW' : 'LIVE';
      await tx.serviceAutomationConfig.upsert({
        where: { serviceId },
        create: { serviceId, mode, activeVersionId: version.id },
        update: { mode, activeVersionId: version.id },
      });
    });
  }
}
export function parseAutomationLoadProfile(value: string): AutomationLoadProfile {
  if (!AUTOMATION_LOAD_PROFILES.some(profile => profile === value))
    throw new Error(`Expected one of ${AUTOMATION_LOAD_PROFILES.join(', ')}`);
  return value as AutomationLoadProfile;
}
