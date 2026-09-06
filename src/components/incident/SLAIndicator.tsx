'use client';

import { memo, useMemo, useState, useEffect } from 'react';
import { calculateMTTA, calculateMTTR, checkAckSLA, checkResolveSLA } from '@/lib/sla';
import { formatTimeMinutesMs } from '@/lib/time-format';
import {
  getPrioritySLATarget,
  checkPriorityAckSLA,
  checkPriorityResolveSLA,
} from '@/lib/sla-priority';
import { Incident, Service } from '@prisma/client';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, XCircle, Timer, TrendingUp, AlertCircle } from 'lucide-react';

type SLAIndicatorProps = {
  incident: Incident;
  service: Service;
  showDetails?: boolean;
};

function SLAIndicator({ incident, service, showDetails = false }: SLAIndicatorProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    mtta,
    mttr,
    ackSlaMet,
    resolveSlaMet,
    ackTimeRemaining,
    resolveTimeRemaining,
    targetAckMinutes,
    targetResolveMinutes,
    ackProgress,
    resolveProgress,
  } = useMemo(() => {
    if (!mounted) {
      return {
        mtta: null,
        mttr: null,
        ackSlaMet: null,
        resolveSlaMet: null,
        ackTimeRemaining: null,
        resolveTimeRemaining: null,
        targetAckMinutes: 0,
        targetResolveMinutes: 0,
        ackProgress: 0,
        resolveProgress: 0,
      };
    }

    const mtta = calculateMTTA(incident);
    const mttr = calculateMTTR(incident);

    const priorityTarget = getPrioritySLATarget(incident.priority, service);
    const ackSlaMet = incident.acknowledgedAt
      ? incident.priority
        ? checkPriorityAckSLA(incident, service)
        : checkAckSLA(incident, service)
      : null;
    const resolveSlaMet = incident.resolvedAt
      ? incident.priority
        ? checkPriorityResolveSLA(incident, service)
        : checkResolveSLA(incident, service)
      : null;

    const targetAckMinutes = priorityTarget.ack;
    const targetResolveMinutes = priorityTarget.resolve;

    const now = new Date();
    const timeSinceCreation = (now.getTime() - incident.createdAt.getTime()) / (1000 * 60);
    const ackTimeRemaining =
      incident.status === 'OPEN' && !incident.acknowledgedAt
        ? targetAckMinutes - timeSinceCreation
        : null;
    const resolveTimeRemaining =
      incident.status !== 'RESOLVED' && !incident.resolvedAt
        ? targetResolveMinutes - timeSinceCreation
        : null;

    // Calculate progress percentages
    const ackProgress = incident.acknowledgedAt
      ? 100
      : Math.min(100, Math.max(0, (timeSinceCreation / targetAckMinutes) * 100));
    const resolveProgress = incident.resolvedAt
      ? 100
      : Math.min(100, Math.max(0, (timeSinceCreation / targetResolveMinutes) * 100));

    return {
      mtta,
      mttr,
      ackSlaMet,
      resolveSlaMet,
      ackTimeRemaining,
      resolveTimeRemaining,
      targetAckMinutes,
      targetResolveMinutes,
      ackProgress,
      resolveProgress,
    };
  }, [incident, service, mounted]);

  if (!mounted) return null;

  // Compact mode for inline usage
  if (!showDetails) {
    return (
      <div className="flex gap-2 flex-wrap">
        {incident.acknowledgedAt && (
          <Badge variant={ackSlaMet ? 'success' : 'danger'} size="xs" className="gap-1">
            {ackSlaMet ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            Ack {ackSlaMet ? 'Met' : 'Breached'}
          </Badge>
        )}
        {incident.resolvedAt && (
          <Badge variant={resolveSlaMet ? 'success' : 'danger'} size="xs" className="gap-1">
            {resolveSlaMet ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            Resolve {resolveSlaMet ? 'Met' : 'Breached'}
          </Badge>
        )}
        {!incident.acknowledgedAt && !incident.resolvedAt && (
          <Badge
            variant={ackTimeRemaining && ackTimeRemaining > 0 ? 'warning' : 'danger'}
            size="xs"
            className="gap-1"
          >
            <Timer className="h-3 w-3" />
            {ackTimeRemaining && ackTimeRemaining > 0
              ? `${Math.round(ackTimeRemaining)}m left`
              : 'Breached'}
          </Badge>
        )}
      </div>
    );
  }

  // Detailed mode
  return (
    <div className="space-y-4">
      {/* Acknowledgement SLA */}
      <div className="p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Acknowledgement</span>
          </div>
          {incident.acknowledgedAt ? (
            <Badge variant={ackSlaMet ? 'success' : 'danger'} size="sm" className="gap-1">
              {ackSlaMet ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {ackSlaMet ? 'Met' : 'Breached'}
            </Badge>
          ) : (
            <Badge
              variant={ackTimeRemaining && ackTimeRemaining > 0 ? 'warning' : 'danger'}
              size="sm"
              className="gap-1"
            >
              <Timer className="h-3 w-3" />
              {ackTimeRemaining && ackTimeRemaining > 0
                ? `${Math.round(ackTimeRemaining)}m left`
                : 'Breached'}
            </Badge>
          )}
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${ackProgress >= 100 ? (incident.acknowledgedAt && ackSlaMet ? 'bg-green-500' : 'bg-red-500') : 'bg-primary'}`}
            style={{ width: `${Math.round(Math.min(100, ackProgress))}%` }}
          />
        </div>
        {mtta !== null && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span>
              Time: {formatTimeMinutesMs(mtta)} / Target: {targetAckMinutes}m
            </span>
          </div>
        )}
      </div>

      {/* Resolution SLA */}
      <div className="p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Resolution</span>
          </div>
          {incident.resolvedAt ? (
            <Badge variant={resolveSlaMet ? 'success' : 'danger'} size="sm" className="gap-1">
              {resolveSlaMet ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {resolveSlaMet ? 'Met' : 'Breached'}
            </Badge>
          ) : (
            <Badge
              variant={resolveTimeRemaining && resolveTimeRemaining > 0 ? 'warning' : 'danger'}
              size="sm"
              className="gap-1"
            >
              <Timer className="h-3 w-3" />
              {resolveTimeRemaining && resolveTimeRemaining > 0
                ? `${Math.round(resolveTimeRemaining)}m left`
                : 'Breached'}
            </Badge>
          )}
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${resolveProgress >= 100 ? (incident.resolvedAt && resolveSlaMet ? 'bg-green-500' : 'bg-red-500') : 'bg-primary'}`}
            style={{ width: `${Math.round(Math.min(100, resolveProgress))}%` }}
          />
        </div>
        {mttr !== null && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span>
              Time: {formatTimeMinutesMs(mttr)} / Target: {targetResolveMinutes}m
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SLAIndicator, (prevProps, nextProps) => {
  return (
    prevProps.incident.id === nextProps.incident.id &&
    prevProps.incident.status === nextProps.incident.status &&
    prevProps.incident.acknowledgedAt?.getTime() === nextProps.incident.acknowledgedAt?.getTime() &&
    prevProps.incident.resolvedAt?.getTime() === nextProps.incident.resolvedAt?.getTime() &&
    prevProps.incident.priority === nextProps.incident.priority &&
    prevProps.service.id === nextProps.service.id &&
    prevProps.showDetails === nextProps.showDetails
  );
});
