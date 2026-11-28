import { Fragment, Suspense } from 'react';
import Link from 'next/link';
import { Brain, Settings2 } from 'lucide-react';
import FreshnessControl from '@/components/analytics/FreshnessControl';
import { SectionSkeleton } from '@/components/analytics/SectionCard';
import { ImpactSkeleton } from '@/components/intelligence/overview/ImpactSummary';
import WindowSelector from '@/components/intelligence/overview/WindowSelector';
import { FeatureOff } from '@/components/intelligence/overview/primitives';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  getOverviewStatus,
  loadSection,
  parseOverviewWindow,
  resolveOverviewScope,
  resolveOverviewWindow,
} from '@/lib/intelligence/overview';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import {
  AttentionSection,
  ChangeSection,
  FeedbackSection,
  HealthSection,
  ImpactSection,
  NoiseControlsSection,
  QualitySection,
  SECTION_TITLES,
  TrendSection,
} from './sections';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Two cards side by side from lg, stretched to the same height; a lone card takes the full row.
const PANEL_ROW =
  'grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2';

/**
 * Responder-facing AIOps overview. It answers two questions first: is Intelligence helping (the impact
 * card: one sentence and four headline numbers) and what needs me now (the "Needs attention" inbox). Then
 * the response trend beside feedback, and the detail sections. What Intelligence and the noise controls did
 * for the incidents the viewer can read, over a selectable window. Every fix links to the existing flow.
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
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="AIOps"
        title="AIOps overview"
        icon={Brain}
        description="What Intelligence and the noise controls did for the incidents you can see."
        secondaryActions={<WindowSelector current={range.key} variant="header" />}
        primaryAction={
          canManage ? (
            <Link
              href="/settings/intelligence"
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                pageHeaderActionClass
              )}
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              Settings
            </Link>
          ) : undefined
        }
      />

      {!status.enabled && (
        <FeatureOff
          variant="banner"
          title="Intelligence is off"
          adminHint="Turn it on to find similar and related incidents, possible causes, runbooks and triage suggestions. It starts by only watching: nothing changes for your team until you decide. Noise controls and response metrics below work either way."
          href="/settings/intelligence/setup"
          actionLabel="Get started"

          canManage={canManage}
          icon={<Brain aria-hidden="true" />}
        />
      )}

      {/* Live data (no cache), so "Updated" is this render and Refresh just re-renders. */}
      <Suspense fallback={<div className="h-11 sm:h-5" aria-hidden />}>
        <FreshnessControl asOf={range.until.toISOString()} invalidate={false} />
      </Suspense>

      {!scope.global && (
        <InlineNotice tone="info">
          Showing your teams&apos; services and incidents only.
          {scope.servicesTruncated && ' Limited to the first 2,000 services.'}
        </InlineNotice>
      )}

      {/* Keyed by window so every section's Suspense boundary shows its skeleton again on a switch. */}
      <Fragment key={`panels-${range.key}`}>
        <Suspense fallback={<ImpactSkeleton />}>
          <ImpactSection {...props} />
        </Suspense>

        {/* Probes and operations insights in one ranked inbox. No skeleton: it is absent when empty. */}
        <Suspense fallback={null}>
          <AttentionSection actor={actor} />
        </Suspense>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          <Suspense
            fallback={<SectionSkeleton title={SECTION_TITLES.trend} className="lg:col-span-2" />}
          >
            <TrendSection {...props} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.feedback} />}>
            <FeedbackSection {...props} />
          </Suspense>
        </div>
        <div className={PANEL_ROW}>
          <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.quality} />}>
            <QualitySection {...props} actor={actor} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.change} />}>
            <ChangeSection {...props} />
          </Suspense>
        </div>
        <div className={PANEL_ROW}>
          <Suspense
            fallback={<SectionSkeleton title={SECTION_TITLES.noiseControls} height="h-40" />}
          >
            <NoiseControlsSection {...props} />
          </Suspense>
          {canManage && (
            <Suspense fallback={<SectionSkeleton title={SECTION_TITLES.health} height="h-40" />}>
              <HealthSection {...props} actor={actor} />
            </Suspense>
          )}
        </div>
      </Fragment>
    </div>
  );
}
