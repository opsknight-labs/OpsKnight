import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { Badge } from '@/components/ui/shadcn/badge';
import RuleConfigurationCheck from '@/components/runbooks/RuleConfigurationCheck';
import RunbookExecutionPreview from '@/components/runbooks/RunbookExecutionPreview';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import {
  activateRuleAction,
  validateRuleConfigurationAction,
  checkRulePolicyAction,
  previewServiceRuleAction,
  executeServiceRuleAction,
} from '../../runbook-actions';
import { redactRunbookConfiguration } from '@/lib/runbooks/display-name';
export const dynamic = 'force-dynamic';
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
      executions: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          status: true,
          createdAt: true,
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
  const readiness = await getBindingReadiness(rule);
  const permissions = await getUserPermissions();
  const canManage = await assertCanModifyService(input.id)
    .then(() => true)
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
    },
  });
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <RunbookPageHeader
        title={rule.name || rule.runbook.name}
        description={`Service automation rule ${rule.id} · Created by ${rule.createdBy?.name ?? 'Unavailable user'}`}
      />
      <nav aria-label="Rule evidence sections" className="flex flex-wrap gap-3">
        {['overview', 'checks', 'trigger', 'target', 'version', 'history', 'policy', 'audit'].map(
          section => (
            <a key={section} href={`#${section}`} className="text-primary underline capitalize">
              {section}
            </a>
          )
        )}
      </nav>
      <section id="checks" className="rounded-lg border p-4 space-y-4">
        <h2 className="font-semibold">Check and run this rule</h2>
        <RuleConfigurationCheck
          action={validateRuleConfigurationAction.bind(null, input.id, rule.id)}
        />
        {canManage && !rule.detachedAt && (
          <ActionForm action={checkRulePolicyAction.bind(null, input.id, rule.id)}>
            <SubmitButton variant="outline">Check Agent policy · No execution</SubmitButton>
          </ActionForm>
        )}
        <p className="text-sm text-muted-foreground">
          Configuration validation and Agent policy checking perform no action. A read-only test
          executes the complete workflow and is rejected if any action can write. Run now previews
          the complete plan and requires write confirmation where applicable.
        </p>
        {rule.enabled && permissions.capabilities.includes(CAPABILITIES.RUNBOOK_EXECUTE) && (
          <div className="grid gap-4 md:grid-cols-2">
            <RunbookExecutionPreview
              previewLabel="Preview read-only test"
              executeLabel="Execute read-only test"
              previewAction={previewServiceRuleAction.bind(null, input.id, rule.id, true)}
              executeAction={executeServiceRuleAction.bind(null, input.id, rule.id, true)}
            />
            <RunbookExecutionPreview
              previewLabel="Run now · Preview plan"
              previewAction={previewServiceRuleAction.bind(null, input.id, rule.id, false)}
              executeAction={executeServiceRuleAction.bind(null, input.id, rule.id, false)}
            />
          </div>
        )}
        {canManage && !rule.detachedAt && !rule.enabled && rule.mode === 'AUTOMATIC' && (
          <ActionForm action={activateRuleAction.bind(null, input.id, rule.id)}>
            <h3 className="font-semibold">Activate Automatic rule</h3>
            <p className="text-sm">
              Activation requires current configuration and successful Agent policy evidence.
              Execution approval gates still apply.
            </p>
            {rule.triggers.some(trigger => trigger.enabled && trigger.conditions.length === 0) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirmMatchAll" value="true" required />I confirm this
                rule can match every new incident for this service.
              </label>
            )}
            <SubmitButton>Activate Automatic rule</SubmitButton>
          </ActionForm>
        )}
        {!rule.enabled && (
          <p className="text-sm">
            This rule is paused. Review its checks and use its activation controls before running
            it.
          </p>
        )}
      </section>
      <section id="overview" className="rounded-lg border p-4 space-y-2">
        <h2 className="font-semibold">Overview</h2>
        <Badge variant="outline">{rule.enabled ? rule.mode : 'PAUSED'}</Badge>
        <p>
          {readiness.state.replaceAll('_', ' ')} · checked {readiness.checkedAt}
        </p>
        {readiness.checks.map(check => (
          <p key={check.code} className="text-sm">
            {check.message}
          </p>
        ))}
      </section>
      <section id="trigger" className="rounded-lg border p-4 space-y-2">
        <h2 className="font-semibold">Trigger</h2>
        <p>{presentation.trigger}</p>
        {rule.detachedAt && (
          <p>
            This rule was detached and archived. Its configuration, suggestions and execution
            history are retained. It cannot run or be reactivated.
          </p>
        )}
        {rule.triggers.map(trigger => (
          <article key={trigger.id}>
            <p>
              {trigger.event} ·{' '}
              {trigger.enabled ? 'Enabled condition rule' : 'Disabled condition rule'} ·{' '}
              {trigger.conditionLogic}
            </p>
            {trigger.conditions.map(condition => (
              <p key={condition.id} className="text-sm break-words">
                {condition.field} · {condition.operator}
                <span className="block break-all text-xs">
                  {JSON.stringify(redactRunbookConfiguration(condition.value))}
                </span>
              </p>
            ))}
          </article>
        ))}
      </section>
      <section id="target" className="rounded-lg border p-4">
        <h2 className="font-semibold">Target and permissions</h2>
        <p>{presentation.target}</p>
        <p>Online and capable does not establish local allowlist or target-side permission.</p>
        {rule.defaultAgentId && (
          <Link
            href={`/runbooks/agents?agentId=${rule.defaultAgentId}`}
            className="text-primary underline"
          >
            Inspect Agent
          </Link>
        )}
      </section>
      <section id="version" className="rounded-lg border p-4">
        <h2 className="font-semibold">Version and inputs</h2>
        <p>
          {rule.versionStrategy} · v{selectedVersion?.version}
        </p>
        <p className="text-xs break-all">Checksum: {selectedVersion?.checksum}</p>
        <Link href={`/runbooks/${rule.runbookId}`} className="text-primary underline">
          Review workflow, inputs and version impact
        </Link>
        <p>Secret values and references remain masked in service summaries.</p>
        <details>
          <summary className="min-h-11 cursor-pointer py-3">Review resolved rule inputs</summary>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(redactRunbookConfiguration(rule.inputValues), null, 2)}
          </pre>
        </details>
      </section>
      <section id="history" className="space-y-2">
        <h2 className="font-semibold">Execution history · latest 50</h2>
        {rule.executions.map(execution => (
          <article key={execution.id} className="rounded border p-3 flex flex-wrap gap-3">
            <Link href={`/runbooks/executions/${execution.id}`} className="text-primary underline">
              {execution.status} · {execution.createdAt.toISOString()}
            </Link>
            {execution.incidentId && (
              <Link href={`/incidents/${execution.incidentId}`} className="text-primary underline">
                Source incident
              </Link>
            )}
            <span className="text-xs break-all">
              Frozen checksum {execution.definitionChecksum}
            </span>
          </article>
        ))}
      </section>
      <section id="policy" className="space-y-2">
        <h2 className="font-semibold">Read-only policy evidence · latest 20</h2>
        {checks.map(check => (
          <article key={check.id} className="rounded border p-3 text-sm">
            {check.status} · Agent {check.agentId} ·{' '}
            {check.checkedAt?.toISOString() ?? `Pending until ${check.expiresAt.toISOString()}`}
            <p className="break-all text-xs">
              Policy hash: {check.policyHash ?? 'Not reported'} · Frozen definition checksum:{' '}
              {check.checksum}
            </p>
          </article>
        ))}
        <p className="text-xs text-muted-foreground">
          These checks perform no physical action. They do not certify network access, target
          permissions or future configuration.
        </p>
      </section>
      <section id="audit" className="rounded-lg border p-4">
        <h2 className="font-semibold">Audit</h2>
        {permissions.capabilities.includes(CAPABILITIES.AUDIT_READ) ? (
          <Link
            href={`/audit?entityType=RUNBOOK&entityId=${rule.runbookId}`}
            className="text-primary underline"
          >
            Inspect rule and workflow audit events
          </Link>
        ) : (
          <p>Audit access requires the audit.read capability.</p>
        )}
      </section>
      <Link href={`/services/${input.id}?tab=runbooks`} className="text-primary underline">
        Back to service automations
      </Link>
    </div>
  );
}
