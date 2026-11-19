import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import { requirePageAccess } from '@/lib/access/server';

/** "Connections" moved into Assistant. The old address keeps working, query string included. */
export default async function IntelligenceConnectionsRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/connections');
  redirect(legacyIntelligenceRedirect('/settings/intelligence/connections', await searchParams));
}
