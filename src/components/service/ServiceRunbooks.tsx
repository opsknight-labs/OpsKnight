'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Prisma, RunbookInput } from '@prisma/client';
import {
  BookOpen,
  Settings2,
  Workflow,
  Zap,
  Sparkles,
  Play,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import { requiresAgent } from '@/lib/runbooks/types';
import {
  parseContextInputMappings,
  parseContextTargetMapping,
} from '@/lib/runbooks/automation-binding';
import { minimumRiskForStep } from '@/lib/runbooks/definition';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfirmAction,
  ConfigureSheet,
  SubmitButton,
  FormSelect,
} from '@/components/runbooks/RunbookControls';
import {
  attachRunbookAction,
  detachRunbookAction,
  updateRunbookBindingAction,
  configureRunbookTriggerAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import Field from '@/components/runbooks/RunbookField';
import { cn } from '@/lib/utils';
import TriggerConditionEditor from './runbooks/TriggerConditionEditor';
import ResolveOnVerifiedRecoveryToggle from './runbooks/ResolveOnVerifiedRecoveryToggle';
import { AttachTargetFields, BindingVersionTargetFields } from './runbooks/BindingTargetFields';
import UnattendedWritesPanel, {
  UnattendedWritesBadge,
  unattendedWritesStatus,
  type UnattendedWriteEligibility,
  type UnattendedWriteAuthorization,
} from './runbooks/UnattendedWritesPanel';
import { contextFieldKey, type AutomationContextSummary } from './runbooks/context-helpers';
import MonitoringIncidentsToggle from './runbooks/MonitoringIncidentsToggle';
import {
  ContextInputMappingEditor,
  ContextTargetMappingEditor,
} from './runbooks/AutomationMappingEditors';

export type ServiceRunbookBinding = Prisma.ServiceRunbookBindingGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}> & {
  executions?: Array<{
    id: string;
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    createdAt: Date | string;
  }>;
  _count?: {
    executions?: number;
  };
  unattendedWritesAuthorizedBy?: { name: string | null } | null;
};

/** Server-computed unattended-write details keyed by binding id (admin view only). */
export type ServiceRunbookUnattendedWriteDetails = Record<
  string,
  { eligibility: UnattendedWriteEligibility | null; authorizedAtLabel: string | null }
>;

export type AvailableRunbook = Prisma.RunbookGetPayload<{
  include: {
    publishedVersion: { include: { inputs: true } };
    versions: { include: { inputs: true } };
  };
}>;

export type ServiceRunbookAgent = {
  id: string;
  name: string;
  hostname: string | null;
  status?: string;
};

export type ServiceRunbookAgentPool = {
  id: string;
  name: string;
  mode: string;
  _count?: { members: number };
};

