import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import { requirePageAccess } from '@/lib/access/server';

/** "Squire memory" moved into Assistant. The old address keeps working, query string included. */
export default async function SquireMemoryRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/ai/memory');
  redirect(legacyIntelligenceRedirect('/settings/intelligence/ai/memory', await searchParams));
}
