import { Suspense } from 'react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getOverviewStatus,
  loadSection,
  parseOverviewWindow,
  resolveOverviewScope,
  resolveOverviewWindow,
} from '@/lib/intelligence/overview';
import { Brain } from 'lucide-react';
import { FeatureOff, SectionSkeleton } from '@/components/intelligence/overview/primitives';
import {
  AttentionSection,
  ChangeSection,
  HealthSection,
  NoiseSection,
  OutcomesSection,
  OverviewHeader,
  OverviewHeaderWithStats,
  QualitySection,
  SECTION_TITLES,
  SpeedSection,
} from './sections';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Responder-facing AIOps overview: what Intelligence and the noise controls did for the incidents the
 * viewer can read, over a selectable window. Read-only; every fix links to the existing flow.
 */
export default async function IntelligenceOverviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string | string[] }>;
}) {
  await requirePageAccess('/intelligence');
  await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const actor = await getCurrentAuthorizationActor();
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  const params = await searchParams;
  const range = resolveOverviewWindow(parseOverviewWindow(params?.window));
  const [scope, statusResult] = await Promise.all([
    resolveOverviewScope(actor),
    loadSection('status', getOverviewStatus),
  ]);
  // When the status probe fails, sections still render; they only lose their "turn it on" hints.
  const status = statusResult.ok
    ? statusResult.data
    : { enabled: true, mode: 'UNKNOWN', triageEnabled: true, responseEnabled: true };
  const props = { scope, range, canManage, status };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-6">
      {/* The band renders at once; its stat strip fills in from the Noise and Speed loaders. */}
      <Suspense
        key={range.key}
        fallback={<OverviewHeader scope={scope} range={range} stats={null} />}
      >
        <OverviewHeaderWithStats {...props} />
      </Suspense>

      {!status.enabled && (
        <FeatureOff
          variant="banner"
          title="Intelligence is off"
          adminHint="Turn it on to find similar and related incidents, possible causes, runbooks and triage suggestions. Noise controls and response metrics below work either way."
          href="/settings/intelligence"
          canManage={canManage}
          icon={<Brain aria-hidden="true" />}
        />
      )}

      {/* Probes and operations insights in one ranked inbox. No skeleton: it is absent when empty. */}
      <Suspense fallback={null}>
        <AttentionSection actor={actor} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2" key={range.key}>
        <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.noise} tiles={6} />}>
          <NoiseSection {...props} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.speed} tiles={5} />}>
          <SpeedSection {...props} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.outcomes} />}>
          <OutcomesSection {...props} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.quality} tiles={2} />}>
          <QualitySection {...props} actor={actor} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.change} tiles={2} />}>
          <ChangeSection {...props} />
        </Suspense>
        {canManage && (
          <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.health} tiles={4} />}>
            <HealthSection {...props} actor={actor} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
