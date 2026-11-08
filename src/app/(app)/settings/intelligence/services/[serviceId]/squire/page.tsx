import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { ProactivePolicyForm, RemoveFactButton } from '@/components/settings/SquireMemoryForms';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import { canCurateServiceKnowledge, listServiceFacts } from '@/lib/intelligence/memory/facts';
import {
  getSquireMemorySettings,
  getSquireServicePolicy,
} from '@/lib/intelligence/memory/settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ServiceSquirePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const { serviceId } = await params;
  const actor = await getCurrentAuthorizationActor();
  let readable;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    notFound();
  }
  const service = await prisma.service.findFirst({
    where: { AND: [{ id: serviceId }, readable] },
    select: { id: true, name: true },
  });
  if (!service) notFound();
  const [policy, memory, facts, canCurate] = await Promise.all([
    getSquireServicePolicy(service.id),
    getSquireMemorySettings(),
    listServiceFacts(actor, service.id),
    canCurateServiceKnowledge(actor, service.id),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href="/settings/intelligence/services" className="text-muted-foreground underline">
            Per-service policies
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Squire for {service.name}</h1>
        <p className="text-sm text-muted-foreground">
          Proactive help for this service’s incidents and what Squire has been told to remember
          about it. Everything here is off until someone turns it on, runs in the intelligence lane
          after paging, and never changes an incident on its own.
        </p>
      </header>

      <SettingsSection
        title="Proactive Squire"
        description="Applies only while intelligence is not off for this service."
      >
        <ProactivePolicyForm row={policy} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Learned facts"
        description="Facts Squire proposed during an investigation and a person confirmed. Squire cites them when it answers."
      >
        {!memory.knowledgeEnabled && (
          <p className="py-2 text-sm text-muted-foreground">
            The knowledge index is off, so Squire does not use or propose facts.{' '}
            <Link href="/settings/intelligence/ai/memory" className="underline">
              Squire memory settings
            </Link>
          </p>
        )}
        {!facts || facts.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No learned facts yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {facts.map(fact => (
              <li key={fact.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="whitespace-pre-wrap break-words text-sm">{fact.text}</p>
                  <p className="text-xs text-muted-foreground">
                    Confirmed {fact.createdAt.toISOString().slice(0, 10)}
                    {fact.approvedBy ? ` by ${fact.approvedBy}` : ''}
                  </p>
                </div>
                {canCurate && <RemoveFactButton serviceId={service.id} factId={fact.id} />}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
