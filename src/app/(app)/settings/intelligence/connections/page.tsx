import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';

/** "Connections" moved into Assistant. The old address keeps working, query string included. */
export default async function IntelligenceConnectionsRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  redirect(legacyIntelligenceRedirect('/settings/intelligence/connections', await searchParams));
}
