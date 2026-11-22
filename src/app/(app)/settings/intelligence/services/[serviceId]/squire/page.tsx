import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bot, BookOpen } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import {
  ProactivePolicyForm,
  ReconfirmFactButton,
  RemoveFactButton,
} from '@/components/settings/SquireMemoryForms';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import { canCurateServiceKnowledge, listServiceFacts } from '@/lib/intelligence/memory/facts';
import {
  getSquireMemorySettings,
  getSquireServicePolicy,
} from '@/lib/intelligence/memory/settings';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ServiceSquirePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  await requirePageAccess('/settings/intelligence/services/[serviceId]/squire');
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
      <SettingsPageHeader
        eyebrow="AIOps Intelligence"
        title={`Squire for ${service.name}`}
        description="Proactive help for this service’s incidents and what Squire remembers about it."
        icon={Bot}
        trail={[
          { label: 'Services & changes', href: '/settings/intelligence/services' },
          { label: service.name },
        ]}
      />
      <IntelligenceSubNav />
      <LearnMore label="How this works">
        Everything here is off until someone turns it on, runs in the intelligence lane after
        paging, and never changes an incident on its own.
      </LearnMore>

      <SettingsSection
        title="Proactive Squire"
        description="Applies only while intelligence is not off for this service."
      >
        <ProactivePolicyForm row={policy} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Learned facts"
        description="Facts Squire proposed and a person confirmed. Squire cites them for 180 days after the last confirmation."
      >
        {!memory.knowledgeEnabled && (
          <p className="pt-4 text-sm text-muted-foreground">
            The knowledge index is off, so Squire does not use or propose facts.{' '}
            <Link
              href="/settings/intelligence/ai#knowledge-memory"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Squire memory settings
            </Link>
          </p>
        )}
        {!facts || facts.length === 0 ? (
          <EmptyState
            size="sm"
            variant="simple"
            icon={<BookOpen aria-hidden="true" />}
            title="No learned facts yet"
            description="When Squire proposes a fact during an investigation and someone confirms it, it appears here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {facts.map(fact => (
              <li key={fact.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="whitespace-pre-wrap break-words text-sm">{fact.text}</p>
                  <p className="text-xs text-muted-foreground">
                    Confirmed <RelativeTime date={fact.confirmedAt} format="long" />
                    {fact.approvedBy ? ` by ${fact.approvedBy}` : ''}
                    {fact.stale &&
                      ' · Stale: Squire stops using it until someone confirms it again.'}
                  </p>
                </div>
                {canCurate && (
                  <div className="flex flex-wrap gap-2">
                    <ReconfirmFactButton serviceId={service.id} factId={fact.id} />
                    <RemoveFactButton serviceId={service.id} factId={fact.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
