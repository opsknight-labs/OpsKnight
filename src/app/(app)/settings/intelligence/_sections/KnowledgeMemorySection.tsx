import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { KnowledgeSwitchForm } from '@/components/settings/SquireMemoryForms';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { getSquireMemorySettings } from '@/lib/intelligence/memory/settings';

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

/** Squire's knowledge index, for the Assistant page. The caller checked `intelligence.read`. */
export default async function KnowledgeMemorySection({ canManage }: { canManage: boolean }) {
  const data = await load();

  return (
    <SettingsSection
      id="knowledge-memory"
      title="Knowledge memory"
      description="Let Squire search what your organisation already learned: postmortems, resolution and incident notes, runbook steps and confirmed service facts. Off by default. Built in the intelligence lane, never on the paging path."
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
  );
}
