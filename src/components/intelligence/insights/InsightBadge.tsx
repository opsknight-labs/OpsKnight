import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import type { OpsInsightCount, OpsInsightSeverity } from '@/lib/intelligence/ops-insights/contract';

export const INSIGHT_SEVERITY = {
  CRITICAL: { variant: 'danger', label: 'Critical' },
  WARNING: { variant: 'warning', label: 'Warning' },
  INFO: { variant: 'info', label: 'Info' },
} as const satisfies Record<OpsInsightSeverity, { variant: string; label: string }>;

export function insightCountLabel(count: OpsInsightCount): string {
  const noun = count.open === 1 ? 'open insight' : 'open insights';
  return `${count.open} ${noun}, highest severity ${INSIGHT_SEVERITY[count.highest].label.toLowerCase()}`;
}

/**
 * Count of open insights on a list row, coloured by the highest severity. Renders nothing when there are
 * none. Server-renderable; feed it from `countOpenInsightsForScopes`.
 */
export default function InsightBadge({ count }: { count?: OpsInsightCount | null }) {
  if (!count || count.open <= 0) return null;
  const label = insightCountLabel(count);
  return (
    <Badge
      variant={INSIGHT_SEVERITY[count.highest].variant}
      size="xs"
      role="img"
      aria-label={label}
      title={label}
    >
      <Lightbulb aria-hidden="true" className="h-3 w-3" />
      {count.open > 99 ? '99+' : count.open}
    </Badge>
  );
}
