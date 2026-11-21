import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import { requirePageAccess } from '@/lib/access/server';

/** "Quality" moved into Evaluation & spend. The old address keeps working, query string included. */
export default async function IntelligenceQualityRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/quality');
  redirect(legacyIntelligenceRedirect('/settings/intelligence/quality', await searchParams));
}
