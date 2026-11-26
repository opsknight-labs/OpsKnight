import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import type { PrePagingLookupHealth } from '@/lib/intelligence/noise-controls/health';

/**
 * Shown when most dedup, flapping and storm lookups ran past their deadline: those alerts paged normally and
 * nothing was recorded, so "Would have avoided 0" and an empty decision list look like quiet traffic. Rules
 * and maintenance windows are decided from memory and are not affected.
 */
export default function LookupDeadlineNotice({ health }: { health: PrePagingLookupHealth }) {
  if (!health.warn) return null;
  const percent = Math.round(health.rate * 100);
  return (
    <div
      role="status"
      className={cn('rounded-lg border px-4 py-3 text-sm', toneClasses('elevated').soft)}
    >
      <p className="font-medium">
        Dedup, flapping and storm grouping did not run for {percent}% of recent alerts
      </p>
      <p className="mt-1">
        {health.failedOpen} of {health.lookups} lookups on this server took longer than the{' '}
        {health.deadlineMs} ms limit, so those alerts paged normally and no decision was recorded.
        Suppression rules and maintenance windows are not affected. Raise the limit with the{' '}
        <code>PREPAGING_DEADLINE_MS</code> environment variable (1 to 50) or check database latency.
      </p>
    </div>
  );
}
