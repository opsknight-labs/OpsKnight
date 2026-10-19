'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Plus, ShieldCheck } from 'lucide-react';
import { useVersionConfiguration } from '@/components/runbooks/useVersionConfiguration';
import { ActionForm, FormSelect, SubmitButton } from '@/components/runbooks/RunbookControls';
import RunbookTargetSelect from '@/components/runbooks/RunbookTargetSelect';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
import AutomaticTargetGuard from '@/components/runbooks/AutomaticTargetGuard';
import RuleWizard from '@/components/runbooks/RuleWizard';
import Field from '@/components/runbooks/RunbookField';
import { Pill } from '@/components/runbooks/ui/primitives';
import { attachRunbookAction } from '@/app/(app)/services/[id]/runbook-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import RunbookBindingVersionInputs from '../RunbookBindingVersionInputs';
import { InputFields, hasAgentWrites } from './rule-fields';
import { RuleSheet } from './RuleSheet';
import { RuleAutomationFields } from './RuleAutomationControls';
import type { AutomationContextSummary } from './context-helpers';
import type {
  AvailableRunbook,
  ServiceRunbookAgent,
  ServiceRunbookAgentPool,
} from '../ServiceRunbooks';

export function CreateRuleSheet({
  serviceId,
  runbooks,
  agents,
  pools,
  automationContext = null,
}: {
  serviceId: string;
  runbooks: AvailableRunbook[];
  agents: ServiceRunbookAgent[];
  pools: ServiceRunbookAgentPool[];
  automationContext?: AutomationContextSummary | null;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');

  const runbook = useMemo(
    () => runbooks.find(item => item.id === selectedId) ?? runbooks[0] ?? null,
    [runbooks, selectedId]
  );
  const metadata = runbook?.versions.find(
    version => version.id === (selectedVersionId ?? runbook.publishedVersionId)
  );
  const loaded = useVersionConfiguration(metadata?.metadataOnly ? metadata.id : null, runbook?.id);
  const version = metadata?.metadataOnly ? loaded.data : metadata;
  const versionWrites = version
    ? (version.hasAgentWrite ??
      hasAgentWrites('definition' in version ? version.definition : undefined))
    : false;

  return (
    <RuleSheet
      title="Create automation rule"
      description="Attach a library workflow to this service. Nothing runs when you save."
      trigger={
        <Button size="sm" className="h-9 gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          <span>Create rule</span>
        </Button>
      }
    >
      <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <div className="space-y-2">
          <Label htmlFor="selectedRunbook">Workflow</Label>
          <FormSelect
            name="selectedRunbook"
            label="Choose workflow"
            value={runbook?.id ?? ''}
            onValueChange={value => {
              setSelectedId(value);
              setSelectedVersionId(null);
            }}
            options={runbooks.map(item => ({
              value: item.id,
              label: `${item.name} (v${item.publishedVersion?.version ?? '1'})`,
            }))}
          />
        </div>
        {runbook && (
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <BookOpen className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{runbook.name}</p>
                <Pill tone="success">v{runbook.publishedVersion?.version ?? '1'} published</Pill>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {runbook.description || 'No description provided.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {runbook && (
        <ActionForm
          key={runbook.id}
          action={attachRunbookAction.bind(null, serviceId)}
          className="mt-6 flex flex-1 flex-col"
          successMessage="Rule created"
        >
          <input
            type="hidden"
            name="runbookSelection"
            value={`${runbook.id}:${runbook.publishedVersionId}`}
          />
          <RuleWizard
            summary={[
              [
                'Workflow',
                `${runbook.name} · v${runbook.publishedVersion?.version ?? '1'} published`,
              ],
            ]}
            submit={<SubmitButton pendingLabel="Attaching…">Attach {runbook.name}</SubmitButton>}
            steps={[
              {
                title: 'Version and mode',
                description:
                  'Choose how the rule runs and which published version it uses. Pin a version to freeze behaviour.',
                content: (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Field label="Rule name">
                        <Input
                          name="ruleName"
                          placeholder={`${runbook.name} · production`}
                          maxLength={200}
                        />
                      </Field>
                    </div>
                    <RunbookBindingVersionInputs
                      initialMode="MANUAL"
                      runbookId={runbook.id}
                      versions={[
                        ...new Map(
                          [
                            ...runbook.versions,
                            ...(runbook.publishedVersion ? [runbook.publishedVersion] : []),
                          ].map(item => [item.id, item])
                        ).values(),
                      ].map(item => ({
                        ...item,
                        hasAgentWrite: item.hasAgentWrite ?? hasAgentWrites(item.definition),
                        inputs: item.inputs ?? [],
                      }))}
                      publishedVersionId={runbook.publishedVersionId ?? ''}
                      initialStrategy="LATEST_PUBLISHED"
                      initialVersionId={null}
                      values={{}}
                      includeInputs={false}
                      onVersionChange={setSelectedVersionId}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="enabled">Initial status</Label>
                      <FormSelect
                        name="enabled"
                        label="Initial rule status"
                        defaultValue="false"
                        options={[
                          { value: 'false', label: 'Save paused · Review checks before enabling' },
                          {
                            value: 'true',
                            label: 'Enable Manual/Suggested · Automatic saves paused',
                          },
                        ]}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Target and inputs',
                description:
                  'Pick where the workflow runs and fill in its inputs. Leave the target empty for control-plane-only workflows.',
                content: (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="executionTarget">Execution target</Label>
                      <RunbookTargetSelect
                        agents={agents}
                        pools={pools}
                        hasAgentWrite={versionWrites}
                      />
                    </div>
                    {metadata?.metadataOnly && !version && (
                      <p
                        data-form-invalid="true"
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        {loaded.error
                          ? 'Version configuration unavailable. Reload to retry.'
                          : 'Loading selected version configuration…'}
                      </p>
                    )}
                    <RunbookSelectorBuilder />
                    <AutomaticTargetGuard />
                    <div className="space-y-3 border-t pt-4">
                      <p className="text-sm font-medium">Inputs</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <InputFields
                          key={version?.id}
                          definitions={version?.inputs ?? []}
                          values={{}}
                        />
                      </div>
                    </div>
                    <div className="space-y-3 border-t pt-4">
                      <div>
                        <p className="text-sm font-medium">Service Automation</p>
                        <p className="text-xs text-muted-foreground">
                          Optional. Monitoring incidents only run rules that opt in. Inputs and
                          targets can come from the incident automation context.
                        </p>
                      </div>
                      <RuleAutomationFields
                        key={version?.id}
                        inputs={version?.inputs ?? []}
                        automationContext={automationContext}
                        agents={agents}
                        pools={pools}
                      />
                    </div>
                  </>
                ),
              },
              {
                title: 'Trigger',
                description:
                  'Decide what starts this rule. You can narrow it with conditions after saving.',
                content: (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="initialTrigger">Initial trigger</Label>
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
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Manual rules never arm a trigger. Incident-created triggers apply to future
                      incidents only — use Configure to add conditions before enabling automation.
                    </p>
                  </>
                ),
              },
              {
                title: 'Review and save',
                description: 'Check the summary below. Saving attaches the rule; nothing runs yet.',
                content: (
                  <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-3 text-xs ring-1 ring-inset ring-primary/15">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <ul className="space-y-1 text-muted-foreground">
                      <li>Automatic rules always save paused until checks pass.</li>
                      <li>
                        Activate them from Rule evidence after configuration and policy checks.
                      </li>
                      <li>Configuration checks do not prove platform permissions.</li>
                    </ul>
                  </div>
                ),
              },
            ]}
          />
        </ActionForm>
      )}
    </RuleSheet>
  );
}
