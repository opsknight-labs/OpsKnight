import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Archive,
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  GitBranch,
  History,
  Info,
  PauseCircle,
  Play,
  PlayCircle,
  Radio,
  Route,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import {
  assertCanViewService,
  assertCanModifyService,
  assertCapability,
  getUserPermissions,
} from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
import { describeBinding } from '@/lib/runbooks/presentation/binding-contract';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { SectionCard } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import RuleConfigurationCheck from '@/components/runbooks/RuleConfigurationCheck';
import RunbookExecutionPreview from '@/components/runbooks/RunbookExecutionPreview';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import {
  RuleActionTile,
  RuleSection,
  RuleSectionNav,
} from '@/components/service/automation-rule/RuleSection';
import { RuleStatusPill } from '@/components/service/automation-rule/RuleStatusPill';
import { RuleAtAGlance } from '@/components/service/automation-rule/RuleAtAGlance';
import { RuleLifecycleStepper } from '@/components/service/automation-rule/RuleLifecycleStepper';
import { RuleReadiness } from '@/components/service/automation-rule/RuleReadiness';
import { RuleTrigger } from '@/components/service/automation-rule/RuleTrigger';
import { RuleVersionInputs } from '@/components/service/automation-rule/RuleVersionInputs';
import { RuleExecutionHistory } from '@/components/service/automation-rule/RuleExecutionHistory';
import { RulePolicyEvidence } from '@/components/service/automation-rule/RulePolicyEvidence';
import { RuleTimestamp } from '@/components/service/automation-rule/RuleTimestamp';
import {
  MODE_LABELS,
  TONE_DOT,
  TONE_TEXT,
  formatAbsolute,
  formatDuration,
  readinessPresentation,
  ruleInputRows,
  ruleStatusKind,
  strategyLabel,
  successRate,
} from '@/components/service/automation-rule/rule-presentation';
import {
  activateRuleAction,
  validateRuleConfigurationAction,
  checkRulePolicyAction,
  previewServiceRuleAction,
  executeServiceRuleAction,
} from '../../runbook-actions';
import { redactRunbookConfiguration } from '@/lib/runbooks/display-name';
import { cn } from '@/lib/utils';
export const dynamic = 'force-dynamic';

function timestamp(date: Date) {
  return {
    iso: date.toISOString(),
    relative: formatDistanceToNow(date, { addSuffix: true }),
    absolute: formatAbsolute(date),
  };
}

