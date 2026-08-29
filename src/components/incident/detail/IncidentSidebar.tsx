'use client';

import type { IncidentStatus, Service } from '@prisma/client';
import Link from 'next/link';
import StatusBadge from '../StatusBadge';
import SLAIndicator from '../SLAIndicator';
import IncidentQuickActions from '../IncidentQuickActions';
import IncidentStatusActions from './IncidentStatusActions';
import IncidentWatchers from './IncidentWatchers';
import IncidentTags from './IncidentTags';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { FileText, Zap, Activity, AlertCircle, ChevronRight, Eye, Tag } from 'lucide-react';

type IncidentSidebarProps = {
  incident: {
    id: string;
    status: IncidentStatus;
    assigneeId: string | null;
    assignee: { id: string; name: string; email: string } | null;
    service: {
      id: string;
      name: string;
      targetAckMinutes?: number | null;
      targetResolveMinutes?: number | null;
    };
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
    createdAt: Date;
    escalationStatus?: string | null;
    currentEscalationStep?: number | null;
    nextEscalationAt?: Date | null;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    role?: string;
  }>;
  watchers: Array<{
    id: string;
    user: { id: string; name: string; email: string };
    role: string;
  }>;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  canManage: boolean;
  canAcknowledge: boolean;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
  onSnooze: () => void;
  onUnsnooze: () => void;
  onSuppress: () => void;
  onUnsuppress: () => void;
  onAddWatcher: (formData: FormData) => void;
  onRemoveWatcher: (formData: FormData) => void;
};

export default function IncidentSidebar({
  incident,
  users,
  watchers,
  tags,
  canManage,
  canAcknowledge,
  onAcknowledge,
  onUnacknowledge,
  onSnooze,
  onUnsnooze,
  onSuppress,
  onUnsuppress,
  onAddWatcher,
  onRemoveWatcher,
}: IncidentSidebarProps) {
  const incidentStatus = incident.status as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const incidentForSLA = incident as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const serviceForSLA = incident.service as Service;

  return (
    <div className="space-y-6">
      {/* Actions Section */}
      <div className="rounded-xl border border-slate-200/60 bg-white/50 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Zap className="h-3 w-3" /> Actions
          </h3>
          <StatusBadge status={incidentStatus} size="sm" showDot />
        </div>
        <IncidentStatusActions
          incidentId={incident.id}
          currentStatus={incident.status}
          onAcknowledge={onAcknowledge}
          onUnacknowledge={onUnacknowledge}
          onSnooze={onSnooze}
          onUnsnooze={onUnsnooze}
          onSuppress={onSuppress}
          onUnsuppress={onUnsuppress}
          canManage={canManage}
          canAcknowledge={canAcknowledge}
        />
      </div>

      {/* SLA Section */}
      <div className="rounded-xl border border-slate-200/60 bg-white/50 shadow-sm p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
          <Activity className="h-3 w-3" /> SLA Status
        </h3>
        <SLAIndicator incident={incidentForSLA} service={serviceForSLA} showDetails={true} />
      </div>

      {/* Watchers Section */}
      <div className="rounded-xl border border-slate-200/60 bg-white/50 shadow-sm p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
          <Eye className="h-3 w-3" /> Watchers
        </h3>
        <IncidentWatchers
          watchers={watchers}
          users={users}
          canManage={canManage}
          onAddWatcher={onAddWatcher}
          onRemoveWatcher={onRemoveWatcher}
        />
      </div>

      {/* Tags Section */}
      <div className="rounded-xl border border-slate-200/60 bg-white/50 shadow-sm p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
          <Tag className="h-3 w-3" /> Tags
        </h3>
        <IncidentTags incidentId={incident.id} tags={tags} canManage={canManage} />
      </div>

      {/* Postmortem Section - Only show for resolved incidents */}
      {incident.status === 'RESOLVED' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-2 mb-3">
            <FileText className="h-3 w-3" /> Postmortem
          </h3>
          <Link href={`/postmortems/${incident.id}`}>
            <Button
              className="w-full justify-between group bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
              variant="outline"
            >
              <span>{canManage ? 'Create Report' : 'View Report'}</span>
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
