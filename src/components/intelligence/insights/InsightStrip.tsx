import Link from 'next/link';
import { highestSeverity, type OpsInsightSeverity } from '@/lib/intelligence/ops-insights/contract';
import { cn } from '@/lib/utils';
import InsightBadge from './InsightBadge';

/**
 * One quiet line for a tab or section header: how many insights are open and the most severe one. Renders
 * nothing when there are none. Pass `href` to make the line a link to where the full list is.
 */
export default function InsightStrip({
  insights,
  href,
  className,
}: {
  insights: ReadonlyArray<{ severity: OpsInsightSeverity; title: string }>;
  href?: string;
  className?: string;
}) {
  if (insights.length === 0) return null;
  const highest = highestSeverity(insights.map(insight => insight.severity));
  const lead = insights.find(insight => insight.severity === highest) ?? insights[0];
  const more = insights.length - 1;
  const text = (
    <span className="min-w-0 truncate">
      {lead.title}
      {more > 0 && <span className="text-muted-foreground"> and {more} more</span>}
    </span>
  );
  return (
    <p
      data-insight-strip
      className={cn('flex min-w-0 items-center gap-2 text-sm text-foreground', className)}
    >
      <InsightBadge count={{ open: insights.length, highest }} />
      {href ? (
        <Link
          href={href}
          className="inline-flex min-h-11 min-w-0 items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
          {text}
        </Link>
      ) : (
        text
      )}
    </p>
  );
}
