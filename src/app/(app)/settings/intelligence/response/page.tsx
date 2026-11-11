import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';

/** "Dependencies, changes and alert quality" moved into Services & changes. The old address keeps working, query string included. */
export default async function IntelligenceResponseRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  redirect(legacyIntelligenceRedirect('/settings/intelligence/response', await searchParams));
}
