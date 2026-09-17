'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldCheck, Clock, Sliders, Calendar, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import IncidentSlaPolicySettings from '@/components/incident-sla/IncidentSlaPolicySettings';
import IncidentClassificationSettings from '@/components/incident-sla/IncidentClassificationSettings';
import ServiceSupportHoursSettings from '@/components/service/ServiceSupportHoursSettings';

interface ServiceResponsePolicyHubProps {
  serviceId: string;
  incidentSlaPolicy: any;
  workspaceIncidentSlaPolicy: any;
  incidentClassificationPolicy: any;
  responseSupportHoursPolicy: any;
  canManage: boolean;
}

export default function ServiceResponsePolicyHub({
  serviceId,
  incidentSlaPolicy,
  workspaceIncidentSlaPolicy,
  incidentClassificationPolicy,
  responseSupportHoursPolicy,
  canManage,
}: ServiceResponsePolicyHubProps) {
  const [activeTab, setActiveTab] = useState<'sla' | 'classification' | 'hours'>('sla');

  const isInheritingSla = incidentSlaPolicy?.inheritWorkspace ?? true;
  const coverageMode = responseSupportHoursPolicy?.mode ?? 'INHERIT';

  return (
    <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs mt-0.5">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <span className="text-muted-foreground font-mono text-xs">3.</span>
                <span>Response Policies & SLAs</span>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Target SLA response times, priority classifications, and operational coverage for
                this service.
              </CardDescription>
            </div>
          </div>

          {/* Status Badges */}
          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] font-semibold px-2 py-0.5 inline-flex items-center gap-1.5',
                isInheritingSla
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {isInheritingSla ? 'Workspace SLA' : 'Custom SLA'}
            </Badge>

            <Badge
              variant="outline"
              className={cn(
                'text-[10px] font-semibold px-2 py-0.5 inline-flex items-center gap-1.5',
                coverageMode === 'ALWAYS'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : coverageMode === 'SCHEDULED'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    : 'bg-muted text-muted-foreground border-border'
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {coverageMode === 'ALWAYS'
                ? '24×7 Coverage'
                : coverageMode === 'SCHEDULED'
                  ? 'Scheduled Hours'
                  : 'Workspace Hours'}
            </Badge>
          </div>
        </div>

        {/* Segmented Sub-Tab Switcher */}
        <div className="flex items-center gap-1.5 pt-3 border-t border-border/40 mt-3 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('sla')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
              activeTab === 'sla'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>SLA Targets & Deadlines</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('classification')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
              activeTab === 'classification'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Alert Classification</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('hours')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
              activeTab === 'hours'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>Support Hours & Coverage</span>
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {activeTab === 'sla' && (
          <IncidentSlaPolicySettings
            scopeKey={`service:${serviceId}`}
            policy={incidentSlaPolicy}
            workspacePolicy={workspaceIncidentSlaPolicy}
            canManage={canManage}
            embedded={true}
          />
        )}

        {activeTab === 'classification' && (
          <IncidentClassificationSettings
            scopeKey={`service:${serviceId}`}
            policy={
              incidentClassificationPolicy
                ? {
                    version: incidentClassificationPolicy.version,
                    derivePriorityFromUrgency:
                      incidentClassificationPolicy.derivePriorityFromUrgency,
                    priorityFallbackMode: incidentClassificationPolicy.priorityFallbackMode,
                    rules: incidentClassificationPolicy.rules,
                  }
                : null
            }
            embedded={true}
          />
        )}

        {activeTab === 'hours' && (
          <ServiceSupportHoursSettings
            serviceId={serviceId}
            policy={
              responseSupportHoursPolicy
                ? {
                    version: responseSupportHoursPolicy.version ?? 0,
                    timezone: responseSupportHoursPolicy.timezone ?? 'UTC',
                    mode: responseSupportHoursPolicy.mode ?? 'INHERIT',
                    windows: responseSupportHoursPolicy.windows ?? [],
                    exceptions: responseSupportHoursPolicy.exceptions
                      ? responseSupportHoursPolicy.exceptions.map((exc: any) => ({
                          localDate:
                            typeof exc.localDate === 'string'
                              ? exc.localDate
                              : exc.localDate.toISOString().slice(0, 10),
                          available: exc.available,
                          startMinute: exc.startMinute,
                          endMinute: exc.endMinute,
                          label: exc.label,
                        }))
                      : [],
                  }
                : null
            }
            canManage={canManage}
          />
        )}
      </CardContent>
    </Card>
  );
}
