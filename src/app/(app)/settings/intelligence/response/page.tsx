import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import { requirePageAccess } from '@/lib/access/server';

/** "Dependencies, changes and alert quality" moved into Services & changes. The old address keeps working, query string included. */
export default async function IntelligenceResponseRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/response');
  redirect(legacyIntelligenceRedirect('/settings/intelligence/response', await searchParams));
}
