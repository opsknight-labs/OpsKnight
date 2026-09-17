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
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import IncidentSlaPolicySettings from '@/components/incident-sla/IncidentSlaPolicySettings';
import IncidentClassificationSettings from '@/components/incident-sla/IncidentClassificationSettings';
import ResponsePolicyOperations from '@/components/incident-sla/ResponsePolicyOperations';

import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';

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
      ? `${fallbackAckMin}m ack / ${fallbackResolveHr}h res`
      : 'Not configured';

  const isSchedulerActive = scheduler.indexReady;

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Canonical DetailHeroBanner */}
      <DetailHeroBanner
        tag="Governance & SLA Architecture"
        title="Incident SLAs & Response Policies"
        subtitle="Define acknowledgement and resolution targets, provider alert severity normalization, and operational support windows."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <ShieldCheck className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold"
            >
              Active · SLA v{policy?.version ?? 0}
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider font-mono"
            >
              Workspace Scope
            </Badge>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/services">
                <Layers className="h-3.5 w-3.5" />
                Services
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/settings">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Settings Hub
              </Link>
            </Button>
          </div>
        }
        stats={[
          {
            label: 'Fallback SLA',
            value: fallbackText,
            icon: <Clock className="h-3.5 w-3.5" />,
            subtext: 'Default deadline target',
          },
          {
            label: 'Priority Rules',
            value: `${policy?.rules.length ?? 0} / 5`,
            icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
            subtext: 'P1–P5 objectives defined',
          },
          {
            label: 'Services Inheriting',
            value: `${inheritingCount} / ${serviceCount}`,
            icon: <Layers className="h-3.5 w-3.5" />,
            subtext: 'Workspace policy bound',
          },
          {
            label: 'SLA Scheduler',
            value: `${scheduler.mode} · ${isSchedulerActive ? 'Ready' : 'Pending'}`,
            icon: <Activity className="h-3.5 w-3.5" />,
            subtext: isSchedulerActive ? 'Online index active' : 'Shadow/legacy routing',
          },
        ]}
        alert={
          <div className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-foreground">
            <Info className="h-4 w-4 shrink-0 text-blue-500" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">
                Changes apply to future incident contracts only.
              </strong>{' '}
              Existing incidents preserve the specific targets and policy versions locked when they
              were triggered.
            </p>
          </div>
        }
      />

      {/* Segmented Sub-View Switcher (Modern Pill Style) */}
      <div className="bg-card border border-border/70 p-1 rounded-xl inline-flex gap-1 shadow-xs overflow-x-auto max-w-full">
        {SUB_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all select-none whitespace-nowrap',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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
            <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-3 border-b border-border/60 pb-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">SLA Evaluation Semantics</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Deterministic transition conditions enforced during incident lifecycle events
                  </p>
                </div>
              </div>
              <ul className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">
                      Source recovery before ACK deadline:
                    </strong>{' '}
                    If a monitor or webhook recovers prior to acknowledgement deadline, the incident
                    is resolved automatically and acknowledgement is not required.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">Source recovery after ACK deadline:</strong>{' '}
                    If the source recovers after the ACK window has elapsed, the acknowledgement
                    objective is marked as breached.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
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
              <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 shrink-0 border border-rose-500/20">
                    <ShieldAlert className="h-3.5 w-3.5" />
                  </div>
                  <h4 className="font-bold text-xs text-foreground">Priority · P1–P5</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Response obligation and immutable SLA selection. Priority overrides determine the
                  exact acknowledgement and resolution deadline targets.
                </p>
              </div>

              <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 shrink-0 border border-amber-500/20">
                    <Activity className="h-3.5 w-3.5" />
                  </div>
                  <h4 className="font-bold text-xs text-foreground">Urgency · High / Med / Low</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Controls notification escalation frequency, quiet-hours bypass rules, and paging
                  intensity for responders on call.
                </p>
              </div>

              <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 shrink-0 border border-blue-500/20">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </div>
                  <h4 className="font-bold text-xs text-foreground">Alert Severity</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
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
