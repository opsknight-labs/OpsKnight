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

export default function IncidentClassificationSettings({
  policy,
  scopeKey = 'workspace',
}: {
  policy: {
    version: number;
    derivePriorityFromUrgency: boolean;
    priorityFallbackMode?: 'INHERIT' | 'ENABLED' | 'DISABLED';
    rules: Rule[];
  } | null;
  scopeKey?: string;
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

  return (
    <Card>
      <CardHeader className="border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Alert classification</CardTitle>
            <CardDescription>
              Severity always maps to notification urgency. Assign a response priority only when you
              want the source signal to choose a P1–P5 SLA contract.
            </CardDescription>
          </div>
          <Badge variant="outline">v{version}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          Default upgrade behavior keeps priority unassigned. Existing severity → urgency behavior
          is preserved until you explicitly opt into automatic priority assignment.
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-xs font-semibold text-muted-foreground">
          <span>Incoming severity</span>
          <span>Priority</span>
          <span>Urgency</span>
        </div>
        {rules.map(rule => (
          <div key={rule.matchValue} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
            <span className="capitalize text-sm font-medium">{rule.matchValue}</span>
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
              <SelectTrigger aria-label={`Priority for ${rule.matchValue} alerts`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeKey !== 'workspace' && <SelectItem value="INHERIT">Inherit</SelectItem>}
                <SelectItem value="FALLBACK">Use urgency fallback</SelectItem>
                <SelectItem value="CLEAR">No automatic priority</SelectItem>
                {INCIDENT_PRIORITIES.map(priority => (
                  <SelectItem key={priority} value={priority}>
                    {priority} {getIncidentPriorityDefinition(priority).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={(rule.urgencyMode ?? 'SET') === 'SET' ? rule.urgency! : rule.urgencyMode}
              disabled={pending}
              onValueChange={value =>
                update(rule.matchValue, {
                  urgencyMode:
                    value === 'INHERIT' ? 'INHERIT' : value === 'DEFAULT' ? 'DEFAULT' : 'SET',
                  urgency: value === 'INHERIT' || value === 'DEFAULT' ? null : (value as Urgency),
                })
              }
            >
              <SelectTrigger aria-label={`Urgency for ${rule.matchValue} alerts`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeKey !== 'workspace' && <SelectItem value="INHERIT">Inherit</SelectItem>}
                <SelectItem value="DEFAULT">Severity default</SelectItem>
                {(['HIGH', 'MEDIUM', 'LOW'] as const).map(urgency => (
                  <SelectItem key={urgency} value={urgency}>
                    {urgency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-2 rounded-md border p-3 text-xs">
          <strong>Urgency fallback</strong>
          <Select
            value={fallbackMode}
            disabled={pending}
            onValueChange={value => setFallbackMode(value as typeof fallbackMode)}
          >
            <SelectTrigger aria-label="Urgency fallback mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopeKey !== 'workspace' && (
                <SelectItem value="INHERIT">Inherit workspace</SelectItem>
              )}
              <SelectItem value="ENABLED">Enabled · HIGH→P1, MEDIUM→P3, LOW→P5</SelectItem>
              <SelectItem value="DISABLED">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground">
            A scoped Disabled selection overrides an enabled workspace fallback. Explicit “No
            automatic priority” rules remain terminal.
          </p>
          {fallbackMode === 'ENABLED' &&
            rules.some(rule => (rule.priorityMode ?? 'CLEAR') === 'CLEAR') && (
              <p className="text-amber-600 dark:text-amber-400">
                Rules set to “No automatic priority” override this fallback. Choose “Use urgency
                fallback” on those severities to apply HIGH→P1, MEDIUM→P3, or LOW→P5.
              </p>
            )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save classification policy'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
