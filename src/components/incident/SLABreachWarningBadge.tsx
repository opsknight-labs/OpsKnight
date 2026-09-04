'use client';

import { memo, useMemo } from 'react';
import { Incident, Service } from '@prisma/client';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { getPrioritySLATarget } from '@/lib/sla-priority';
import { cn } from '@/lib/utils';

/**
 * SLA Breach Warning Badge
 *
 * Displays a warning indicator for incidents nearing SLA breach.
 */

type SLABreachWarningBadgeProps = {
  incident: Incident;
  service: Service;
  /** Warning threshold in minutes before breach */
  ackWarningMinutes?: number;
  resolveWarningMinutes?: number;
};

type BreachStatus =
  | 'none'
  | 'ack-warning'
  | 'resolve-warning'
  | 'ack-breached'
  | 'resolve-breached';

function SLABreachWarningBadge({
  incident,
  service,
  ackWarningMinutes = 5,
  resolveWarningMinutes = 15,
}: SLABreachWarningBadgeProps) {
  const { status, timeRemainingMinutes, targetType } = useMemo(() => {
    // Get priority-based or default SLA targets
    const priorityTarget = getPrioritySLATarget(incident.priority, service);
    const targetAckMs = priorityTarget.ack * 60 * 1000;
    const targetResolveMs = priorityTarget.resolve * 60 * 1000;

    // Check if already resolved
    if (incident.status === 'RESOLVED') {
      return { status: 'none' as BreachStatus, timeRemainingMinutes: 0, targetType: null };
    }

    const createdAt = new Date(incident.createdAt);
    const now = new Date();
    const elapsedMs = now.getTime() - createdAt.getTime();

    // Check ack SLA first (only if not acknowledged)
    if (!incident.acknowledgedAt) {
      const ackRemainingMs = targetAckMs - elapsedMs;
      const ackRemainingMinutes = ackRemainingMs / (60 * 1000);

      if (ackRemainingMs <= 0) {
        return {
          status: 'ack-breached' as BreachStatus,
          timeRemainingMinutes: 0,
          targetType: 'ack',
        };
      }
      if (ackRemainingMinutes <= ackWarningMinutes) {
        return {
          status: 'ack-warning' as BreachStatus,
          timeRemainingMinutes: Math.round(ackRemainingMinutes),
          targetType: 'ack',
        };
      }
    }

    // Check resolve SLA
    const resolveRemainingMs = targetResolveMs - elapsedMs;
    const resolveRemainingMinutes = resolveRemainingMs / (60 * 1000);

    if (resolveRemainingMs <= 0) {
      return {
        status: 'resolve-breached' as BreachStatus,
        timeRemainingMinutes: 0,
        targetType: 'resolve',
      };
    }
    if (resolveRemainingMinutes <= resolveWarningMinutes) {
      return {
        status: 'resolve-warning' as BreachStatus,
        timeRemainingMinutes: Math.round(resolveRemainingMinutes),
        targetType: 'resolve',
      };
    }

    return { status: 'none' as BreachStatus, timeRemainingMinutes: 0, targetType: null };
  }, [incident, service, ackWarningMinutes, resolveWarningMinutes]);

  // Don't render if no warning
  if (status === 'none') {
    return null;
  }

  const isBreached = status.includes('breached');
  const typeLabel = targetType === 'ack' ? 'ACK' : 'RESOLVE';
  const variant = isBreached ? 'danger' : 'warning';
  const Icon = isBreached ? AlertCircle : AlertTriangle;

  return (
    <Badge
      variant={variant}
      size="xs"
      className={cn('gap-1.5', isBreached && 'animate-pulse')}
      title={`SLA ${typeLabel} ${isBreached ? 'BREACHED' : 'warning'}`}
    >
      <Icon className="h-3 w-3" />
      {isBreached ? (
        <span>{typeLabel} breached</span>
      ) : (
        <span>
          {timeRemainingMinutes}m to {typeLabel}
        </span>
      )}
    </Badge>
  );
}

export default memo(SLABreachWarningBadge, (prevProps, nextProps) => {
  const prevAck = prevProps.incident.acknowledgedAt
    ? new Date(prevProps.incident.acknowledgedAt).getTime()
    : null;
  const nextAck = nextProps.incident.acknowledgedAt
    ? new Date(nextProps.incident.acknowledgedAt).getTime()
    : null;
  const prevCreated = new Date(prevProps.incident.createdAt).getTime();
  const nextCreated = new Date(nextProps.incident.createdAt).getTime();

  return (
    prevProps.incident.id === nextProps.incident.id &&
    prevProps.incident.status === nextProps.incident.status &&
    prevProps.incident.priority === nextProps.incident.priority &&
    prevAck === nextAck &&
    prevCreated === nextCreated &&
    prevProps.service.id === nextProps.service.id &&
    prevProps.service.targetAckMinutes === nextProps.service.targetAckMinutes &&
    prevProps.service.targetResolveMinutes === nextProps.service.targetResolveMinutes
  );
});
