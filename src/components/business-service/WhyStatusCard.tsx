import Link from 'next/link';
import type { BsStatus } from '@/lib/business-services/contract';
import { SectionCard } from '@/components/analytics/SectionCard';
import { cn } from '@/lib/utils';

export type WhyReason = { text: string; href?: string };

/** The reasons behind the current status, each linking to its incident when the reader may open it. */
export default function WhyStatusCard({
  status,
  reasons,
}: {
  status: BsStatus;
  reasons: readonly WhyReason[];
}) {
  if (reasons.length === 0) return null;
  return (
    <SectionCard
      id="bs-why"
      title="Why this status"
      description={
        status === 'OPERATIONAL'
          ? 'Nothing is affecting it right now.'
          : 'What is driving the current status. Open an incident for the detail.'
      }
    >
      <ul className="space-y-1.5 text-sm">
        {reasons.map(reason => (
          <li key={reason.text} className="flex gap-2">
            <span
              aria-hidden
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
            />
            {reason.href ? (
              <Link
                href={reason.href}
                className={cn(
                  'font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                {reason.text}
                <span className="sr-only"> (open incident)</span>
              </Link>
            ) : (
              <span>{reason.text}</span>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
