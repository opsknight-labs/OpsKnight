import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';

/** Compact incident status pill for mobile cards; delegates to the shared `StatusBadge`. */
export function IncidentStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge status={status} size="xs" className={className} />;
}

/** Compact urgency pill for mobile cards; delegates to the shared `SeverityBadge`. */
export function IncidentUrgencyBadge({
  urgency,
  className,
}: {
  urgency?: string | null;
  className?: string;
}) {
  return <SeverityBadge urgency={urgency} size="xs" className={className} />;
}
