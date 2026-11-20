import 'server-only';

import { getAnalyticsSectionWithTime, type AnalyticsContext } from '@/lib/analytics';
import FreshnessControl from './FreshnessControl';

/** "Updated 2m ago · Refresh", timed off the KPI numbers (shared cache entry, no extra query). */
export default async function AnalyticsFreshness({ context }: { context: AnalyticsContext }) {
  const asOf = await getAnalyticsSectionWithTime(context, 'kpis')
    .then(result => result.asOf.toISOString())
    .catch(() => null); // KpiSection reports the failure; Refresh still works.
  return <FreshnessControl asOf={asOf} />;
}
