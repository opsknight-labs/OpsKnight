'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import {
  saveScopedClassificationPolicyAction,
  saveWorkspaceClassificationPolicyAction,
} from '@/app/(app)/settings/incident-sla/actions';
import { INCIDENT_PRIORITIES, getIncidentPriorityDefinition } from '@/lib/incidents/priority';
import {
  ALERT_SEVERITIES,
  defaultAlertClassification,
  type AlertSeverity,
} from '@/lib/incidents/classification-contract';
import { Sliders, ArrowRight, AlertTriangle, Loader2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Priority = (typeof INCIDENT_PRIORITIES)[number];
type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';
type Rule = {
  matchValue: AlertSeverity;
  priorityMode?: 'INHERIT' | 'FALLBACK' | 'SET' | 'CLEAR';
  priority: Priority | null;
  urgencyMode?: 'INHERIT' | 'SET' | 'DEFAULT';
  urgency: Urgency | null;
};

function defaultRule(severity: AlertSeverity): Omit<Rule, 'matchValue'> {
  const classification = defaultAlertClassification(severity);
  return {
    priorityMode: classification.priority ? 'SET' : 'CLEAR',
    priority: classification.priority,
    urgencyMode: 'SET',
    urgency: classification.urgency,
  };
}

const SEVERITY_STYLES: Record<AlertSeverity, { badge: string; dot: string; label: string }> = {
  critical: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dot: 'bg-rose-500',
    label: 'Critical Alert',
  },
  error: {
    badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    dot: 'bg-orange-500',
    label: 'Error Alert',
  },
  warning: {
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dot: 'bg-amber-500',
    label: 'Warning Alert',
  },
  info: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    dot: 'bg-blue-500',
    label: 'Info Alert',
  },
};

