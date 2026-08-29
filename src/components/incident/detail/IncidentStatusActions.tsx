'use client';

import { useState } from 'react';
import { IncidentStatus } from '@prisma/client';
import SnoozeDurationDialog from './SnoozeDurationDialog';
import { snoozeIncidentWithDuration } from '@/app/(app)/incidents/snooze-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Check, X, Clock, BellOff, Bell, Lock, CheckCircle2, Pause, Volume2 } from 'lucide-react';

type IncidentStatusActionsProps = {
  incidentId: string;
  currentStatus: IncidentStatus;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
  onSnooze: () => void;
  onUnsnooze: () => void;
  onSuppress: () => void;
  onUnsuppress: () => void;
  canManage: boolean;
  canAcknowledge: boolean;
};

export default function IncidentStatusActions({
  incidentId,
  currentStatus,
  onAcknowledge,
  onUnacknowledge,
  onSnooze: _onSnooze,
  onUnsnooze,
  onSuppress,
  onUnsuppress,
  canManage,
  canAcknowledge,
}: IncidentStatusActionsProps) {
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);

  if (!canManage && !canAcknowledge) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <Lock className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-900">Access Restricted</p>
            <p className="text-xs text-amber-700">Responder role required</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isResolved = currentStatus === 'RESOLVED';
  const isSnoozed = currentStatus === 'SNOOZED';
  const isSuppressed = currentStatus === 'SUPPRESSED';
  const isAcknowledged = currentStatus === 'ACKNOWLEDGED';

  if (isResolved) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-900">Incident Resolved</p>
            <p className="text-xs text-green-700">No further actions needed</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Primary Action - Acknowledge */}
      {isAcknowledged && canManage ? (
        <form action={onUnacknowledge}>
          <Button
            type="submit"
            variant="outline"
            className="w-full h-11 justify-center border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 font-medium"
          >
            <X className="h-4 w-4 mr-2" />
            Unacknowledge
          </Button>
        </form>
      ) : (
        canAcknowledge &&
        !isSuppressed &&
        !isSnoozed && (
          <form action={onAcknowledge}>
            <Button
              type="submit"
              className="w-full h-11 justify-center bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-medium shadow-sm"
            >
              <Check className="h-4 w-4 mr-2" />
              Acknowledge Incident
            </Button>
          </form>
        )
      )}

      {isSnoozed && canAcknowledge && (
        <form action={onAcknowledge}>
          <Button
            type="submit"
            className="w-full h-11 justify-center bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-medium shadow-sm"
          >
            <Check className="h-4 w-4 mr-2" />
            Acknowledge Incident
          </Button>
        </form>
      )}

      {/* Secondary Actions - Enhanced Cards */}
      {canManage && (
        <div className="grid grid-cols-2 gap-2">
          {isSnoozed ? (
            <form action={onUnsnooze} className="contents">
              <Button
                type="submit"
                variant="outline"
                className="h-auto py-3 flex-col gap-1 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 hover:border-indigo-300"
              >
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center mb-1">
                  <Bell className="h-3.5 w-3.5 text-indigo-600" />
                </div>
                <span className="text-xs font-medium text-indigo-700">Unsnooze</span>
                <span className="text-[10px] text-indigo-500">Resume alerts</span>
              </Button>
            </form>
          ) : (
            !isSuppressed && (
              <Button
                type="button"
                variant="outline"
                className="h-auto py-3 flex-col gap-1 border-slate-200 hover:border-slate-300 force-light-surface"
                onClick={() => setShowSnoozeDialog(true)}
              >
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center mb-1 force-light-surface">
                  <Pause className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <span className="text-xs font-medium text-slate-700">Snooze</span>
                <span className="text-[10px] text-slate-500">Pause alerts</span>
              </Button>
            )
          )}

          {isSuppressed ? (
            <form action={onUnsuppress} className="contents">
              <Button
                type="submit"
                variant="outline"
                className="h-auto py-3 flex-col gap-1 border-purple-200 bg-purple-50/50 hover:bg-purple-100 hover:border-purple-300"
              >
                <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center mb-1">
                  <Volume2 className="h-3.5 w-3.5 text-purple-600" />
                </div>
                <span className="text-xs font-medium text-purple-700">Unsuppress</span>
                <span className="text-[10px] text-purple-500">Enable alerts</span>
              </Button>
            </form>
          ) : (
            !isSnoozed && (
              <form action={onSuppress} className="contents">
                <Button
                  type="submit"
                  variant="outline"
                  className="h-auto py-3 flex-col gap-1 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
                >
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center mb-1">
                    <BellOff className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                  <span className="text-xs font-medium text-slate-700">Suppress</span>
                  <span className="text-[10px] text-slate-500">Mute alerts</span>
                </Button>
              </form>
            )
          )}
        </div>
      )}

      {showSnoozeDialog && (
        <SnoozeDurationDialog
          incidentId={incidentId}
          onClose={() => setShowSnoozeDialog(false)}
          onSnooze={snoozeIncidentWithDuration}
        />
      )}
    </div>
  );
}
