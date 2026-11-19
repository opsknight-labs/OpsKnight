import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { NoiseSection, SECTION_TITLES } from '@/app/(app)/intelligence/sections';
import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';
import WindowSelector from '@/components/intelligence/overview/WindowSelector';
import { SectionSkeleton } from '@/components/intelligence/overview/primitives';
import { appRoutes, toMobilePath } from '@/lib/app-routes';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  getOverviewAttention,
  getOverviewStatus,
  loadSection,
  parseOverviewWindow,
  resolveOverviewScope,
  resolveOverviewWindow,
} from '@/lib/intelligence/overview';
import { assertCapability } from '@/lib/rbac';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

/** Points an inbox link at its mobile route when one exists; settings links stay on the desktop UI. */
function mobileHref(href: string): string {
  const queryAt = href.indexOf('?');
  const path = queryAt === -1 ? href : href.slice(0, queryAt);
  const mobile = toMobilePath(path);
  return mobile ? `${mobile}${queryAt === -1 ? '' : href.slice(queryAt)}` : href;
}

async function MobileAttention({ actor }: { actor: AuthorizationActor }) {
  const result = await loadSection('needs attention', () => getOverviewAttention(actor));
  if (!result.ok) return null;
  return <NeedsAttention items={result.data.items} resolveHref={mobileHref} />;
}

/**
 * Mobile AIOps: the overview's Needs-attention inbox and Noise section, from the same loaders as the
 * desktop page. The remaining sections stay on the desktop overview.
 */
export default async function MobileIntelligencePage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string | string[] }>;
}) {
  await requirePageAccess('/m/intelligence');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/intelligence'));
  await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const actor = context.actor;
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  const params = await searchParams;
  const range = resolveOverviewWindow(parseOverviewWindow(params?.window));
  const [scope, statusResult] = await Promise.all([
    resolveOverviewScope(actor),
    loadSection('status', getOverviewStatus),
  ]);
  const status = statusResult.ok
    ? statusResult.data
    : { enabled: true, mode: 'UNKNOWN', triageEnabled: true, responseEnabled: true };

  return (
    <div className="responsive-page space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {scope.global ? 'All services' : 'Your teams’ services'} · {range.label.toLowerCase()}
        </p>
        <WindowSelector current={range.key} basePath="/m/intelligence" />
      </div>

      <Suspense fallback={null}>
        <MobileAttention actor={actor} />
      </Suspense>

      <Suspense
        key={range.key}
        fallback={<SectionSkeleton title={SECTION_TITLES.noise} tiles={6} />}
      >
        <NoiseSection scope={scope} range={range} canManage={canManage} status={status} />
      </Suspense>
    </div>
  );
}
