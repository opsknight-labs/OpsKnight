import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  GitBranch,
  Hand,
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
  Sparkles,
  Zap,
} from 'lucide-react';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import {
  assertCanViewService,
  assertCanModifyService,
  assertCapability,
  getCurrentUser,
  getUserPermissions,
} from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { CAPABILITIES } from '@/lib/authorization';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
import { describeBinding } from '@/lib/runbooks/presentation/binding-contract';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
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

function timestamp(date: Date, timeZone: string) {
  return {
    iso: date.toISOString(),
    relative: formatDistanceToNow(date, { addSuffix: true }),
    absolute: formatAbsolute(date, timeZone),
  };
}

export default async function AutomationRulePage({
  params,
}: {
  params: Promise<{ id: string; ruleId: string }>;
}) {
  const input = z.object({ id: z.string().cuid(), ruleId: z.string().cuid() }).parse(await params);
  const [user] = await Promise.all([
    getCurrentUser(),
    assertCanViewService(input.id),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
  ]);
  const userTimeZone = getUserTimeZone(user);
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
      <DetailHeroBanner
        statsPlacement="bottom"
        breadcrumb={{
          label: rule.service?.name ?? 'Service Automations',
          href: configureHref,
          current: ruleName,
        }}
        tag="AUTOMATION RULE · SERVICE PROTECTOR"
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <RuleStatusPill kind={statusKind} />
            <Badge
              variant="outline"
              className="border-white/20 bg-white/5 text-slate-300 font-mono text-[11px] font-normal shadow-2xs"
            >
              {selectedVersion ? `v${selectedVersion.version}` : 'No version'} ({strategy})
            </Badge>
            {matchesEverything && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-medium text-[11px] shadow-2xs flex items-center gap-1"
              >
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                Wildcard Trigger (All Incidents)
              </Badge>
            )}
          </div>
        }
        icon={
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-inner transition-transform',
              rule.mode === 'AUTOMATIC'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : rule.mode === 'SUGGESTED'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border-sky-500/30 bg-sky-500/10 text-sky-400'
            )}
          >
            {rule.mode === 'AUTOMATIC' ? (
              <Zap className="h-6 w-6" />
            ) : rule.mode === 'SUGGESTED' ? (
              <Sparkles className="h-6 w-6" />
            ) : (
              <Hand className="h-6 w-6" />
            )}
          </div>
        }
        title={ruleName}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span>
              Runs{' '}
              <Link
                href={`/runbooks/${rule.runbookId}`}
                className="font-semibold text-white hover:text-primary transition-colors underline-offset-2 hover:underline"
              >
                {rule.runbook.name}
              </Link>
            </span>
            <span>·</span>
            <span>created by {rule.createdBy?.name ?? 'OpsKnight Admin'}</span>
            <span>·</span>
            <RuleTimestamp
              {...timestamp(rule.createdAt, userTimeZone)}
              className="text-slate-400"
            />
          </div>
        }
        stats={[
          {
            label: 'TARGET',
            value: presentation.target,
            icon: <Server className="h-3.5 w-3.5 text-primary" />,
            subtext: rule.defaultAgent
              ? 'Dedicated Agent'
              : rule.defaultAgentPool
                ? 'Agent Pool'
                : 'Dynamic Target',
          },
          {
            label: 'TRIGGER',
            value: presentation.trigger,
            icon: <Radio className="h-3.5 w-3.5 text-amber-400" />,
            subtext: matchesEverything
              ? '⚡ Matches all incidents (Wildcard)'
              : rule.triggers.length === 1
                ? '1 trigger condition'
                : `${rule.triggers.length} triggers`,
          },
          {
            label: 'FLEET READINESS',
            value: (
              <span
                className={cn('inline-flex items-center gap-1.5', TONE_TEXT[readinessView.tone])}
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[readinessView.tone])}
                />
                {readinessView.label}
              </span>
            ),
            icon:
              readiness.state === 'BLOCKED' ? (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              ),
            subtext:
              readiness.state === 'BLOCKED'
                ? `${readiness.checks.filter(c => c.state === 'blocked').length} blocking issues`
                : `${readiness.checks.length} policy checks evaluated`,
          },
          {
            label: 'EXECUTIONS',
            value: `${rule.executions.length} runs`,
            icon: <Activity className="h-3.5 w-3.5 text-indigo-400" />,
            subtext:
              successRate(rule.executions) !== null
                ? `${successRate(rule.executions)}% success rate`
                : 'No runs recorded',
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canRun && (
              <Button
                asChild
                size="sm"
                className="h-9 px-3.5 gap-2 rounded-xl font-semibold shadow-xs"
              >
                <a href="#run-now">
                  <Play className="h-4 w-4" aria-hidden />
                  <span>Run now</span>
                </a>
              </Button>
            )}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-9 px-3.5 gap-2 rounded-xl border-white/20 bg-white/5 hover:bg-white/10 text-white font-semibold shadow-xs"
            >
              <Link href={configureHref}>
                <Settings2 className="h-4 w-4" aria-hidden />
                <span>Configure</span>
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-9 px-3.5 gap-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 font-semibold"
            >
              <Link href={`/runbooks/${rule.runbookId}`}>
                <BookOpen className="h-4 w-4" aria-hidden />
                <span>Master Runbook</span>
              </Link>
            </Button>
          </div>
        }
      />

      {/* Modernized Safety & Verification Pillars */}
      <section
        aria-label="What the evidence establishes"
        className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/70 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-foreground">
                Safety & Verification Pillars
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Boundary guarantees enforced before automated remediation dispatches
              </p>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-muted-foreground px-2 py-0.5 rounded-md border border-border/70 bg-muted/40">
            4-Stage Gate
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
          <div className="group rounded-xl border border-border/70 bg-card/80 p-3 shadow-2xs hover:border-border transition-colors">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-xs font-bold text-foreground">1. Configuration</h3>
              </div>
              <span className="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-semibold px-1.5 py-0.5">
                Valid
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Validates version, typed inputs, trigger and target schemas. Performs no physical
              action.
            </p>
          </div>

          <div className="group rounded-xl border border-border/70 bg-card/80 p-3 shadow-2xs hover:border-border transition-colors">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-xs font-bold text-foreground">2. Agent Policy</h3>
              </div>
              <span
                className={cn(
                  'rounded border text-[10px] font-mono font-semibold px-1.5 py-0.5',
                  certifiedAgents > 0
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                )}
              >
                {certifiedAgents} / {readiness.eligibleAgents ?? 0} Certified
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              A fresh signed allowlist check for this exact configuration. Does not grant platform
              permissions.
            </p>
          </div>

          <div className="group rounded-xl border border-border/70 bg-card/80 p-3 shadow-2xs hover:border-border transition-colors">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  <FlaskConical className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-xs font-bold text-foreground">3. Execution Preview</h3>
              </div>
              <span className="rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-mono font-semibold px-1.5 py-0.5">
                Frozen
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Review frozen plan and approval gates. Preview neither runs commands nor mutates
              targets.
            </p>
          </div>

          <div className="group rounded-xl border border-border/70 bg-card/80 p-3 shadow-2xs hover:border-border transition-colors">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Activity className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-xs font-bold text-foreground">4. Target Verification</h3>
              </div>
              <span className="rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-mono font-semibold px-1.5 py-0.5">
                Enforced
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Requires completed action and authored checks with healthy post-state.
            </p>
          </div>
        </div>
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

      <RuleSectionNav
        badges={{
          overview:
            readiness.state === 'BLOCKED'
              ? {
                  label: `${readiness.checks.filter(c => c.state === 'blocked').length}`,
                  tone: 'danger',
                }
              : readiness.state === 'CHECKS_REQUIRED'
                ? { label: 'check', tone: 'warning' }
                : { label: 'ready', tone: 'success' },
          trigger: matchesEverything ? { label: 'all', tone: 'warning' } : undefined,
          version: selectedVersion ? { label: `v${selectedVersion.version}` } : undefined,
          history: rule.executions.length > 0 ? { label: `${rule.executions.length}` } : undefined,
          policy: checks.length > 0 ? { label: `${checks.length}` } : undefined,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <aside
          aria-label="Rule summary"
          className="order-first space-y-4 lg:sticky lg:top-16 lg:order-last lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:pb-4"
        >
          {/* Compact At a glance Card */}
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                  <Gauge className="h-4 w-4" />
                </div>
                <h3 className="text-xs sm:text-sm font-bold tracking-tight text-foreground">
                  At a glance
                </h3>
              </div>
              <span className="text-[10px] font-mono font-semibold uppercase text-muted-foreground px-2 py-0.5 rounded border border-border/70 bg-background/50">
                Summary
              </span>
            </div>
            <div className="p-3 sm:p-4">
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
                        ...timestamp(lastRun.startedAt ?? lastRun.createdAt, userTimeZone),
                      }
                    : null,
                  successRate: successRate(rule.executions),
                  recentRuns: rule.executions.length,
                }}
              />
            </div>
          </div>

          {/* Compact Lifecycle Stepper Card */}
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-2xs">
                  <Route className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold tracking-tight text-foreground">
                    Lifecycle
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Configure → validate → activate → monitor
                  </p>
                </div>
              </div>
            </div>
            <div className="p-3.5 sm:p-4">
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
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <RuleSection
            id="checks"
            icon={PlayCircle}
            title="Run & validate"
            description="Work through these in order. The first two steps never run anything."
          >
            <details className="group rounded-xl border border-border/80 dark:border-border/60 bg-muted/20 text-xs overflow-hidden shadow-2xs [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="inline-flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" aria-hidden />
                  <span>Execution & Verification Guardrails</span>
                </span>
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180 text-muted-foreground"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-border/60 bg-background/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>
                    <strong className="text-foreground">Zero-Mutation Validations:</strong>{' '}
                    Configuration validation and Agent policy checks perform no action on targets.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
                  <span>
                    <strong className="text-foreground">Read-Only Safety:</strong> A read-only test
                    executes the complete workflow and is immediately rejected if any step attempts
                    to write.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                  <span>
                    <strong className="text-foreground">Plan Preview:</strong> Run now previews the
                    complete plan and requires explicit write confirmation where applicable.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>
                    <strong className="text-foreground">Inviolable Gates:</strong> Approval gates
                    configured in the master runbook workflow always apply, including in Automatic
                    mode.
                  </span>
                </div>
              </div>
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
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-2xs',
                    readinessView.tone === 'danger'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : readinessView.tone === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[readinessView.tone])}
                  />
                  {readinessView.label}
                </span>
                <span className="text-muted-foreground/60 text-xs select-none">·</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Checked</span>
                  <RuleTimestamp {...timestamp(new Date(readiness.checkedAt), userTimeZone)} />
                </span>
              </div>
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

          <RuleSection
            id="target"
            icon={Server}
            title="Target & Topology"
            description="Designated agent or compute pool assigned to execute this automated runbook"
          >
            <div className="rounded-xl border border-border/80 dark:border-border/60 bg-card/60 backdrop-blur-xs p-4 shadow-2xs space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                    <Server className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-foreground">
                        {presentation.target}
                      </p>
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono font-medium px-2 py-0 h-4.5 border border-border/80"
                      >
                        {rule.defaultAgent
                          ? 'Dedicated Agent'
                          : rule.defaultAgentPool
                            ? 'Agent Pool'
                            : 'Dynamic Dispatch'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {rule.defaultAgent
                        ? `Bound to Agent node #${rule.defaultAgentId?.slice(0, 8)}`
                        : rule.defaultAgentPool
                          ? `Routing across pool #${rule.defaultAgentPoolId?.slice(0, 8)}`
                          : 'Target resolved dynamically based on incident topology'}
                    </p>
                  </div>
                </div>
                {rule.defaultAgentId && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 shadow-2xs shrink-0"
                  >
                    <Link href={`/runbooks/agents?agentId=${rule.defaultAgentId}`}>
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Inspect Agent</span>
                    </Link>
                  </Button>
                )}
              </div>

              {readiness.eligibleAgents === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300 leading-relaxed">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  <span>
                    No healthy online agents currently match this fleet target. Dispatches to this
                    node will fail until an eligible agent is online and reporting health.
                  </span>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span>
                  Online status does not guarantee local execution permissions. Target hosts must
                  have matching runbook allowlists and signed policy evidence before dispatch.
                </span>
              </div>
            </div>
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
                ...timestamp(execution.startedAt ?? execution.createdAt, userTimeZone),
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
                checked: check.checkedAt ? timestamp(check.checkedAt, userTimeZone) : null,
                pendingUntil: formatAbsolute(check.expiresAt, userTimeZone),
                policyHash: check.policyHash,
                checksum: check.checksum,
              }))}
            />
          </RuleSection>

          <RuleSection
            id="audit"
            icon={ScrollText}
            title="Audit & Compliance"
            description="Cryptographic event trails for configuration changes, policy evaluations, and runs"
          >
            <div className="rounded-xl border border-border/80 dark:border-border/60 bg-card/60 backdrop-blur-xs p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs">
                  <ScrollText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-foreground">
                    Tamper-Evident Runbook Audit Logs
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {permissions.capabilities.includes(CAPABILITIES.AUDIT_READ)
                      ? 'Detailed history of rule creation, policy approvals, and execution dispatches'
                      : 'Audit access requires the audit.read capability.'}
                  </p>
                </div>
              </div>
              {permissions.capabilities.includes(CAPABILITIES.AUDIT_READ) && (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 shadow-2xs shrink-0"
                >
                  <Link href={`/audit?entityType=RUNBOOK&entityId=${rule.runbookId}`}>
                    <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>View Audit Events</span>
                  </Link>
                </Button>
              )}
            </div>
          </RuleSection>

          <div className="pt-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground gap-2"
            >
              <Link href={configureHref}>
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to service automations</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
