import { redirect } from 'next/navigation';
import {
  legacyIntelligenceRedirect,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';

/** "Quality" moved into Evaluation & spend. The old address keeps working, query string included. */
export default async function IntelligenceQualityRedirect({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  redirect(legacyIntelligenceRedirect('/settings/intelligence/quality', await searchParams));
}
