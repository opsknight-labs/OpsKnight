import Link from 'next/link';
import type { BsStatus } from '@/lib/business-services/contract';
import { SectionCard } from '@/components/analytics/SectionCard';
import { isImpacted } from './catalog-model';

/** Counts of what this business service leans on, and how many of those are impacted now. */
export default function DependencyHealthSummary({
  supporting,
  technicalCount,
  tabHref,
}: {
  supporting: readonly { status: BsStatus | null }[];
  technicalCount: number;
  tabHref: string;
}) {
  if (supporting.length === 0 && technicalCount === 0) return null;
  const impacted = supporting.filter(row => row.status && isImpacted(row.status)).length;
  const healthy = supporting.filter(row => row.status === 'OPERATIONAL').length;
  // Unknown, unloaded and maintenance are not "healthy": say so instead of folding them in.
  const unsure = supporting.length - impacted - healthy;
  return (
    <SectionCard id="bs-dependency-health" title="Dependency health">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Supporting business services</dt>
          <dd className="font-medium tabular-nums">
            {supporting.length === 0
              ? 'None'
              : [
                  impacted ? `${impacted} of ${supporting.length} impacted` : null,
                  healthy ? `${healthy} healthy` : null,
                  unsure ? `${unsure} unknown or in maintenance` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Technical services it depends on</dt>
          <dd className="font-medium tabular-nums">{technicalCount}</dd>
        </div>
      </dl>
      <Link
        href={tabHref}
        className="mt-3 inline-block text-xs font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        See dependencies
      </Link>
    </SectionCard>
  );
}
