'use client';

import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Play } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify } from '@/lib/toast';

export interface MonitoringStatusData {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly healthState?: 'DISABLED' | 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'STALE';
  readonly lastRun: {
    readonly status: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly controlsTargeted: number;
    readonly controlsEvaluated: number;
    readonly controlsFailed: number;
    readonly driftOpened: number;
    readonly driftResolved: number;
  } | null;
  readonly nextRunAt: string | null;
  readonly isStale: boolean;
  readonly openDriftCount: number;
  readonly acknowledgedDriftCount: number;
}

interface MonitoringStatusCardProps {
  readonly status: MonitoringStatusData | null;
  readonly canEvaluate?: boolean;
  readonly onSweepTriggered?: () => void;
}

export function MonitoringStatusCard({
  status,
  canEvaluate = false,
  onSweepTriggered,
}: MonitoringStatusCardProps) {
  const [isRunning, setIsRunning] = useState(false);

  if (!status) return null;

  const handleRunSweep = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/compliance/monitoring/runs', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to trigger monitoring run');
      }
      notify.success('Continuous monitoring sweep queued');
      if (onSweepTriggered) onSweepTriggered();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      setIsRunning(false);
    }
  };

  const isDegraded =
    status.lastRun?.status === 'PARTIAL_FAILED' ||
    status.lastRun?.status === 'FAILED' ||
    status.healthState === 'DEGRADED';

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Continuous Compliance Monitoring
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Evaluates runtime controls continuously and detects state drift without manual
            intervention.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {status.healthState === 'STALE' || status.isStale ? (
            <Badge variant="destructive" className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              MONITORING STALE
            </Badge>
          ) : status.healthState === 'STARTING' ? (
            <Badge
              variant="secondary"
              className="bg-sky-500/10 text-sky-500 border-sky-500/20 font-semibold"
            >
              <Clock className="h-3 w-3 mr-1" />
              Starting ({status.intervalMinutes}m cycle)
            </Badge>
          ) : isDegraded ? (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500 border-amber-500/20 font-semibold"
            >
              Monitoring Degraded
            </Badge>
          ) : !status.enabled || status.healthState === 'DISABLED' ? (
            <Badge variant="outline" className="text-muted-foreground font-semibold">
              Disabled
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-semibold"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Active ({status.intervalMinutes}m cycle)
            </Badge>
          )}

          {canEvaluate && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunSweep}
              disabled={isRunning}
              className="text-xs h-7 px-2.5"
            >
              <Play className="h-3 w-3 mr-1.5 text-primary" />
              {isRunning ? 'Running...' : 'Run Sweep Now'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground">Last Run</div>
            <div className="font-semibold text-sm">
              {status.lastRun?.completedAt
                ? new Date(status.lastRun.completedAt).toLocaleTimeString()
                : 'None yet'}
            </div>
            <div className="text-muted-foreground text-[11px]">
              {status.lastRun
                ? `${status.lastRun.controlsEvaluated} evaluated / ${status.lastRun.controlsFailed} failed`
                : 'Awaiting initial sweep'}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground">Next Scheduled Run</div>
            <div className="font-semibold text-sm flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {status.nextRunAt
                ? new Date(status.nextRunAt).toLocaleTimeString()
                : `${status.intervalMinutes}m interval`}
            </div>
            <div className="text-muted-foreground text-[11px]">
              {status.isStale ? 'Expected cycle delayed' : 'On schedule'}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground">Open Drift Episodes</div>
            <div
              className={`font-semibold text-sm ${status.openDriftCount > 0 ? 'text-rose-500' : 'text-emerald-500'}`}
            >
              {status.openDriftCount} active
            </div>
            <div className="text-muted-foreground text-[11px]">Requires operator attention</div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground">Acknowledged Drift</div>
            <div className="font-semibold text-sm text-amber-500">
              {status.acknowledgedDriftCount} acknowledged
            </div>
            <div className="text-muted-foreground text-[11px]">Pending technical recovery</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
