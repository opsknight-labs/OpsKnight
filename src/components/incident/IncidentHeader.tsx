'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Incident, Service } from '@prisma/client';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import UserAvatar from '@/components/UserAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { updateIncidentUrgency, updateIncidentVisibility } from '@/app/(app)/incidents/actions';
import {
  Eye,
  EyeOff,
  Clock,
  CheckCircle2,
  Server,
  Shield,
  Users,
  User,
  AlertTriangle,
} from 'lucide-react';
import EscalationStatusBadge from './EscalationStatusBadge';
import AssigneeSection from './AssigneeSection';
import PrioritySelector from './PrioritySelector';

type IncidentHeaderProps = {
  incident: Incident & {
    service: Service & {
      policy?: { id: string; name: string } | null;
    };
    assignee: {
      id: string;
      name: string;
      email: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    team?: { id: string; name: string } | null;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    role?: string;
  }>;
  teams: Array<{ id: string; name: string }>;
  canManage: boolean;
};

export default function IncidentHeader({ incident, users, teams, canManage }: IncidentHeaderProps) {
  const { userTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const urgencyVariantMap: Record<'HIGH' | 'MEDIUM' | 'LOW', 'danger' | 'warning' | 'success'> = {
    HIGH: 'danger',
    MEDIUM: 'warning',
    LOW: 'success',
  };
  const urgencyDotMap: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
    HIGH: 'bg-red-500 animate-pulse',
    MEDIUM: 'bg-amber-500',
    LOW: 'bg-emerald-500',
  };
  const urgencyVariant =
    urgencyVariantMap[incident.urgency as 'HIGH' | 'MEDIUM' | 'LOW'] ?? 'success';
  const urgencyDot =
    urgencyDotMap[incident.urgency as 'HIGH' | 'MEDIUM' | 'LOW'] ?? urgencyDotMap.LOW;

  const handleVisibilityChange = (newVisibility: 'PUBLIC' | 'PRIVATE') => {
    startTransition(async () => {
      await updateIncidentVisibility(incident.id, newVisibility);
      router.refresh();
    });
  };

  const handleUrgencyChange = (newUrgency: string) => {
    startTransition(async () => {
      await updateIncidentUrgency(incident.id, newUrgency);
      router.refresh();
    });
  };

  const currentVisibility = (incident as any).visibility || 'PUBLIC';
  const isPrivate = currentVisibility === 'PRIVATE';

  return (
    <Card className="overflow-hidden bg-slate-50/50 border shadow-sm">
      <CardHeader className="py-4 px-4 border-b bg-white flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <PrioritySelector
            incidentId={incident.id}
            priority={incident.priority}
            canManage={canManage}
          />

          {/* Visibility Toggle */}
          {canManage ? (
            <Select
              value={(incident as any).visibility || 'PUBLIC'}
              onValueChange={val => handleVisibilityChange(val as 'PUBLIC' | 'PRIVATE')}
              disabled={isPending}
            >
              <SelectTrigger
                className={`h-7 w-fit gap-2 border px-2.5 shadow-sm transition-all text-xs font-semibold ${
                  isPrivate
                    ? 'bg-slate-800 text-white border-slate-900 hover:bg-slate-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {isPrivate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span>{isPrivate ? 'PRIVATE' : 'PUBLIC'}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">
                  <div className="flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5 text-slate-500" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-slate-900">Public</span>
                      <span className="text-[10px] text-slate-500">Visible on Status Page</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="PRIVATE">
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-slate-900">Private</span>
                      <span className="text-[10px] text-slate-500">Internal Dashboard Only</span>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold ${
                isPrivate
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-blue-50 text-blue-700 border-blue-100'
              }`}
            >
              {isPrivate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {currentVisibility}
            </div>
          )}

          {incident.escalationStatus && (
            <EscalationStatusBadge
              status={incident.escalationStatus}
              currentStep={incident.currentEscalationStep}
              nextEscalationAt={incident.nextEscalationAt}
            />
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
          <Clock className="h-3.5 w-3.5" />
          <span>{formatDateTime(incident.createdAt, userTimeZone, { format: 'relative' })}</span>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {/* Responsive grid - 2 cols on mobile, 4 on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Service */}
          <Link
            href={`/services/${incident.serviceId}`}
            className="group flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-primary/50 hover:shadow-md transition-all h-20 justify-center"
          >
            <div className="flex items-center gap-2 mb-1">
              <Server className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Service
              </span>
            </div>
            <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors truncate">
              {incident.service.name}
            </p>
          </Link>

          {/* Urgency - Editable */}
          <div className="flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-sm h-20 justify-center">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Urgency
              </span>
            </div>
            {canManage ? (
              <Select
                value={incident.urgency}
                onValueChange={handleUrgencyChange}
                disabled={isPending}
              >
                <SelectTrigger className="h-7 w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HIGH">
                    <div className="flex items-center gap-2 font-semibold text-red-700">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      HIGH
                    </div>
                  </SelectItem>
                  <SelectItem value="MEDIUM">
                    <div className="flex items-center gap-2 font-semibold text-amber-700">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      MEDIUM
                    </div>
                  </SelectItem>
                  <SelectItem value="LOW">
                    <div className="flex items-center gap-2 font-semibold text-emerald-700">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      LOW
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant={urgencyVariant} size="sm" className="gap-1.5 uppercase">
                <span className={`h-2 w-2 rounded-full ${urgencyDot}`} />
                {incident.urgency}
              </Badge>
            )}
          </div>

          {/* Assignee */}
          <div className="flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-sm h-20 justify-center relative overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Assignee
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              {incident.team ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 border border-indigo-200">
                    <Users className="h-3.5 w-3.5 text-indigo-600" />
                  </div>
                  <span className="text-sm font-bold text-slate-900 truncate">
                    {incident.team.name}
                  </span>
                </div>
              ) : incident.assignee ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <UserAvatar
                    userId={incident.assignee.id}
                    name={incident.assignee.name}
                    gender={incident.assignee.gender}
                    avatarUrl={incident.assignee.avatarUrl}
                    size="sm"
                    className="border-slate-200 shadow-sm"
                  />
                  <span className="text-sm font-bold text-slate-900 truncate">
                    {incident.assignee.name}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 border-dashed">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <span className="text-sm text-slate-500 italic font-medium">Unassigned</span>
                </div>
              )}
              {canManage && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <AssigneeSection
                    assignee={incident.assignee}
                    team={incident.team || null}
                    assigneeId={incident.assigneeId}
                    teamId={incident.teamId}
                    users={users}
                    teams={teams}
                    incidentId={incident.id}
                    canManage={canManage}
                    variant="header"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Policy */}
          {incident.service.policy ? (
            <Link
              href={`/policies/${incident.service.policy.id}`}
              className="group flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-primary/50 hover:shadow-md transition-all h-20 justify-center"
            >
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Policy
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors truncate">
                {incident.service.policy.name}
              </p>
            </Link>
          ) : (
            <div className="flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-sm h-20 justify-center opacity-75">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Policy
                </span>
              </div>
              <p className="text-sm text-slate-500 italic">None</p>
            </div>
          )}
        </div>

        {/* Timeline Row - Separate for clarity */}
        {(incident.acknowledgedAt || incident.resolvedAt) && (
          <div className="mt-2 pt-2 border-t flex flex-wrap gap-3 text-xs">
            {incident.acknowledgedAt && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  Ack'd{' '}
                  {formatDateTime(incident.acknowledgedAt, userTimeZone, { format: 'relative' })}
                </span>
              </div>
            )}
            {incident.resolvedAt && (
              <div className="flex items-center gap-1.5 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  Resolved{' '}
                  {formatDateTime(incident.resolvedAt, userTimeZone, { format: 'relative' })}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