export default function ServiceRunbooks({
  serviceId,
  bindings,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  canManage,
  loadError,
  automationContext = null,
  unattendedWriteDetails = {},
  canAuthorizeUnattendedWrites = false,
}: {
  serviceId: string;
  bindings: ServiceRunbookBinding[];
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  canManage: boolean;
  loadError?: boolean;
  automationContext?: AutomationContextSummary | null;
  unattendedWriteDetails?: ServiceRunbookUnattendedWriteDetails;
  canAuthorizeUnattendedWrites?: boolean;
}) {
  const contextFields = automationContext?.fields ?? [];
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'AUTOMATIC' | 'MANUAL' | 'SUGGESTED'>('ALL');
  const [selectedAttachId, setSelectedAttachId] = useState<string>('');

  const unattached = useMemo(
    () => availableRunbooks.filter(r => !bindings.some(b => b.runbookId === r.id)),
    [availableRunbooks, bindings]
  );

  // Set default selected unattached runbook if not set
  const activeAttachRunbook = useMemo(() => {
    if (selectedAttachId) {
      return unattached.find(r => r.id === selectedAttachId) || unattached[0] || null;
    }
    return unattached[0] || null;
  }, [unattached, selectedAttachId]);

  // Client-side instant 0ms search & filter
  const filteredBindings = useMemo(() => {
    return bindings.filter(binding => {
      if (modeFilter !== 'ALL' && binding.mode !== modeFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const name = binding.runbook?.name?.toLowerCase() ?? '';
      const desc = binding.runbook?.description?.toLowerCase() ?? '';
      const agent =
        availableAgents.find(a => a.id === binding.defaultAgentId)?.name?.toLowerCase() ?? '';
      return name.includes(q) || desc.includes(q) || agent.includes(q);
    });
  }, [bindings, modeFilter, searchQuery, availableAgents]);

  // Statistics
  const autoCount = bindings.filter(b => b.enabled && b.mode === 'AUTOMATIC').length;
  const manualCount = bindings.filter(b => b.enabled && b.mode === 'MANUAL').length;
  const totalExecutions = bindings.reduce(
    (sum, b) => sum + (b._count?.executions ?? b.executions?.length ?? 0),
    0
  );

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <h3 className="mt-2 text-sm font-semibold text-foreground">Service runbooks unavailable</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
          Failed to load attached workflows from the database. Workflow bindings and triggers could not be retrieved. Please check database connectivity or refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Elevated Header with Live KPI Overview */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Service Runbooks</h2>
            <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
              {bindings.length} {bindings.length === 1 ? 'attached' : 'attached'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Attach automated diagnostic scripts, recovery playbooks, and safe operational procedures.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-2xs">
            <Link href="/runbooks">
              <BookOpen className="h-4 w-4" />
              <span>Library</span>
            </Link>
          </Button>

          {canManage && unattached.length > 0 && (
            <ConfigureSheet
              title="Attach Runbook to Service"
              description="Select a workflow from your library and configure service-specific inputs and execution target."
              trigger={
                <Button size="sm" className="h-9 gap-1.5 shadow-xs">
                  <Plus className="h-4 w-4" />
                  <span>Attach Runbook</span>
                </Button>
              }
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Runbook from Library</Label>
                  <FormSelect
                    name="selectedRunbook"
                    label="Choose workflow"
                    value={activeAttachRunbook?.id ?? ''}
                    onValueChange={setSelectedAttachId}
                    options={unattached.map(r => ({
                      value: r.id,
                      label: `${r.name} (v${r.publishedVersion?.version ?? '1'})`,
                    }))}
                  />
                </div>

                {activeAttachRunbook && (
                  <ActionForm
                    key={activeAttachRunbook.id}
                    action={attachRunbookAction.bind(null, serviceId)}
                    className="grid gap-3.5 rounded-lg border bg-muted/20 p-4 lg:grid-cols-3"
                  >
                    <input
                      type="hidden"
                      name="runbookSelection"
                      value={`${activeAttachRunbook.id}:${activeAttachRunbook.publishedVersionId}`}
                    />

                    <div className="lg:col-span-3 rounded-md bg-background/80 p-3 border">
                      <div className="font-semibold text-foreground text-sm flex items-center justify-between">
                        <span>{activeAttachRunbook.name}</span>
                        <Badge variant="outline" className="text-[11px]">
                          v{activeAttachRunbook.publishedVersion?.version ?? '1'} Published
                        </Badge>
                      </div>
                      {activeAttachRunbook.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {activeAttachRunbook.description}
                        </p>
                      )}
                    </div>

                    <Field label="Execution mode">
                      <FormSelect
                        name="mode"
                        label="Execution mode"
                        defaultValue="MANUAL"
                        options={[
                          { value: 'MANUAL', label: 'Manual (Operator triggered)' },
                          { value: 'SUGGESTED', label: 'Suggested (Recommended on incidents)' },
                          { value: 'AUTOMATIC', label: 'Automatic (Requires pinned version)' },
                        ]}
                      />
                    </Field>

                    <Field label="Version strategy">
                      <FormSelect
                        name="versionStrategy"
                        label="Version strategy"
                        defaultValue="LATEST_PUBLISHED"
                        options={[
                          { value: 'LATEST_PUBLISHED', label: 'Latest published (Auto-tracks release)' },
                          { value: 'PINNED', label: 'Pinned (Fixed version)' },
                        ]}
                      />
                    </Field>

                    <AttachTargetFields
                      agents={availableAgents}
                      pools={availableAgentPools}
                      hasAgentWrite={
                        activeAttachRunbook.publishedVersion
                          ? hasAgentWrites(activeAttachRunbook.publishedVersion.definition)
                          : false
                      }
                    />

                    <div className="space-y-3 lg:col-span-3">
                      <ResolveOnVerifiedRecoveryToggle />
                      <MonitoringIncidentsToggle />
                      <ContextInputMappingEditor
                        inputs={activeAttachRunbook.publishedVersion?.inputs ?? []}
                        contextFields={contextFields}
                        defaultValue={[]}
                      />
                      <ContextTargetMappingEditor
                        contextFields={contextFields}
                        agents={availableAgents}
                        pools={availableAgentPools}
                        defaultValue={{}}
                      />
                    </div>

                    {(activeAttachRunbook.publishedVersion?.inputs.length ?? 0) > 0 && (
                      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-3">
                        <InputFields
                          definitions={activeAttachRunbook.publishedVersion?.inputs ?? []}
                          values={{}}
                        />
                      </div>
                    )}

                    <div className="lg:col-span-3 pt-2">
                      <SubmitButton pendingLabel="Attaching…">
                        Attach {activeAttachRunbook.name}
                      </SubmitButton>
                    </div>
                  </ActionForm>
                )}
              </div>
            </ConfigureSheet>
          )}
        </div>
      </div>

      {/* KPI Stat Ribbon */}
      {bindings.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Workflow className="h-4 w-4 text-primary" />
              <span>Attached</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{bindings.length}</div>
          </div>
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Zap className="h-4 w-4 text-indigo-500" />
              <span>Automated</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{autoCount}</div>
          </div>
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Play className="h-4 w-4 text-blue-500" />
              <span>Manual</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{manualCount}</div>
          </div>
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Clock className="h-4 w-4 text-amber-500" />
              <span>Executions</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{totalExecutions}</div>
          </div>
        </div>
      )}

      {/* Search & Filter Controls */}
      {bindings.length > 2 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filter attached runbooks…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(['ALL', 'AUTOMATIC', 'MANUAL', 'SUGGESTED'] as const).map(mode => (
              <Button
                key={mode}
                variant={modeFilter === mode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setModeFilter(mode)}
                className={cn(
                  'h-8 text-xs font-medium rounded-lg',
                  modeFilter !== mode && 'text-muted-foreground hover:text-foreground'
                )}
              >
                {mode === 'ALL'
                  ? 'All Modes'
                  : mode === 'AUTOMATIC'
                    ? 'Automatic'
                    : mode === 'MANUAL'
                      ? 'Manual'
                      : 'Suggested'}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Bindings List */}
      <div className="space-y-4">
        {filteredBindings.map(binding => {
          const boundAgent = availableAgents.find(a => a.id === binding.defaultAgentId);
          const boundPool = availableAgentPools.find(p => p.id === binding.defaultAgentPoolId);
          const lastExecution = binding.executions?.[0];
          const unattendedEligible =
            binding.mode === 'AUTOMATIC' && binding.versionStrategy === 'PINNED';
          const authorization = authorizationFor(
            binding,
            unattendedWriteDetails[binding.id]?.authorizedAtLabel ?? null
          );
          const writesStatus = unattendedWritesStatus(binding.runbookVersionId, authorization);
          const usesContext = (binding.triggers ?? []).some(
            trigger =>
              trigger.enabled &&
              trigger.conditions.some(condition => contextFieldKey(condition.field) !== null)
          );
          const targetMapping = parseContextTargetMapping(binding.contextTargetMappings);
          const inputMappings = parseContextInputMappings(binding.contextInputMappings) ?? [];
          const bindingInputs =
            binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? [];

          return (
            <Card
              key={binding.id}
              className="group relative overflow-hidden transition-all duration-200 hover:shadow-xs border-border/80"
            >
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Link
                        href={`/runbooks/${binding.runbookId}`}
                        className="hover:underline flex items-center gap-1.5 text-foreground group-hover:text-primary transition-colors"
                      >
                        {binding.runbook.name}
                        <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                      </Link>
                    </CardTitle>
                    {binding.runbook.description && (
                      <CardDescription className="text-xs line-clamp-2">
                        {binding.runbook.description}
                      </CardDescription>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Execution Mode Badge */}
                    <Badge
                      variant={binding.enabled ? 'default' : 'secondary'}
                      className={cn(
                        'text-[11px] font-medium gap-1',
                        binding.enabled &&
                          binding.mode === 'AUTOMATIC' &&
                          'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
                        binding.enabled &&
                          binding.mode === 'SUGGESTED' &&
                          'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
                        binding.enabled &&
                          binding.mode === 'MANUAL' &&
                          'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                      )}
                    >
                      {binding.enabled ? (
                        binding.mode === 'AUTOMATIC' ? (
                          <>
                            <Zap className="h-3 w-3" /> Automatic
                          </>
                        ) : binding.mode === 'SUGGESTED' ? (
                          <>
                            <Sparkles className="h-3 w-3" /> Suggested
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" /> Manual
                          </>
                        )
                      ) : (
                        'DISABLED'
                      )}
                    </Badge>

                    {/* Version Badge */}
                    <Badge variant="outline" className="text-[11px] font-medium gap-1">
                      {binding.versionStrategy === 'PINNED' ? (
                        <>
                          <Shield className="h-3 w-3 text-muted-foreground" />
                          v{binding.runbookVersion?.version ?? '?'} (Pinned)
                        </>
                      ) : (
                        'Latest published'
                      )}
                    </Badge>

                    {/* Last Run Activity Badge */}
                    {lastExecution && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px] font-medium gap-1',
                          lastExecution.status === 'SUCCEEDED' &&
                            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                          lastExecution.status === 'FAILED' &&
                            'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
                          lastExecution.status === 'RUNNING' &&
                            'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse'
                        )}
                      >
                        {lastExecution.status === 'SUCCEEDED' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <AlertCircle className="h-3 w-3" />
                        )}
                        Last run: {lastExecution.status}
                      </Badge>
                    )}

                    {binding.runOnMonitoringIncidents && (
                      <Badge variant="outline" className="gap-1 text-[11px] font-medium">
                        <Zap className="h-3 w-3" aria-hidden="true" />
                        Runs on monitoring incidents
                      </Badge>
                    )}

                    {binding.resolveOnVerifiedRecovery && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                      >
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Resolves on verified recovery
                      </Badge>
                    )}

                    {unattendedEligible && (
                      <UnattendedWritesBadge
                        status={writesStatus}
                        versionNumber={binding.runbookVersion?.version ?? null}
                      />
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3.5 pt-0">
                {/* Target and Trigger Contract Information */}
                <div className="rounded-lg border bg-muted/30 p-2.5">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Target:{' '}
                    {boundAgent?.name ??
                      boundPool?.name ??
                      (binding.defaultAgentId
                        ? 'Unavailable Agent'
                        : binding.defaultAgentPoolId
                          ? 'Unavailable pool'
                          : 'Control plane')}{' '}
                    · Trigger:{' '}
                    {binding.triggers && binding.triggers.some(trigger => trigger.enabled)
                      ? binding.triggers
                          .filter(trigger => trigger.enabled)
                          .map(
                            trigger =>
                              `${trigger.event.replaceAll('_', ' ')} · ${trigger.conditions.length} conditions`
                          )
                          .join('; ')
                      : 'Manual only'}
                    {usesContext && ' · uses automation context'}
                    {targetMapping?.contextKey &&
                      ` · target by automation.${targetMapping.contextKey} (${targetMapping.entries.length} approved)`}
                    {inputMappings.length > 0 &&
                      ` · ${inputMappings.length} input${inputMappings.length === 1 ? '' : 's'} from context`}
                  </p>
                </div>

                {/* Input Summary */}
                <InputSummary
                  definitions={
                    binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
                  }
                  values={binding.inputValues as Record<string, unknown>}
                />

                {unattendedEligible && (canAuthorizeUnattendedWrites || canManage) && (
                  <UnattendedWritesPanel
                    serviceId={serviceId}
                    bindingId={binding.id}
                    runbookName={binding.runbook.name}
                    pinnedVersionId={binding.runbookVersionId}
                    pinnedVersionNumber={binding.runbookVersion?.version ?? null}
                    authorization={authorization}
                    eligibility={unattendedWriteDetails[binding.id]?.eligibility ?? null}
                    canAuthorize={canAuthorizeUnattendedWrites}
                  />
                )}

                {/* Actions Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                      <Link href={`/runbooks/${binding.runbookId}`}>
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>View Runbook</span>
                      </Link>
                    </Button>

                    {canManage && (
                      <ConfigureSheet
                        title={`Configure ${binding.runbook.name}`}
                        description="Review version, inputs, target and trigger policy before saving."
                        trigger={
                          <Button variant="outline" size="sm" className="h-8 gap-1.5">
                            <Settings2 className="h-3.5 w-3.5" />
                            <span>Configure</span>
                          </Button>
                        }
                      >
                        <ActionForm
                          action={updateRunbookBindingAction.bind(null, serviceId, binding.id)}
                          className="grid gap-3 lg:grid-cols-4"
                        >
                          <Field label="Mode">
                            <FormSelect
                              name="mode"
                              label="Execution mode"
                              defaultValue={binding.mode}
                              options={[
                                { value: 'MANUAL', label: 'Manual' },
                                { value: 'SUGGESTED', label: 'Suggested' },
                                { value: 'AUTOMATIC', label: 'Automatic · requires pinned version' },
                              ]}
                            />
                          </Field>
                          <BindingVersionTargetFields
                            agentSelector={JSON.stringify(binding.agentSelector ?? {})}
                            versions={
                              availableRunbooks
                                .find(item => item.id === binding.runbookId)
                                ?.versions.map(version => ({
                                  id: version.id,
                                  version: version.version,
                                  state: version.state,
                                  hasAgentWrite: hasAgentWrites(version.definition),
                                  inputs: version.inputs.map(input => ({
                                    key: input.key,
                                    label: input.label,
                                    type: input.type,
                                    required: input.required,
                                    defaultValue: input.defaultValue,
                                    description: input.description,
                                  })),
                                })) ?? []
                            }
                            publishedVersionId={binding.runbook.publishedVersionId ?? ''}
                            initialStrategy={binding.versionStrategy}
                            initialVersionId={binding.runbookVersionId}
                            values={binding.inputValues as Record<string, unknown>}
                            targets={{
                              agents: availableAgents,
                              pools: availableAgentPools,
                              defaultValue: binding.defaultAgentId
                                ? `agent:${binding.defaultAgentId}`
                                : binding.defaultAgentPoolId
                                  ? `pool:${binding.defaultAgentPoolId}`
                                  : 'none',
                            }}
                          />
                          <Field label="Status">
                            <FormSelect
                              name="enabled"
                              label="Binding status"
                              defaultValue={String(binding.enabled)}
                              options={[
                                { value: 'true', label: 'Enabled' },
                                { value: 'false', label: 'Disabled' },
                              ]}
                            />
                          </Field>
                          <div className="order-2 space-y-3 lg:col-span-4">
                            <ResolveOnVerifiedRecoveryToggle
                              defaultChecked={binding.resolveOnVerifiedRecovery}
                            />
                            <MonitoringIncidentsToggle
                              defaultChecked={binding.runOnMonitoringIncidents}
                            />
                            <ContextInputMappingEditor
                              inputs={bindingInputs}
                              contextFields={contextFields}
                              defaultValue={inputMappings}
                            />
                            <ContextTargetMappingEditor
                              contextFields={contextFields}
                              agents={availableAgents}
                              pools={availableAgentPools}
                              defaultValue={targetMapping ?? {}}
                            />
                          </div>
                          <div className="order-2 flex gap-2 lg:col-span-4">
                            <SubmitButton variant="outline">
                              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Save binding
                            </SubmitButton>
                          </div>
                        </ActionForm>
                        <ConfirmAction
                          action={detachRunbookAction.bind(null, serviceId, binding.id)}
                          title={`Detach ${binding.runbook.name}?`}
                          description="This service will no longer offer or trigger the Runbook. Existing execution history is retained."
                          label="Detach Runbook"
                        />
                        <ActionForm
                          action={configureRunbookTriggerAction.bind(null, serviceId, binding.id)}
                          className="mt-4 grid gap-3 border-t pt-4 lg:grid-cols-3"
                        >
                          <Field label="Trigger event">
                            <FormSelect
                              name="event"
                              label="Trigger event"
                              defaultValue="INCIDENT_CREATED"
                              options={[{ value: 'INCIDENT_CREATED', label: 'Incident created' }]}
                            />
                          </Field>
                          <Field label="Condition logic">
                            <FormSelect
                              name="conditionLogic"
                              label="Condition logic"
                              defaultValue={binding.triggers?.[0]?.conditionLogic ?? 'AND'}
                              options={[
                                { value: 'AND', label: 'Match all' },
                                { value: 'OR', label: 'Match any' },
                              ]}
                            />
                          </Field>
                          <div className="flex items-end">
                            <SubmitButton variant="outline" pendingLabel="Saving trigger…">
                              Save trigger
                            </SubmitButton>
                          </div>
                          <div className="lg:col-span-3">
                            <TriggerConditionEditor
                              conditions={binding.triggers?.[0]?.conditions ?? []}
                              automationContext={automationContext}
                            />
                          </div>
                        </ActionForm>
                      </ConfigureSheet>
                    )}
                  </div>

                  {canManage && (
                    <ConfirmAction
                      action={detachRunbookAction.bind(null, serviceId, binding.id)}
                      title={`Detach ${binding.runbook.name}?`}
                      description="This service will no longer offer or trigger the Runbook. Existing execution history is retained."
                      label="Detach"
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty State */}
      {bindings.length === 0 && (
        <EmptyState
          title="No service runbooks"
          description="Attach a published workflow with this service’s inputs and execution target."
          icon={<BookOpen className="h-10 w-10 text-muted-foreground" />}
        />
      )}

      {bindings.length > 0 && filteredBindings.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Filter className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-2 text-sm font-semibold text-foreground">No matching runbooks</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            No attached runbooks match your search or mode filter.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setModeFilter('ALL');
            }}
            className="mt-3 text-xs"
          >
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}

type InputDefinition = Pick<
  RunbookInput,
  'key' | 'label' | 'type' | 'required' | 'defaultValue' | 'description'
>;

function InputFields({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground sm:col-span-2">No inputs required.</p>;
  return definitions.map(input => {
    const current = values[input.key] ?? input.defaultValue ?? '';
    if (input.type === 'BOOLEAN') {
      return (
        <label key={input.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            name={`input:${input.key}`}
            type="checkbox"
            value="true"
            defaultChecked={current === true || current === 'true'}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">{input.label}</span>
            {input.description && (
              <span className="mt-1 block text-xs text-muted-foreground">{input.description}</span>
            )}
          </span>
        </label>
      );
    }
    const displayed =
      input.type === 'SECRET_REF' && typeof current === 'string'
        ? current.replace(/^secret:\/\//, '')
        : typeof current === 'string' || typeof current === 'number'
          ? String(current)
          : '';
    return (
      <Field key={input.key} label={`${input.label}${input.required ? ' *' : ''}`}>
        <Input
          name={`input:${input.key}`}
          type={input.type === 'NUMBER' ? 'number' : input.type === 'URL' ? 'url' : 'text'}
          step={input.type === 'NUMBER' ? 'any' : undefined}
          required={input.required}
          defaultValue={displayed}
          placeholder={
            input.type === 'DURATION'
              ? '30s, 5m, or 1h'
              : input.type === 'SECRET_REF'
                ? 'Secret name'
                : undefined
          }
          aria-describedby={input.description ? `input-help-${input.key}` : undefined}
        />
        {input.description && (
          <p id={`input-help-${input.key}`} className="text-xs text-muted-foreground">
            {input.description}
          </p>
        )}
      </Field>
    );
  });
}

function InputSummary({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground">No inputs configured.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {definitions.map(input => (
        <div key={input.key} className="rounded border p-2 text-xs">
          <span className="font-medium">{input.label}: </span>
          <span className="text-muted-foreground">
            {input.type === 'SECRET_REF' && (values[input.key] ?? input.defaultValue)
              ? 'Configured secret reference'
              : String(values[input.key] ?? input.defaultValue ?? 'Not set')}
          </span>
        </div>
      ))}
    </div>
  );
}

function authorizationFor(
  binding: ServiceRunbookBinding,
  authorizedAtLabel: string | null
): UnattendedWriteAuthorization | null {
  if (!binding.unattendedWritesVersionId || !binding.unattendedWritesAuthorizedAt) return null;
  const authorizedAt = new Date(binding.unattendedWritesAuthorizedAt);
  return {
    versionId: binding.unattendedWritesVersionId,
    authorizedAtIso: authorizedAt.toISOString(),
    authorizedAtLabel: authorizedAtLabel ?? `${authorizedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    authorizedBy: binding.unattendedWritesAuthorizedBy?.name ?? null,
  };
}

/**
 * Fail-closed, centralized risk detection for agent write operations.
 * Traverses both precheck and verification child steps and derives minimum executable risk.
 * Returns true (fails closed requiring specific Agent assignment) if definition is corrupt or uninterpretable.
 */
function hasAgentWrites(definition: unknown): boolean {
  if (!definition || typeof definition !== 'object') return true; // Fail closed
  try {
    const rawSteps = (definition as { steps?: unknown[] }).steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return true; // Fail closed

    const checkStep = (stepObj: unknown): boolean => {
      if (!stepObj || typeof stepObj !== 'object') return true; // Fail closed on corrupt step
      const step = stepObj as {
        type?: string;
        riskClass?: string;
        config?: Record<string, unknown>;
        precheck?: { steps?: unknown[] };
        verification?: { steps?: unknown[] };
      };

      if (
        typeof step.type === 'string' &&
        requiresAgent(step.type as import('@/lib/runbooks/types').RunbookStepType)
      ) {
        // Derive minimum required risk from executable action semantics
        const derivedRisk = minimumRiskForStep({
          key: 'check',
          name: 'check',
          type: step.type as import('@/lib/runbooks/types').RunbookStepType,
          riskClass: (step.riskClass as import('@/lib/runbooks/types').RunbookRiskClass) ?? 'READ_ONLY',
          config: step.config ?? {},
        });
        const declaredRisk = step.riskClass;
        if (derivedRisk !== 'READ_ONLY' || (declaredRisk && declaredRisk !== 'READ_ONLY')) {
          return true;
        }
      }

      // Recursively traverse prechecks:
      if (step.precheck && Array.isArray(step.precheck.steps)) {
        if (step.precheck.steps.some(checkStep)) return true;
      }

      // Recursively traverse verification steps:
      if (step.verification && Array.isArray(step.verification.steps)) {
        if (step.verification.steps.some(checkStep)) return true;
      }

      return false;
    };

    return rawSteps.some(checkStep);
  } catch {
    return true; // Fail closed on any interpretation failure
  }
}
