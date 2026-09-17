'use client';

import { useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify } from '@/lib/toast';
import { saveIncidentSlaPolicyAction } from '@/app/(app)/settings/incident-sla/actions';
import { getIncidentPriorityDefinition } from '@/lib/incidents/priority';
import { Clock, Loader2, Sparkles, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Rule = {
  priority: string;
  ackTargetMs: number;
  resolveTargetMs: number;
  label: string | null;
};

type Policy = {
  version: number;
  inheritWorkspace: boolean;
  baseAckTargetMs: number | null;
  baseResolveTargetMs: number | null;
  rules: Rule[];
} | null;

const priorities = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
type Priority = (typeof priorities)[number];
type EditableRule = { priority: Priority; enabled: boolean; ack: string; resolve: string };

const minutes = (ms: number | null | undefined) =>
  ms == null ? '' : String(Math.round(ms / 60000));

const PRIORITY_STYLES: Record<Priority, { badge: string; dot: string; title: string }> = {
  P1: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dot: 'bg-rose-500',
    title: 'Critical Outage',
  },
  P2: {
    badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    dot: 'bg-orange-500',
    title: 'Major Degradation',
  },
  P3: {
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dot: 'bg-amber-500',
    title: 'Moderate Impact',
  },
  P4: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    dot: 'bg-blue-500',
    title: 'Low Impact',
  },
  P5: {
    badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    dot: 'bg-slate-500',
    title: 'Informational',
  },
};

const ACK_PRESETS = [
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
];

const RESOLVE_PRESETS = [
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
  { label: '2h', value: '120' },
  { label: '4h', value: '240' },
  { label: '24h', value: '1440' },
];

