/* eslint-disable security/detect-object-injection -- status is a typed enum value, never request input */
import Link from 'next/link';
import type { BsStatus } from '@/lib/business-services/contract';
import { SectionCard } from '@/components/analytics/SectionCard';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { BS_STATUS_META } from './HealthBadge';

export type WhyReason = { text: string; href?: string };

/**
 * The reasons behind the current status, each linking to its incident when the reader may open it.
 * Carries the status tone as a left accent so an impacted service reads as such at a glance.
 */
export default function WhyStatusCard({
  status,
  reasons,
}: {
  status: BsStatus;
  reasons: readonly WhyReason[];
}) {
  return (
    <SectionCard
      id="bs-why"
      className={
        status === 'OPERATIONAL'
          ? undefined
          : cn('border-l-4', toneClasses(BS_STATUS_META[status].tone).borderLeft)
      }
      title="Why this status"
      description={
        status === 'OPERATIONAL'
          ? 'Nothing is affecting it right now.'
          : reasons.length === 0
            ? 'No incident, maintenance or dependency is recorded for this status.'
            : 'What is driving the current status. Open an incident for the detail.'
      }
    >
      <ul className="space-y-1.5 text-sm" hidden={reasons.length === 0}>
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