export default function IncidentClassificationSettings({
  policy,
  scopeKey = 'workspace',
  embedded = false,
}: {
  policy: {
    version: number;
    derivePriorityFromUrgency: boolean;
    priorityFallbackMode?: 'INHERIT' | 'ENABLED' | 'DISABLED';
    rules: Rule[];
  } | null;
  scopeKey?: string;
  embedded?: boolean;
}) {
  const [version, setVersion] = useState(policy?.version ?? 0);
  const [fallbackMode, setFallbackMode] = useState<'INHERIT' | 'ENABLED' | 'DISABLED'>(
    policy?.priorityFallbackMode ??
      (policy?.derivePriorityFromUrgency
        ? 'ENABLED'
        : scopeKey === 'workspace'
          ? 'DISABLED'
          : 'INHERIT')
  );
  const [rules, setRules] = useState<Rule[]>(() =>
    ALERT_SEVERITIES.map(matchValue => ({
      matchValue,
      ...(policy?.rules.find(rule => rule.matchValue === matchValue) ?? defaultRule(matchValue)),
    }))
  );
  const [pending, startTransition] = useTransition();

  const update = (matchValue: AlertSeverity, patch: Partial<Rule>) =>
    setRules(current =>
      current.map(rule => (rule.matchValue === matchValue ? { ...rule, ...patch } : rule))
    );

  const save = () =>
    startTransition(async () => {
      try {
        const saveAction =
          scopeKey === 'workspace'
            ? saveWorkspaceClassificationPolicyAction
            : saveScopedClassificationPolicyAction;
        const result = await saveAction({
          ...(scopeKey === 'workspace' ? {} : { scopeKey }),
          expectedVersion: version,
          derivePriorityFromUrgency: fallbackMode === 'ENABLED',
          priorityFallbackMode: fallbackMode,
          rules,
        });
        if (!result.ok) {
          notify.error(result.message);
          return;
        }
        setVersion(result.version);
        notify.success('Classification policy saved for future incidents.');
      } catch {
        notify.error('Unable to save the alert classification policy. Try again.');
      }
    });

  const content = (
    <div className="space-y-6">
      {/* Information note */}
      <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 flex items-start gap-2.5 shadow-2xs">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Incoming alerts always map to responder notification urgency. Assign a response priority
          (P1–P5) only when you want the inbound signal to trigger a specific SLA commitment
          contract.
        </p>
      </div>

      {/* Classification Mapping Matrix */}
      <div className="space-y-3">
        <div className="rounded-xl border border-border/80 overflow-hidden shadow-2xs bg-card">
          {/* Table Header with Visual Direction Flow */}
          <div className="grid grid-cols-[1.1fr_auto_1.3fr_auto_1.1fr] items-center gap-2 p-3 bg-muted/25 border-b border-border/60 text-[11px] font-semibold text-muted-foreground">
            <span>Inbound Alert Severity</span>
            <span className="opacity-40">&rarr;</span>
            <span>Assigned SLA Priority</span>
            <span className="opacity-40">&rarr;</span>
            <span>Notification Urgency</span>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-border/40">
            {rules.map(rule => {
              const sev = SEVERITY_STYLES[rule.matchValue];
              return (
                <div
                  key={rule.matchValue}
                  className="grid grid-cols-[1.1fr_auto_1.3fr_auto_1.1fr] items-center gap-2 p-3 hover:bg-muted/10 transition-colors"
                >
                  {/* Severity Pill */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-2 w-2 rounded-full shrink-0', sev.dot)} />
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs font-semibold capitalize px-2 py-0.5 shrink-0',
                        sev.badge
                      )}
                    >
                      {rule.matchValue}
                    </Badge>
                  </div>

                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />

                  {/* Priority Selector */}
                  <Select
                    value={
                      (rule.priorityMode ?? (rule.priority ? 'SET' : 'CLEAR')) === 'SET'
                        ? rule.priority!
                        : (rule.priorityMode ?? 'CLEAR')
                    }
                    disabled={pending}
                    onValueChange={value =>
                      update(rule.matchValue, {
                        priorityMode:
                          value === 'INHERIT'
                            ? 'INHERIT'
                            : value === 'FALLBACK'
                              ? 'FALLBACK'
                              : value === 'CLEAR'
                                ? 'CLEAR'
                                : 'SET',
                        priority:
                          value === 'INHERIT' || value === 'FALLBACK' || value === 'CLEAR'
                            ? null
                            : (value as Priority),
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Priority for ${rule.matchValue} alerts`}
                      className="text-xs h-8 bg-background"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {scopeKey !== 'workspace' && (
                        <SelectItem value="INHERIT">Inherit workspace</SelectItem>
                      )}
                      <SelectItem value="FALLBACK">Use urgency fallback</SelectItem>
                      <SelectItem value="CLEAR">No automatic priority</SelectItem>
                      {INCIDENT_PRIORITIES.map(priority => (
                        <SelectItem key={priority} value={priority}>
                          <span className="font-mono font-bold mr-1.5">{priority}</span>
                          {getIncidentPriorityDefinition(priority).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />

                  {/* Urgency Selector */}
                  <Select
                    value={(rule.urgencyMode ?? 'SET') === 'SET' ? rule.urgency! : rule.urgencyMode}
                    disabled={pending}
                    onValueChange={value =>
                      update(rule.matchValue, {
                        urgencyMode:
                          value === 'INHERIT' ? 'INHERIT' : value === 'DEFAULT' ? 'DEFAULT' : 'SET',
                        urgency:
                          value === 'INHERIT' || value === 'DEFAULT' ? null : (value as Urgency),
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Urgency for ${rule.matchValue} alerts`}
                      className="text-xs h-8 bg-background"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {scopeKey !== 'workspace' && (
                        <SelectItem value="INHERIT">Inherit workspace</SelectItem>
                      )}
                      <SelectItem value="DEFAULT">Severity default</SelectItem>
                      {(['HIGH', 'MEDIUM', 'LOW'] as const).map(urgency => (
                        <SelectItem key={urgency} value={urgency}>
                          <span className="font-semibold">{urgency}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Urgency Fallback Strategy Card */}
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <span className="text-xs font-bold text-foreground block">
              Urgency Fallback Behavior
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Determines how unmapped alerts infer priority from notification urgency.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold w-fit px-2 py-0.5 shrink-0',
              fallbackMode === 'ENABLED'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : 'bg-muted text-muted-foreground border-border'
            )}
          >
            {fallbackMode === 'ENABLED' ? 'Fallback Active' : 'Fallback Disabled'}
          </Badge>
        </div>

        <Select
          value={fallbackMode}
          disabled={pending}
          onValueChange={value => setFallbackMode(value as typeof fallbackMode)}
        >
          <SelectTrigger aria-label="Urgency fallback mode" className="text-xs h-9 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scopeKey !== 'workspace' && (
              <SelectItem value="INHERIT">Inherit workspace fallback setting</SelectItem>
            )}
            <SelectItem value="ENABLED">
              Enabled · HIGH &rarr; P1, MEDIUM &rarr; P3, LOW &rarr; P5
            </SelectItem>
            <SelectItem value="DISABLED">Disabled · No automatic priority fallback</SelectItem>
          </SelectContent>
        </Select>

        <p className="text-[11px] text-muted-foreground">
          Scoped “Disabled” overrides an enabled workspace fallback. Severities set to “No automatic
          priority” remain explicitly unassigned.
        </p>

        {fallbackMode === 'ENABLED' &&
          rules.some(rule => (rule.priorityMode ?? 'CLEAR') === 'CLEAR') && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Rules set to “No automatic priority” override this fallback. To apply automatic
                fallback, select “Use urgency fallback” on those severities.
              </span>
            </div>
          )}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <p className="text-[11px] text-muted-foreground">
          Classification rules apply to incoming alert signals as they are processed.
        </p>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={save}
          className="h-8 px-4 text-xs font-semibold shadow-2xs"
        >
          {pending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            'Save classification policy'
          )}
        </Button>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">Alert Classification</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                Map incoming alert severity to notification urgency and response priority SLA
                contracts.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            v{version}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5">{content}</CardContent>
    </Card>
  );
}
