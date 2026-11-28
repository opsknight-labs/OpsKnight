import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import IntelligenceSetupGuide from '@/components/settings/IntelligenceSetupGuide';
import prisma from '@/lib/prisma';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { requirePageAccess } from '@/lib/access/server';
import { getSetupState } from '@/lib/intelligence/settings/setup';

export const dynamic = 'force-dynamic';

/**
 * Get started with Intelligence: four short steps for someone who has never done incident management.
 * Anyone with Intelligence access can read it; only administrators can change anything.
 */
export default async function IntelligenceSetupPage() {
  await requirePageAccess('/settings/intelligence/setup');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const [state, services, integrations, incidents] = await Promise.all([
    getSetupState(),
    prisma.service.count(),
    prisma.integration.count(),
    prisma.incident.count(),
  ]);
  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader group="engine" title="Get started" visible={[]}>
        Set up Intelligence in about three minutes. Nothing changes for your team until you decide.
      </IntelligenceGroupHeader>
      <IntelligenceSetupGuide
        state={state}
        counts={{ services, integrations, incidents }}
        canManage={canManage}
      />
    </div>
  );
}
