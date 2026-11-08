import Link from 'next/link';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { KnowledgeSwitchForm } from '@/components/settings/SquireMemoryForms';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { getSquireMemorySettings } from '@/lib/intelligence/memory/settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function load() {
  try {
    const [settings, counts] = await Promise.all([
      getSquireMemorySettings(),
      prisma.knowledgeChunk.groupBy({ by: ['sourceKind'], _count: { _all: true } }),
    ]);
    return { settings, counts };
  } catch (error) {
    logger.warn('[Squire] Memory settings could not load', {
      error: error instanceof Error ? error.name : 'error',
    });
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  POSTMORTEM: 'Postmortem passages',
  RUNBOOK_STEP: 'Runbook steps',
  RESOLUTION_NOTE: 'Resolution notes',
  INCIDENT_NOTE: 'Incident notes',
  SERVICE_FACT: 'Confirmed service facts',
};

export default async function SquireMemoryPage() {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const data = await load();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Squire memory</h1>
        <p className="text-sm text-muted-foreground">
          What Squire can look up when it answers, and the facts people confirmed about services.
          Proactive briefings, update nudges and postmortem drafts are turned on per service under{' '}
          <Link href="/settings/intelligence/services" className="underline">
            Per-service policies
          </Link>
          .
        </p>
      </header>
      <SettingsSection
        title="Knowledge index"
        description="Off by default. Built in the intelligence lane, never on the paging path."
      >
        {data === null ? (
          <p className="py-3 text-sm text-muted-foreground">Unavailable.</p>
        ) : (
          <>
            <KnowledgeSwitchForm
              enabled={data.settings.knowledgeEnabled}
              revision={data.settings.revision}
              canManage={canManage}
            />
            <ul className="divide-y divide-border text-sm">
              {data.counts.length === 0 ? (
                <li className="py-2 text-muted-foreground">The index is empty.</li>
              ) : (
                data.counts.map(row => (
                  <li key={row.sourceKind} className="flex justify-between py-2">
                    <span>{KIND_LABEL[row.sourceKind] ?? row.sourceKind}</span>
                    <span className="tabular-nums text-muted-foreground">{row._count._all}</span>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </SettingsSection>
    </div>
  );
}
