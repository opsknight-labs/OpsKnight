'use client';
import { useVersionConfiguration } from '@/components/runbooks/useVersionConfiguration';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';

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
} from 'lucide-react';
import { requiresAgent } from '@/lib/runbooks/types';
import { minimumRiskForStep } from '@/lib/runbooks/definition';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfirmAction,
  ConfigureSheet,
  SubmitButton,
  FormSelect,
} from '@/components/runbooks/RunbookControls';
import RunbookTargetSelect from '@/components/runbooks/RunbookTargetSelect';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
import RuleWizard from '@/components/runbooks/RuleWizard';
import {
  checkRulePolicyAction,
  pauseRuleAction,
  duplicateRuleAction,
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
import RunbookBindingVersionInputs from './RunbookBindingVersionInputs';
import Field from '@/components/runbooks/RunbookField';
import { cn } from '@/lib/utils';
import {
  describeBinding,
  type BindingPresentation,
  type RunbookResource,
} from '@/lib/runbooks/presentation/binding-contract';

export type ServiceRunbookBinding = Prisma.ServiceAutomationRuleGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}> & {
  presentation?: BindingPresentation;
  readiness?: BindingReadiness;
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
};

type CatalogVersion = {
  id: string;
  version: number;
  state: import('@prisma/client').RunbookVersionState;
  inputs?: RunbookInput[];
  definition?: unknown;
  hasAgentWrite?: boolean;
  metadataOnly?: boolean;
};
export type AvailableRunbook = {
  id: string;
  name: string;
  description: string;
  publishedVersionId: string | null;
  publishedVersion: CatalogVersion | null;
  versions: CatalogVersion[];
};

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
  loadErrors = [],
  pagination,
  catalogQuery = '',
  targetQuery = '',
}: {
  pagination?: { after?: string; nextCursor?: string; hasNext: boolean };
  catalogQuery?: string;
  targetQuery?: string;
  serviceId: string;
  bindings: ServiceRunbookBinding[];
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  canManage: boolean;
  loadError?: boolean;
  loadErrors?: RunbookResource[];
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'AUTOMATIC' | 'MANUAL' | 'SUGGESTED'>('ALL');
  const [selectedAttachVersionId, setSelectedAttachVersionId] = useState<string | null>(null);
  const [selectedAttachId, setSelectedAttachId] = useState<string>('');

  const unattached = availableRunbooks;

  // Set default selected unattached runbook if not set
  const activeAttachRunbook = useMemo(() => {
    if (selectedAttachId) {
      return unattached.find(r => r.id === selectedAttachId) || unattached[0] || null;
    }
    return unattached[0] || null;
  }, [unattached, selectedAttachId]);

  const selectedMetadata = activeAttachRunbook?.versions.find(
    version => version.id === (selectedAttachVersionId ?? activeAttachRunbook.publishedVersionId)
  );
  const loadedVersion = useVersionConfiguration(
    selectedMetadata?.metadataOnly ? selectedMetadata.id : null,
    activeAttachRunbook?.id
  );
  const activeAttachVersion = selectedMetadata?.metadataOnly
    ? loadedVersion.data
    : selectedMetadata;

  // Client-side instant 0ms search & filter
  const filteredBindings = useMemo(() => {
    return bindings.filter(binding => {
      if (modeFilter !== 'ALL' && binding.mode !== modeFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const name = `${binding.name ?? ''} ${binding.runbook?.name ?? ''}`.toLowerCase();
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

  const configurationAvailable = !loadErrors.some(resource =>
    ['library', 'agents', 'pools'].includes(resource)
  );
  if (loadError || loadErrors.includes('bindings')) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <h3 className="mt-2 text-sm font-semibold text-foreground">Service runbooks unavailable</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
          Attached workflows could not be retrieved. Refresh to retry; the cause has been recorded
          in server logs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadErrors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 p-3 text-sm">
          {loadErrors.includes('agents') && (
            <p>Agent inventory unavailable. Existing workflows remain visible.</p>
          )}
          {loadErrors.includes('pools') && <p>Pool inventory unavailable.</p>}
          {loadErrors.includes('library') && <p>Runbook library unavailable.</p>}
          <p>
            Configuration changes are temporarily unavailable because their dependencies could not
            be checked.
          </p>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Retry loading
          </Button>
        </div>
      )}
      <form
        method="get"
        className="flex flex-wrap items-end gap-2"
        aria-label="Search rule configuration options"
      >
        <input type="hidden" name="tab" value="runbooks" />
        <label>
          Workflow search
          <Input name="ruleCatalog" defaultValue={catalogQuery} maxLength={100} />
        </label>
        <label>
          Agent / pool search
          <Input name="ruleTargets" defaultValue={targetQuery} maxLength={100} />
        </label>
        <Button type="submit" variant="outline">
          Search options
        </Button>
        <p className="text-xs text-muted-foreground">
          Showing up to 50 workflows, 20 versions per workflow and 100 matching targets. Search to
          narrow options.
        </p>
      </form>
      {pagination && (
        <nav
          aria-label="Automation rule pages"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <span>{bindings.length} rules on this page</span>
          {pagination.after && (
            <Link
              href={`/services/${serviceId}?tab=runbooks&ruleCatalog=${encodeURIComponent(catalogQuery)}&ruleTargets=${encodeURIComponent(targetQuery)}`}
            >
              First rules
            </Link>
          )}
          {pagination.hasNext && (
            <Link
              href={`/services/${serviceId}?tab=runbooks&rulesAfter=${encodeURIComponent(pagination.nextCursor ?? '')}&ruleCatalog=${encodeURIComponent(catalogQuery)}&ruleTargets=${encodeURIComponent(targetQuery)}`}
            >
              Next rules
            </Link>
          )}
        </nav>
      )}
      <Button asChild variant="outline">
        <Link
          href={`/services/${serviceId}?tab=runbooks&rulesCheck=1&rulesAfter=${encodeURIComponent(pagination?.after ?? '')}&ruleCatalog=${encodeURIComponent(catalogQuery)}&ruleTargets=${encodeURIComponent(targetQuery)}`}
        >
          Check visible rule readiness
        </Link>
      </Button>
      {/* Elevated Header with Live KPI Overview */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Service Automations
            </h2>
            <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
              {bindings.length} {pagination ? 'on this page' : 'attached'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Attach automated diagnostic scripts, recovery playbooks, and safe operational
            procedures.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-2xs">
            <Link href="/runbooks">
              <BookOpen className="h-4 w-4" />
              <span>Library</span>
            </Link>
          </Button>

          {canManage && configurationAvailable && unattached.length > 0 && (
            <ConfigureSheet
              title="Create Service Automation Rule"
              description="Select a workflow from your library and configure service-specific inputs and execution target."
              trigger={
                <Button size="sm" className="h-9 gap-1.5 shadow-xs">
                  <Plus className="h-4 w-4" />
                  <span>Create rule</span>
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
                    onValueChange={value => {
                      setSelectedAttachId(value);
                      setSelectedAttachVersionId(null);
                    }}
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
                    className="space-y-3 rounded-lg border bg-muted/20 p-4"
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

                    <RuleWizard
                      steps={[
                        {
                          title: 'Version and mode',
                          content: (
                            <>
                              <RunbookBindingVersionInputs
                                initialMode="MANUAL"
                                runbookId={activeAttachRunbook.id}
                                versions={[
                                  ...new Map(
                                    [
                                      ...activeAttachRunbook.versions,
                                      ...(activeAttachRunbook.publishedVersion
                                        ? [activeAttachRunbook.publishedVersion]
                                        : []),
                                    ].map(version => [version.id, version])
                                  ).values(),
                                ].map(version => ({
                                  ...version,
                                  hasAgentWrite:
                                    version.hasAgentWrite ?? hasAgentWrites(version.definition),
                                  inputs: version.inputs ?? [],
                                }))}
                                publishedVersionId={activeAttachRunbook.publishedVersionId ?? ''}
                                initialStrategy="LATEST_PUBLISHED"
                                initialVersionId={null}
                                values={{}}
                                includeInputs={false}
                                onVersionChange={setSelectedAttachVersionId}
                              />

                              <Field label="Rule name">
                                <Input
                                  name="ruleName"
                                  placeholder="Production recovery"
                                  maxLength={200}
                                />
                              </Field>
                              <Field label="Initial status">
                                <FormSelect
                                  name="enabled"
                                  label="Initial rule status"
                                  defaultValue="false"
                                  options={[
                                    {
                                      value: 'false',
                                      label: 'Save paused · Review checks before enabling',
                                    },
                                    {
                                      value: 'true',
                                      label: 'Enable Manual/Suggested · Automatic saves paused',
                                    },
                                  ]}
                                />
                              </Field>
                            </>
                          ),
                        },
                        {
                          title: 'Target and inputs',
                          content: (
                            <>
                              <Field label="Execution target">
                                <RunbookTargetSelect
                                  agents={availableAgents}
                                  pools={availableAgentPools}
                                  hasAgentWrite={
                                    activeAttachVersion
                                      ? (activeAttachVersion.hasAgentWrite ??
                                        hasAgentWrites(
                                          'definition' in activeAttachVersion
                                            ? activeAttachVersion.definition
                                            : undefined
                                        ))
                                      : false
                                  }
                                />
                              </Field>

                              {selectedMetadata?.metadataOnly && !activeAttachVersion && (
                                <p data-form-invalid="true" role="status">
                                  {loadedVersion.error
                                    ? 'Version configuration unavailable. Reload to retry.'
                                    : 'Loading selected version configuration…'}
                                </p>
                              )}
                              <RunbookSelectorBuilder />

                              {(activeAttachVersion?.inputs?.length ?? 0) > 0 && (
                                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-3">
                                  <InputFields
                                    key={activeAttachVersion?.id}
                                    definitions={activeAttachVersion?.inputs ?? []}
                                    values={{}}
                                  />
                                </div>
                              )}
                            </>
                          ),
                        },
                        {
                          title: 'Trigger',
                          content: (
                            <>
                              <Field label="Initial trigger">
                                <FormSelect
                                  name="initialTrigger"
                                  label="Initial trigger"
                                  defaultValue="none"
                                  options={[
                                    { value: 'none', label: 'No trigger · Not armed' },
                                    {
                                      value: 'INCIDENT_CREATED',
                                      label: 'Incident created · Every new incident',
                                    },
                                  ]}
                                />
                              </Field>
                              <p className="text-sm text-muted-foreground">
                                Manual mode never arms a trigger. Incident-created triggers apply to
                                future events. After saving, use Configure to narrow conditions
                                before enabling automation.
                              </p>
                            </>
                          ),
                        },
                        {
                          title: 'Review and save',
                          content: (
                            <>
                              <p className="text-sm">
                                Automatic rules always save paused. Activate separately from Rule
                                evidence after fresh policy checks. Review the selected immutable
                                version, execution mode, target and inputs before saving.
                                Configuration checks do not prove platform permissions. Save paused
                                to review configuration and Agent policy evidence first.
                              </p>
                              <div className="lg:col-span-3 pt-2">
                                <SubmitButton pendingLabel="Attaching…">
                                  Attach {activeAttachRunbook.name}
                                </SubmitButton>
                              </div>
                            </>
                          ),
                        },
                      ]}
                    />
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
              <span>Configured automatic{pagination ? ' · This page' : ''}</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{autoCount}</div>
          </div>
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Play className="h-4 w-4 text-blue-500" />
              <span>Configured manual{pagination ? ' · This page' : ''}</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-foreground">{manualCount}</div>
          </div>
          <div className="rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Clock className="h-4 w-4 text-amber-500" />
              <span>Historical executions{pagination ? ' · This page' : ''}</span>
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
          const presentation =
            binding.presentation ??
            describeBinding(binding, availableAgents, availableAgentPools, loadErrors);
          const lastExecution = binding.executions?.[0];

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
                        className="hover:underline flex items-center gap-1.5 break-words min-w-0 text-foreground group-hover:text-primary transition-colors"
                      >
                        {binding.name || binding.runbook.name}
                        <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                      </Link>
                    </CardTitle>
                    {binding.runbook.description && (
                      <CardDescription className="text-xs whitespace-normal break-words">
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
                          <Shield className="h-3 w-3 text-muted-foreground" />v
                          {binding.runbookVersion?.version ?? '?'} (Pinned)
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
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3.5 pt-0">
                {!binding.readiness && (
                  <p className="text-xs text-muted-foreground">
                    {binding.enabled
                      ? 'Target and policy readiness not assessed. Open Rule evidence or check this page.'
                      : 'Rule paused · Target checks not run.'}
                  </p>
                )}
                {binding.readiness && (
                  <section
                    aria-label="Rule readiness"
                    className="rounded-lg border p-3 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={binding.readiness.state === 'BLOCKED' ? 'danger' : 'outline'}>
                        {binding.readiness.state.replaceAll('_', ' ')}
                      </Badge>
                      <span>
                        {binding.readiness.eligibleAgents === null
                          ? binding.readiness.state === 'PAUSED'
                            ? 'Target checks paused'
                            : binding.readiness.checks.some(
                                  check => check.code === 'INCIDENT_CONTEXT_REQUIRED'
                                )
                              ? 'Target requires incident context'
                              : 'Target check unavailable'
                          : `${binding.readiness.eligibleAgents} matching online Agents`}{' '}
                        · checked {new Date(binding.readiness.checkedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {binding.readiness.checks
                      .filter(check => check.state === 'blocked')
                      .slice(0, 3)
                      .map(check => (
                        <p key={check.code}>{check.message}</p>
                      ))}
                  </section>
                )}
                <Button asChild variant="outline">
                  <Link href={`/services/${serviceId}/automations/${binding.id}`}>
                    Rule evidence
                  </Link>
                </Button>
                <p className="text-xs text-muted-foreground">
                  Target: {presentation.target} · Trigger: {presentation.trigger}
                </p>
                <details className="space-y-3">
                  <summary className="cursor-pointer text-sm font-medium">Manage rule</summary>
                  {canManage && configurationAvailable && (
                    <ActionForm action={checkRulePolicyAction.bind(null, serviceId, binding.id)}>
                      <SubmitButton
                        variant="outline"
                        pendingLabel="Requesting read-only policy check…"
                      >
                        Check Agent policy · No execution
                      </SubmitButton>
                      <p className="text-xs text-muted-foreground">
                        The Agent checks this frozen configuration against its local policy. This
                        does not run a step or verify target-side permissions.
                      </p>
                    </ActionForm>
                  )}
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {binding.enabled && (
                        <ConfirmAction
                          action={pauseRuleAction.bind(null, serviceId, binding.id)}
                          label="Pause rule"
                          title="Pause this automation rule?"
                          description="This stops future triggering. Existing executions retain their own cancellation and approval controls."
                        />
                      )}
                      <ActionForm action={duplicateRuleAction.bind(null, serviceId, binding.id)}>
                        <SubmitButton variant="outline">Duplicate paused rule</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                  {/* Input Summary */}
                  <InputSummary
                    definitions={
                      binding.runbookVersion?.inputs ??
                      binding.runbook.publishedVersion?.inputs ??
                      []
                    }
                    values={binding.inputValues as Record<string, unknown>}
                  />

                  {/* Actions Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                        <Link href={`/runbooks/${binding.runbookId}`}>
                          <BookOpen className="h-3.5 w-3.5" />
                          <span>View Runbook</span>
                        </Link>
                      </Button>

                      {canManage && configurationAvailable && (
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
                            <RunbookBindingVersionInputs
                              initialMode={binding.mode}
                              runbookId={binding.runbookId}
                              versions={[
                                ...new Map(
                                  [
                                    ...(availableRunbooks
                                      .find(item => item.id === binding.runbookId)
                                      ?.versions.map(version => ({
                                        ...version,
                                        inputs: version.inputs ?? [],
                                      })) ?? []),
                                    ...(binding.runbookVersion ? [binding.runbookVersion] : []),
                                    ...(binding.runbook.publishedVersion
                                      ? [binding.runbook.publishedVersion]
                                      : []),
                                  ].map(version => [version.id, version])
                                ).values(),
                              ].map(version => ({
                                ...version,
                                hasAgentWrite: hasAgentWrites(version.definition),
                              }))}
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
                            <RunbookSelectorBuilder initialValue={binding.agentSelector} />
                            <Field label="Rule name">
                              <Input
                                name="ruleName"
                                defaultValue={binding.name ?? ''}
                                maxLength={200}
                              />
                            </Field>
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
                            <div className="space-y-3 lg:col-span-3">
                              <Label>Conditions</Label>
                              {(binding.triggers?.[0]?.conditions ?? []).map(condition => (
                                <TriggerConditionRow
                                  key={condition.id}
                                  field={condition.field}
                                  operator={condition.operator}
                                  value={condition.value}
                                />
                              ))}
                              <TriggerConditionRow />
                              <p className="text-xs text-muted-foreground">
                                Leave the final field empty to add no condition. Comma-separate
                                values for “in” operators. Automatic mode still stops at approval
                                gates.
                              </p>
                            </div>
                          </ActionForm>
                        </ConfigureSheet>
                      )}
                    </div>
                  </div>
                </details>
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
  const [entered, setEntered] = useState<Record<string, unknown>>(values);
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground sm:col-span-2">No inputs required.</p>;
  return definitions.map(input => {
    const current = entered[input.key] ?? input.defaultValue ?? '';
    if (input.type === 'BOOLEAN') {
      return (
        <label key={input.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            name={`input:${input.key}`}
            type="checkbox"
            value="true"
            checked={current === true || current === 'true'}
            onChange={event =>
              setEntered(previous => ({ ...previous, [input.key]: event.target.checked }))
            }
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
          value={displayed}
          onChange={event =>
            setEntered(previous => ({ ...previous, [input.key]: event.target.value }))
          }
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

const triggerFields = [
  ['incident.urgency', 'Incident urgency'],
  ['incident.priority', 'Incident priority'],
  ['incident.status', 'Incident status'],
  ['incident.title', 'Incident title'],
  ['incident.description', 'Incident description'],
  ['incident.tags', 'Incident tags'],
  ['service.name', 'Service name'],
  ['service.teamId', 'Service team'],
] as const;

function TriggerConditionRow({
  field = '',
  operator = 'EQUALS',
  value = '',
}: {
  field?: string;
  operator?: string;
  value?: unknown;
}) {
  const knownField = triggerFields.some(([candidate]) => candidate === field);
  const displayedValue = Array.isArray(value)
    ? value.join(', ')
    : value === null
      ? ''
      : String(value);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <FormSelect
        name="conditionField"
        label="Trigger condition field"
        defaultValue={field || 'none'}
        options={[
          { value: 'none', label: 'No additional condition' },
          ...(field && !knownField ? [{ value: field, label: field }] : []),
          ...triggerFields.map(([value, label]) => ({ value, label })),
        ]}
      />
      <FormSelect
        name="conditionOperator"
        label="Trigger condition operator"
        defaultValue={operator}
        options={[
          { value: 'EQUALS', label: 'Equals' },
          { value: 'NOT_EQUALS', label: 'Does not equal' },
          { value: 'CONTAINS', label: 'Contains' },
          { value: 'STARTS_WITH', label: 'Starts with' },
          { value: 'IN', label: 'Is one of' },
          { value: 'NOT_IN', label: 'Is not one of' },
          { value: 'EXISTS', label: 'Exists' },
          { value: 'NOT_EXISTS', label: 'Does not exist' },
        ]}
      />
      <Input name="conditionValue" defaultValue={displayedValue} placeholder="Match value" />
    </div>
  );
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
          riskClass:
            (step.riskClass as import('@/lib/runbooks/types').RunbookRiskClass) ?? 'READ_ONLY',
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