export default async function AutomationRulePage({
  params,
}: {
  params: Promise<{ id: string; ruleId: string }>;
}) {
  const input = z.object({ id: z.string().cuid(), ruleId: z.string().cuid() }).parse(await params);
  await Promise.all([
    assertCanViewService(input.id),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
  ]);
  const rule = await prisma.serviceAutomationRule.findFirst({
    where: { id: input.ruleId, serviceId: input.id },
    include: {
      runbook: { include: { publishedVersion: { include: { inputs: true } } } },
      runbookVersion: { include: { inputs: true } },
      triggers: { include: { conditions: true } },
      defaultAgent: { select: { id: true, name: true } },
      defaultAgentPool: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      service: { select: { name: true } },
      executions: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          status: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          incidentId: true,
          definitionChecksum: true,
          runbookVersionId: true,
        },
      },
    },
  });
  if (!rule) notFound();
  const selectedVersion =
    rule.versionStrategy === 'PINNED' ? rule.runbookVersion : rule.runbook.publishedVersion;
  const readiness = await getBindingReadiness(rule.detachedAt ? rule : { ...rule, enabled: true });
  const certifiedAgents = readiness.checks.filter(
    check => check.code.startsWith('AGENT_POLICY_') && check.state === 'passed'
  ).length;
  const permissions = await getUserPermissions();
  const canManage = await assertCanModifyService(input.id)
    .then(() => permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE))
    .catch(() => false);
  const presentation = describeBinding(
    rule,
    rule.defaultAgent ? [rule.defaultAgent] : [],
    rule.defaultAgentPool ? [rule.defaultAgentPool] : []
  );
  const checks = await prisma.runbookPolicyCheck.findMany({
    where: { ruleId: rule.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      agentId: true,
      versionId: true,
      checksum: true,
      status: true,
      checkedAt: true,
      expiresAt: true,
      policyHash: true,
      agent: { select: { name: true } },
    },
  });

  const ruleName = rule.name || rule.runbook.name;
  const configureHref = `/services/${input.id}?tab=runbooks`;
  const canRun = rule.enabled && permissions.capabilities.includes(CAPABILITIES.RUNBOOK_EXECUTE);
  const statusKind = ruleStatusKind(rule);
  const readinessView = readinessPresentation(readiness.state);
  const strategy = strategyLabel(rule.versionStrategy);
  const lastRun = rule.executions[0];
  const matchesEverything = rule.triggers.some(
    trigger => trigger.enabled && trigger.conditions.length === 0
  );
  const showActivation =
    canManage && !rule.detachedAt && !rule.enabled && rule.mode === 'AUTOMATIC';

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        title={ruleName}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: rule.service?.name ?? 'Service', href: `/services/${input.id}` },
          { label: 'Automations', href: configureHref },
          { label: ruleName },
        ]}
        badge={<RuleStatusPill kind={statusKind} />}
        description={
          <>
            Runs{' '}
            <Link
              href={`/runbooks/${rule.runbookId}`}
              className="font-medium text-foreground hover:underline"
            >
              {rule.runbook.name}
            </Link>
            {' · '}
            {selectedVersion ? `v${selectedVersion.version}` : 'No version'} ({strategy}){' · '}
            created by {rule.createdBy?.name ?? 'Unavailable user'}{' '}
            <RuleTimestamp {...timestamp(rule.createdAt)} />
          </>
        }
        actions={
          <>
            {canRun && (
              <Button asChild size="sm">
                <a href="#run-now">
                  <Play className="h-4 w-4" aria-hidden />
                  Run now
                </a>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={configureHref}>
                <Settings2 className="h-4 w-4" aria-hidden />
                Configure
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/runbooks/${rule.runbookId}`}>
                <BookOpen className="h-4 w-4" aria-hidden />
                View runbook
              </Link>
            </Button>
          </>
        }
      />

      <section
        aria-label="What the evidence establishes"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          [
            'Configuration',
            'Validates version, typed inputs, trigger and target selection. It performs no action.',
          ],
          [
            'Agent policy',
            'A fresh signed allowlist check for this exact configuration. It does not grant platform permissions.',
          ],
          [
            'Execution preview',
            'Review the frozen plan and approval gates. Preview neither runs commands nor proves target health.',
          ],
          [
            'Target verification',
            'Requires a completed action and authored checks with healthy post-state. Investigate UNKNOWN outcomes independently.',
          ],
        ].map(([title, description]) => (
          <div key={title} className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-muted-foreground">{description}</p>
          </div>
        ))}
      </section>

      {rule.detachedAt && (
        <div className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            This rule was detached and archived. Its configuration, suggestions and execution
            history are retained. It cannot run or be reactivated.
          </p>
        </div>
      )}

      <RuleSectionNav />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <aside
          aria-label="Rule summary"
          className="order-first space-y-6 lg:sticky lg:top-16 lg:order-last lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pb-1"
        >
          <SectionCard title="At a glance" icon={Gauge} bodyClassName="px-5 py-2">
            <RuleAtAGlance
              glance={{
                mode: MODE_LABELS[rule.mode] ?? rule.mode,
                status: statusKind,
                trigger: presentation.trigger,
                target: presentation.target,
                version: selectedVersion
                  ? `v${selectedVersion.version} · ${strategy}`
                  : `Unavailable · ${strategy}`,
                readiness: readinessView,
                eligibleAgents: readiness.eligibleAgents,
                certifiedAgents,
                lastRun: lastRun
                  ? {
                      status: lastRun.status,
                      ...timestamp(lastRun.startedAt ?? lastRun.createdAt),
                    }
                  : null,
                successRate: successRate(rule.executions),
                recentRuns: rule.executions.length,
              }}
            />
          </SectionCard>
          <SectionCard
            title="Lifecycle"
            icon={Route}
            description="Configure → validate → activate → monitor."
          >
            <RuleLifecycleStepper
              serviceId={input.id}
              version={selectedVersion?.version ?? null}
              readinessState={readiness.state}
              detached={Boolean(rule.detachedAt)}
              enabled={rule.enabled}
              mode={rule.mode}
              eligibleAgents={readiness.eligibleAgents}
              certifiedAgents={certifiedAgents}
              executionCount={rule.executions.length}
            />
          </SectionCard>
        </aside>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <RuleSection
            id="checks"
            icon={PlayCircle}
            title="Run & validate"
            description="Work through these in order. The first two steps never run anything."
          >
            <details className="group rounded-lg border bg-muted/20 text-xs [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="inline-flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  How this works
                </span>
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <ul className="space-y-1 border-t px-3 py-2.5 leading-relaxed text-muted-foreground">
                <li>Configuration validation and Agent policy checks perform no action.</li>
                <li>
                  A read-only test executes the complete workflow and is rejected if any action can
                  write.
                </li>
                <li>
                  Run now previews the complete plan and requires write confirmation where
                  applicable.
                </li>
                <li>Approval gates in the workflow always apply, including in Automatic mode.</li>
              </ul>
            </details>
            <ol aria-label="Run and validate checklist">
              <RuleActionTile
                step={1}
                icon={ClipboardCheck}
                title="Validate configuration"
                description="Re-checks trigger, version, inputs and target. Nothing runs."
              >
                <RuleConfigurationCheck
                  action={validateRuleConfigurationAction.bind(null, input.id, rule.id)}
                />
              </RuleActionTile>
              <RuleActionTile
                step={2}
                icon={ShieldCheck}
                title="Check Agent policy"
                description="Asks each eligible Agent to evaluate its local policy against the frozen plan. Nothing runs."
                last={!canRun && !showActivation}
              >
                {canManage && !rule.detachedAt ? (
                  <ActionForm
                    action={checkRulePolicyAction.bind(null, input.id, rule.id)}
                    successMessage="Agent policy check requested"
                  >
                    <SubmitButton variant="outline" size="sm" pendingLabel="Requesting…">
                      Check Agent policy · No execution
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {rule.detachedAt
                      ? 'Unavailable for archived rules.'
                      : 'Requesting policy checks requires permission to manage this service.'}
                  </p>
                )}
              </RuleActionTile>
              {canRun && (
                <>
                  <RuleActionTile
                    step={3}
                    icon={FlaskConical}
                    title="Read-only test"
                    description="Runs the full workflow; rejected if any step can write."
                  >
                    <RunbookExecutionPreview
                      previewLabel="Preview read-only test"
                      executeLabel="Execute read-only test"
                      previewAction={previewServiceRuleAction.bind(null, input.id, rule.id, true)}
                      executeAction={executeServiceRuleAction.bind(null, input.id, rule.id, true)}
                    />
                  </RuleActionTile>
                  <RuleActionTile
                    id="run-now"
                    step={4}
                    icon={Play}
                    title="Run now"
                    description="Previews the complete plan first. Writes need explicit confirmation."
                    last={!showActivation}
                  >
                    <RunbookExecutionPreview
                      previewLabel="Run now · Preview plan"
                      previewAction={previewServiceRuleAction.bind(null, input.id, rule.id, false)}
                      executeAction={executeServiceRuleAction.bind(null, input.id, rule.id, false)}
                    />
                  </RuleActionTile>
                </>
              )}
              {showActivation && (
                <RuleActionTile
                  step={canRun ? 5 : 3}
                  icon={AlertTriangle}
                  tone="warning"
                  title="Activate Automatic rule"
                  description="Needs current configuration and accepted Agent policy evidence for every eligible Agent (up to 100 online). Approval gates still apply."
                  last
                >
                  <ActionForm
                    action={activateRuleAction.bind(null, input.id, rule.id)}
                    successMessage="Automatic rule activated"
                    className="space-y-3"
                  >
                    {matchesEverything && (
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="confirmMatchAll"
                          value="true"
                          required
                          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
                        />
                        <span>
                          I confirm this rule can match every new incident for this service.
                        </span>
                      </label>
                    )}
                    <SubmitButton pendingLabel="Activating…">Activate Automatic rule</SubmitButton>
                  </ActionForm>
                </RuleActionTile>
              )}
            </ol>
            {!canRun && rule.enabled && (
              <p className="text-xs text-muted-foreground">
                Running this rule requires the runbook execute capability.
              </p>
            )}
            {!rule.enabled && !rule.detachedAt && (
              <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This rule is paused. Review its checks and use its activation controls before
                running it.
              </p>
            )}
          </RuleSection>

          <RuleSection
            id="overview"
            icon={Activity}
            title="Readiness"
            description={
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-medium',
                    TONE_TEXT[readinessView.tone]
                  )}
                >
                  <span
                    aria-hidden
                    className={cn('h-2 w-2 rounded-full', TONE_DOT[readinessView.tone])}
                  />
                  {readinessView.label}
                </span>
                · checked <RuleTimestamp {...timestamp(new Date(readiness.checkedAt))} />
              </span>
            }
          >
            <RuleReadiness
              checks={readiness.checks}
              serviceId={input.id}
              runbookId={rule.runbookId}
              emptyMessage={
                readiness.state === 'PAUSED'
                  ? 'Readiness is not evaluated for archived rules.'
                  : undefined
              }
            />
          </RuleSection>

          <RuleSection id="trigger" icon={Radio} title="Trigger" description={presentation.trigger}>
            <RuleTrigger triggers={rule.triggers} />
          </RuleSection>

          <RuleSection id="target" icon={Server} title="Target and permissions">
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{presentation.target}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.defaultAgent
                      ? 'Specific Agent'
                      : rule.defaultAgentPool
                        ? 'Agent pool'
                        : 'Resolved at dispatch'}
                  </p>
                </div>
              </div>
              {rule.defaultAgentId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/runbooks/agents?agentId=${rule.defaultAgentId}`}>
                    Inspect Agent
                  </Link>
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Online and capable does not establish local allowlist or target-side permission.
            </p>
          </RuleSection>

          <RuleSection id="version" icon={GitBranch} title="Version and inputs">
            <RuleVersionInputs
              runbookId={rule.runbookId}
              version={selectedVersion?.version ?? null}
              strategy={strategy}
              checksum={selectedVersion?.checksum ?? null}
              inputs={ruleInputRows(selectedVersion?.inputs ?? [], rule.inputValues)}
              rawInputs={JSON.stringify(redactRunbookConfiguration(rule.inputValues), null, 2)}
            />
          </RuleSection>

          <RuleSection
            id="history"
            icon={History}
            title="Execution history · latest 50"
            description="Outcomes of executions started by this rule."
          >
            <RuleExecutionHistory
              executions={rule.executions.map(execution => ({
                id: execution.id,
                status: execution.status,
                ...timestamp(execution.startedAt ?? execution.createdAt),
                duration: formatDuration(
                  execution.startedAt,
                  execution.completedAt,
                  execution.status
                ),
                incidentId: execution.incidentId,
                checksum: execution.definitionChecksum,
              }))}
            />
          </RuleSection>

          <RuleSection
            id="policy"
            icon={ShieldCheck}
            title="Read-only policy evidence · latest 20"
            description="These checks perform no physical action. They do not certify network access, target permissions or future configuration."
          >
            <RulePolicyEvidence
              checks={checks.map(check => ({
                id: check.id,
                status: check.status,
                agent: check.agent?.name ?? `Agent ${check.agentId}`,
                checked: check.checkedAt ? timestamp(check.checkedAt) : null,
                pendingUntil: formatAbsolute(check.expiresAt),
                policyHash: check.policyHash,
                checksum: check.checksum,
              }))}
            />
          </RuleSection>

          <RuleSection id="audit" icon={ScrollText} title="Audit">
            {permissions.capabilities.includes(CAPABILITIES.AUDIT_READ) ? (
              <Link
                href={`/audit?entityType=RUNBOOK&entityId=${rule.runbookId}`}
                className="text-sm text-primary hover:underline"
              >
                Inspect rule and workflow audit events
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">
                Audit access requires the audit.read capability.
              </p>
            )}
          </RuleSection>

          <Link href={configureHref} className="inline-block text-sm text-primary hover:underline">
            <span aria-hidden>← </span>Back to service automations
          </Link>
        </div>
      </div>
    </div>
  );
}
