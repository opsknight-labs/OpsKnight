'use client';

import React, { useState } from 'react';
import {
  Clock,
  SlidersHorizontal,
  Layers,
  Activity,
  Info,
  CheckCircle2,
  ShieldAlert,
  CalendarClock,
  BookOpen,
  Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import IncidentSlaPolicySettings from '@/components/incident-sla/IncidentSlaPolicySettings';
import IncidentClassificationSettings from '@/components/incident-sla/IncidentClassificationSettings';
import ResponsePolicyOperations from '@/components/incident-sla/ResponsePolicyOperations';

type Rule = {
  priority: string;
  ackTargetMs: number;
  resolveTargetMs: number;
  label: string | null;
};

type ViewPolicy = {
  version: number;
  inheritWorkspace: boolean;
  baseAckTargetMs: number | null;
  baseResolveTargetMs: number | null;
  rules: Rule[];
} | null;

type ClassificationRule = {
  matchValue: 'critical' | 'error' | 'warning' | 'info';
  priorityMode: 'INHERIT' | 'FALLBACK' | 'SET' | 'CLEAR';
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | null;
  urgencyMode: 'INHERIT' | 'SET' | 'DEFAULT';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

type ViewClassificationPolicy = {
  version: number;
  derivePriorityFromUrgency: boolean;
  priorityFallbackMode: 'INHERIT' | 'ENABLED' | 'DISABLED';
  rules: ClassificationRule[];
} | null;

type ServiceItem = { id: string; name: string };
type IntegrationItem = { id: string; name: string; serviceId?: string };

type Props = {
  policy: ViewPolicy;
  classificationPolicy: ViewClassificationPolicy;
  serviceCount: number;
  inheritingCount: number;
  services: ServiceItem[];
  integrations: IntegrationItem[];
  supportHoursPolicy: {
    version: number;
    timezone: string;
    mode: 'INHERIT' | 'ALWAYS' | 'SCHEDULED';
    windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
    exceptions: Array<{
      localDate: string;
      available: boolean;
      startMinute: number | null;
      endMinute: number | null;
      label: string | null;
    }>;
  };
  scheduler: {
    mode: 'LEGACY' | 'SHADOW' | 'INDEXED';
    indexReady: boolean;
    missingHints: number;
    due: number;
    shadowCleanChecks: number;
    shadowMismatches: number;
  };
};

type SubTabId = 'objectives' | 'classification' | 'operations' | 'semantics';

const SUB_TABS: Array<{
  id: SubTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'objectives', label: 'SLA Objectives (P1–P5)', icon: Target },
  { id: 'classification', label: 'Alert Classification', icon: SlidersHorizontal },
  { id: 'operations', label: 'Support & Schedules', icon: CalendarClock },
  { id: 'semantics', label: 'Semantics & Reference', icon: BookOpen },
];

export default function IncidentSlaClientView({
  policy,
  classificationPolicy,
  serviceCount,
  inheritingCount,
  services,
  integrations,
  supportHoursPolicy,
  scheduler,
}: Props) {
  const [activeTab, setActiveTab] = useState<SubTabId>('objectives');

  const fallbackAckMin =
    policy?.baseAckTargetMs != null ? Math.round(policy.baseAckTargetMs / 60000) : null;
  const fallbackResolveHr =
    policy?.baseResolveTargetMs != null ? Math.round(policy.baseResolveTargetMs / 3600000) : null;
  const fallbackText =
    fallbackAckMin != null && fallbackResolveHr != null
      ? `${fallbackAckMin}m ack / ${fallbackResolveHr}h resolve`
      : 'Not configured';

  const isSchedulerActive = scheduler.indexReady;

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Top Header & Overview */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Incident Response Policy
            </h2>
            <Badge
              variant="outline"
              className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-medium"
            >
              Active · SLA v{policy?.version ?? 0}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs border-border/70 text-muted-foreground font-mono"
            >
              Workspace Scope
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Define acknowledgement and resolution targets, provider alert severity normalization,
            and operational support windows.
          </p>
        </div>
      </div>

      {/* Modern Top Metric Capsules (matching Overview & Compliance) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
              Fallback SLA
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">{fallbackText}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500 shrink-0">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
              Priority Rules
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {policy?.rules.length ?? 0} / 5 defined (P1–P5)
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-500 shrink-0">
            <Layers className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
              Services Inheriting
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {inheritingCount} / {serviceCount} services
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs flex items-center gap-3">
          <div
            className={cn(
              'rounded-lg p-2.5 shrink-0',
              isSchedulerActive
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-amber-500/10 text-amber-500'
            )}
          >
            <Activity className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
              SLA Scheduler
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  isSchedulerActive ? 'bg-emerald-500' : 'bg-amber-500'
                )}
              />
              <p className="text-sm font-bold text-foreground truncate">
                {scheduler.mode} · {scheduler.indexReady ? 'Ready' : 'Pending'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Notice Alert */}
      <div className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-foreground">
        <Info className="h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-muted-foreground">
          <strong className="text-foreground">
            Changes apply to future incident contracts only.
          </strong>{' '}
          Existing incidents preserve the specific targets and policy versions locked when they were
          triggered.
        </p>
      </div>

      {/* Segmented Sub-View Switcher */}
      <div className="flex items-center gap-1.5 border-b border-border/50 pb-2">
        {SUB_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all select-none',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Views */}
      <div className="space-y-6">
        {/* Tab 1: SLA Objectives */}
        {activeTab === 'objectives' && (
          <div className="space-y-6">
            <IncidentSlaPolicySettings scopeKey="workspace" policy={policy} canManage={true} />
          </div>
        )}

        {/* Tab 2: Alert Classification */}
        {activeTab === 'classification' && (
          <div className="space-y-6">
            <IncidentClassificationSettings policy={classificationPolicy} />
          </div>
        )}

        {/* Tab 3: Operations & Support Hours */}
        {activeTab === 'operations' && (
          <div className="space-y-6">
            <ResponsePolicyOperations
              services={services}
              integrations={integrations}
              supportVersion={supportHoursPolicy.version}
              supportTimezone={supportHoursPolicy.timezone}
              supportMode={supportHoursPolicy.mode}
              supportWindows={supportHoursPolicy.windows}
              supportExceptions={supportHoursPolicy.exceptions}
              schedulerMode={scheduler.mode}
              schedulerIndexReady={scheduler.indexReady}
              schedulerMissingHints={scheduler.missingHints}
              schedulerDue={scheduler.due}
              schedulerShadowCleanChecks={scheduler.shadowCleanChecks}
              schedulerShadowMismatches={scheduler.shadowMismatches}
            />
          </div>
        )}

        {/* Tab 4: Semantics & Rules Reference */}
        {activeTab === 'semantics' && (
          <div className="space-y-6">
            {/* SLA Semantics Card */}
            <div className="rounded-xl border border-border/70 bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">SLA Evaluation Semantics</h3>
              </div>
              <ul className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">
                      Source recovery before ACK deadline:
                    </strong>{' '}
                    If a monitor or webhook recovers prior to acknowledgement deadline, the incident
                    is resolved automatically and acknowledgement is not required.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">Source recovery after ACK deadline:</strong>{' '}
                    If the source recovers after the ACK window has elapsed, the acknowledgement
                    objective is marked as breached.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">Manual resolution without ACK:</strong>{' '}
                    Closing an incident directly without first acknowledging it flags the
                    acknowledgement obligation as breached.
                  </span>
                </li>
              </ul>
            </div>

            {/* Concepts Grid */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs">
                  <ShieldAlert className="h-4 w-4 text-rose-500" />
                  <h4>Priority · P1–P5</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  Response obligation and immutable SLA selection. Priority overrides determine the
                  exact acknowledgement and resolution deadline targets.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs">
                  <Activity className="h-4 w-4 text-amber-500" />
                  <h4>Urgency · High / Medium / Low</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  Controls notification escalation frequency, quiet-hours bypass rules, and paging
                  intensity for responders on call.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs">
                  <SlidersHorizontal className="h-4 w-4 text-blue-500" />
                  <h4>Alert Severity</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  Raw provider signal (critical, error, warning, info) normalized by workspace
                  classification policies into internal urgency and priority levels.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
