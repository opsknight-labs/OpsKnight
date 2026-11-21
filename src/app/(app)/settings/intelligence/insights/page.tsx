import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import { requirePageAccess } from '@/lib/access/server';

/** "Insights" moved into Evaluation & spend. The old address keeps working, query string included. */
export default async function IntelligenceInsightsRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/insights');
  redirect(legacyIntelligenceRedirect('/settings/intelligence/insights', await searchParams));
}
