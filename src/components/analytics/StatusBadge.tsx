import { Badge } from '@/components/ui/shadcn/badge';
import { incidentStatusLabel } from '@/lib/incident-status';
import type { IncidentStatus } from '@prisma/client';

interface StatusBadgeProps {
  status: string;
  count?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export default function StatusBadge({ status, count, variant = 'default' }: StatusBadgeProps) {
  // Auto-detect variant based on status
  let autoVariant = variant;
  if (variant === 'default') {
    if (status === 'RESOLVED') autoVariant = 'success';
    else if (status === 'OPEN') autoVariant = 'danger';
    else if (status === 'ACKNOWLEDGED') autoVariant = 'info';
    else if (status === 'SNOOZED' || status === 'SUPPRESSED') autoVariant = 'warning';
  }

  return (
    <Badge variant={autoVariant} size="sm">
      {incidentStatusLabel(status as IncidentStatus)}
      {count !== undefined && (
        <Badge variant="outline" size="xs" className="ml-1 bg-white/50">
          {count}
        </Badge>
      )}
    </Badge>
  );
}
