import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { KnowledgeSwitchForm } from '@/components/settings/SquireMemoryForms';
import EmptyState from '@/components/patterns/EmptyState';
import { LearnMore } from '@/components/settings/layout/LearnMore';
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
  DOCUMENT: 'Documentation passages',
};

/** Squire's knowledge index, for the Assistant page. The caller checked `intelligence.read`. */
export default async function KnowledgeMemorySection({ canManage }: { canManage: boolean }) {
  const data = await load();

  return (
    <SettingsSection
      id="knowledge-memory"
      title="Knowledge memory"
      description="Let Squire search what your organisation already learned. Off by default."
    >
      <LearnMore className="pt-3">
        The index covers postmortems, resolution and incident notes, runbook steps and confirmed
        service facts. It is built in the intelligence lane, never on the paging path.
      </LearnMore>
      {data === null ? (
        <EmptyState
          size="sm"
          variant="simple"
          title="Knowledge memory unavailable"
          description="It could not be loaded. Refresh to try again."
        />
      ) : (
        <>
          <KnowledgeSwitchForm
            enabled={data.settings.knowledgeEnabled}
            revision={data.settings.revision}
            canManage={canManage}
          />
          <ul
            aria-label="Indexed knowledge"
            className="mb-4 divide-y divide-border rounded-lg border border-border text-sm"
          >
            {data.counts.length === 0 ? (
              <li className="px-3 py-2.5 text-muted-foreground">
                The index is empty. It fills once knowledge memory is on.
              </li>
            ) : (
              data.counts.map(row => (
                <li key={row.sourceKind} className="flex justify-between gap-3 px-3 py-2.5">
                  <span>{KIND_LABEL[row.sourceKind] ?? row.sourceKind}</span>
                  <span className="tabular-nums text-muted-foreground">{row._count._all}</span>
                </li>
              ))
            )}
          </ul>
          <Link
            href="/settings/intelligence/ai/docs"
            className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            Documentation sources
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      )}
    </SettingsSection>
  );
}
