import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { resolveEffectivePolicyForRequest } from '@/lib/intelligence/settings/service';

async function explanation(incidentId: string): Promise<string | null> {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: incidentId }, incidentReadWhere(actor)] },
      select: { serviceId: true, intelligenceFingerprint: { select: { incidentId: true } } },
    });
    if (!incident) return null;
    const policy = await resolveEffectivePolicyForRequest(incident.serviceId);
    const message =
      policy.effectiveMode === 'OFF'
        ? 'Intelligence is off for this service. An administrator can enable it in Intelligence settings.'
        : policy.effectiveMode === 'SHADOW'
          ? 'This service is in shadow mode. Analysis is recorded for evaluation; suggestions appear after an administrator enables Suggest mode.'
          : !incident.intelligenceFingerprint
            ? 'This incident is waiting for intelligence analysis. Suggestions will appear after it is indexed.'
            : 'No qualifying matches yet. Suggestions appear when analysis finds relevant incidents, changes or runbooks you can read.';
    return message;
  } catch {
    return 'Intelligence is temporarily unavailable. Try again later.';
  }
}

export default async function IntelligenceEmptyState({ incidentId }: { incidentId: string }) {
  const message = await explanation(incidentId);
  return message ? (
    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      {message}
    </p>
  ) : null;
}