export default function IncidentSlaPolicySettings({
  scopeKey,
  policy,
  workspacePolicy = null,
  canManage,
  embedded = false,
}: {
  scopeKey: string;
  policy: Policy;
  workspacePolicy?: Policy;
  canManage: boolean;
  embedded?: boolean;
}) {
  const isService = scopeKey.startsWith('service:');
  const [version, setVersion] = useState(policy?.version ?? 0);
  const [inherit, setInherit] = useState(isService && (policy?.inheritWorkspace ?? true));
  const [ack, setAck] = useState(minutes(policy?.baseAckTargetMs));
  const [resolve, setResolve] = useState(minutes(policy?.baseResolveTargetMs));
  const [rules, setRules] = useState<EditableRule[]>(() =>
    priorities.map(priority => {
      const rule = policy?.rules.find(candidate => candidate.priority === priority);
      return {
        priority,
        enabled: Boolean(rule),
        ack: minutes(rule?.ackTargetMs),
        resolve: minutes(rule?.resolveTargetMs),
      };
    })
  );
  const [pending, startTransition] = useTransition();

  const effectiveBase = inherit ? workspacePolicy : policy;
  const effectiveSource = inherit ? 'Workspace defaults' : 'Service policy';

  const updateRule = (
    priority: Priority,
    field: 'enabled' | 'ack' | 'resolve',
    value: boolean | string
  ) =>
    setRules(current =>
      current.map(rule => {
        if (rule.priority !== priority) return rule;
        if (field === 'enabled') return { ...rule, enabled: Boolean(value) };
        if (field === 'ack') return { ...rule, ack: String(value) };
        return { ...rule, resolve: String(value) };
      })
    );

  const submit = () => {
    const incompleteRule = rules.find(
      rule => rule.enabled && (rule.ack.trim() === '' || rule.resolve.trim() === '')
    );
    if (incompleteRule) {
      notify.error(`${incompleteRule.priority} needs both acknowledgement and resolution targets.`);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveIncidentSlaPolicyAction({
          scopeKey,
          expectedVersion: version,
          inheritWorkspace: inherit,
          baseAckTargetMs: inherit ? null : Number(ack) * 60000,
          baseResolveTargetMs: inherit ? null : Number(resolve) * 60000,
          rules: rules.flatMap(rule => {
            return rule.enabled
              ? [
                  {
                    priority: rule.priority,
                    ackTargetMs: Number(rule.ack) * 60000,
                    resolveTargetMs: Number(rule.resolve) * 60000,
                    label: `${rule.priority} ${getIncidentPriorityDefinition(rule.priority).label}`,
                  },
                ]
              : [];
          }),
        });
        if (!result.ok) {
          notify.error(result.message);
          return;
        }
        setVersion(result.version);
        notify.success('Incident response SLA policy saved for future incidents.');
      } catch {
        notify.error('Unable to save the incident response SLA policy. Try again.');
      }
    });
  };

  const content = (
    <div className="space-y-6">
      {/* Service Inheritance & Effective Summary */}
      {isService && (
        <div className="rounded-xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/20 p-4 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inherit}
                    disabled={!canManage || pending}
                    onChange={e => setInherit(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <span>Inherit workspace defaults</span>
                </label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Base targets automatically track workspace defaults; optional priority overrides
                  remain available.
                </p>
              </div>
            </div>

            <Badge
              variant="outline"
              className={cn(
                'text-[10px] font-semibold w-fit px-2.5 py-0.5 inline-flex items-center gap-1.5 shrink-0',
                inherit
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {inherit ? 'Inherited Mode' : 'Custom Service Policy'}
            </Badge>
          </div>

          {/* Effective SLA Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border/40">
            <div className="p-2.5 rounded-lg bg-background/60 border border-border/50">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Effective source
              </span>
              <span className="text-xs font-bold text-foreground mt-0.5 block">
                {effectiveBase
                  ? `${effectiveSource} · v${effectiveBase.version}`
                  : 'Not configured'}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-background/60 border border-border/50">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Effective acknowledgement
              </span>
              <span className="text-xs font-bold text-foreground mt-0.5 block">
                {effectiveBase?.baseAckTargetMs == null
                  ? 'Unavailable'
                  : `${minutes(effectiveBase.baseAckTargetMs)} minutes`}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-background/60 border border-border/50">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Effective resolution
              </span>
              <span className="text-xs font-bold text-foreground mt-0.5 block">
                {effectiveBase?.baseResolveTargetMs == null
                  ? 'Unavailable'
                  : `${minutes(effectiveBase.baseResolveTargetMs)} minutes`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Base SLA Targets (when not inheriting or at workspace level) */}
      {!inherit && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Base SLA Targets
            </span>
            <span className="text-[10px] text-muted-foreground">
              Default response times when no priority override matches
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Acknowledgement Card */}
            <div className="p-4 rounded-xl border border-border/80 bg-card shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor={`${scopeKey}-ack`}
                  className="text-xs font-semibold text-foreground"
                >
                  Base Acknowledgement SLA
                </Label>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {ack ? `${ack} mins` : 'Unset'}
                </span>
              </div>
              <div className="relative">
                <Input
                  id={`${scopeKey}-ack`}
                  type="number"
                  min="1"
                  value={ack}
                  disabled={!canManage || pending}
                  onChange={e => setAck(e.target.value)}
                  placeholder="e.g. 15"
                  className="text-xs h-9 font-mono pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">
                  mins
                </span>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] text-muted-foreground font-medium mr-1">Presets:</span>
                {ACK_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={!canManage || pending}
                    onClick={() => setAck(p.value)}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer',
                      ack === p.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/40 hover:bg-muted border-border/70 text-foreground'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution Card */}
            <div className="p-4 rounded-xl border border-border/80 bg-card shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor={`${scopeKey}-resolve`}
                  className="text-xs font-semibold text-foreground"
                >
                  Base Resolution SLA
                </Label>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {resolve ? `${resolve} mins` : 'Unset'}
                </span>
              </div>
              <div className="relative">
                <Input
                  id={`${scopeKey}-resolve`}
                  type="number"
                  min="1"
                  value={resolve}
                  disabled={!canManage || pending}
                  onChange={e => setResolve(e.target.value)}
                  placeholder="e.g. 120"
                  className="text-xs h-9 font-mono pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">
                  mins
                </span>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] text-muted-foreground font-medium mr-1">Presets:</span>
                {RESOLVE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={!canManage || pending}
                    onClick={() => setResolve(p.value)}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer',
                      resolve === p.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/40 hover:bg-muted border-border/70 text-foreground'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Priority Overrides Matrix */}
      {(isService || scopeKey === 'workspace') && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Priority-Specific Overrides
            </span>
            <span className="text-[10px] text-muted-foreground">
              Unchecked priorities automatically inherit the base targets above
            </span>
          </div>

          <div className="rounded-xl border border-border/80 overflow-hidden shadow-2xs bg-card">
            {/* Table Header */}
            <div className="grid grid-cols-[1.2fr_1fr_1fr] sm:grid-cols-[1.5fr_1fr_1fr] gap-2 p-3 bg-muted/25 border-b border-border/60 text-[11px] font-semibold text-muted-foreground">
              <span>Priority Level</span>
              <span>Ack Target (Mins)</span>
              <span>Resolve Target (Mins)</span>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-border/40">
              {rules.map(rule => {
                const style = PRIORITY_STYLES[rule.priority];
                const priorityDef = getIncidentPriorityDefinition(rule.priority);
                return (
                  <div
                    key={rule.priority}
                    className={cn(
                      'grid grid-cols-[1.2fr_1fr_1fr] sm:grid-cols-[1.5fr_1fr_1fr] gap-2 items-center p-3 transition-colors',
                      rule.enabled ? 'bg-background/80' : 'bg-muted/10 opacity-75'
                    )}
                  >
                    {/* Priority & Toggle */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        id={`rule-enable-${rule.priority}`}
                        checked={rule.enabled}
                        disabled={!canManage || pending}
                        onChange={e => updateRule(rule.priority, 'enabled', e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                      />
                      <label
                        htmlFor={`rule-enable-${rule.priority}`}
                        className="flex items-center gap-2 cursor-pointer select-none min-w-0"
                      >
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-mono font-bold px-1.5 py-0 shrink-0',
                            style.badge
                          )}
                        >
                          {rule.priority}
                        </Badge>
                        <div className="min-w-0 hidden xs:block">
                          <span className="text-xs font-semibold text-foreground block truncate">
                            {priorityDef.label}
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Ack Target Input */}
                    <div className="relative">
                      <Input
                        type="number"
                        min="1"
                        value={rule.ack}
                        disabled={!canManage || pending || !rule.enabled}
                        onChange={e => updateRule(rule.priority, 'ack', e.target.value)}
                        placeholder={ack || '15'}
                        aria-label={`${rule.priority} Ack minutes`}
                        className={cn(
                          'text-xs h-8 font-mono pr-8',
                          !rule.enabled && 'bg-muted/40 text-muted-foreground'
                        )}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-mono">
                        m
                      </span>
                    </div>

                    {/* Resolve Target Input */}
                    <div className="relative">
                      <Input
                        type="number"
                        min="1"
                        value={rule.resolve}
                        disabled={!canManage || pending || !rule.enabled}
                        onChange={e => updateRule(rule.priority, 'resolve', e.target.value)}
                        placeholder={resolve || '120'}
                        aria-label={`${rule.priority} Resolve minutes`}
                        className={cn(
                          'text-xs h-8 font-mono pr-8',
                          !rule.enabled && 'bg-muted/40 text-muted-foreground'
                        )}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-mono">
                        m
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Action Footer */}
      {canManage && (
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <p className="text-[11px] text-muted-foreground">
            SLA deadlines apply to newly created incidents only.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={submit}
            className="h-8 px-4 text-xs font-semibold shadow-2xs"
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Save SLA policy'
            )}
          </Button>
        </div>
      )}
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
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">Incident Response SLA</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                Base acknowledgement and resolution targets, with optional priority overrides.
                Applies to future incidents only.
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
