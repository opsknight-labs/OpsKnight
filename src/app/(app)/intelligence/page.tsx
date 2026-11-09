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
import WindowSelector from '@/components/intelligence/overview/WindowSelector';
import { FeatureOff, SectionSkeleton } from '@/components/intelligence/overview/primitives';
import {
  ChangeSection,
  HealthSection,
  NoiseSection,
  OutcomesSection,
  QualitySection,
  SECTION_TITLES,
  SpeedSection,
} from './sections';

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
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">AIOps overview</h1>
          <p className="text-sm text-muted-foreground">
            What Intelligence and the noise controls did for the incidents you can see: noise held
            back, how quickly suggestions arrived and how often they helped, noisy services to fix,
            risky changes and response times.
          </p>
          {!scope.global && (
            <p className="text-xs text-muted-foreground">
              Showing your teams&apos; services and incidents only.
              {scope.servicesTruncated && ' Limited to the first 2,000 services.'}
            </p>
          )}
        </div>
        <WindowSelector current={range.key} />
      </header>

      {!status.enabled && (
        <FeatureOff
          title="Intelligence is off"
          adminHint="Turn on Intelligence to analyse incidents for similar past incidents, related incidents, possible causes, runbooks and triage suggestions. Noise controls and response metrics below work either way."
          href="/settings/intelligence"
          canManage={canManage}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2" key={range.key}>
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
