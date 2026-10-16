'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useVersionConfiguration } from '@/components/runbooks/useVersionConfiguration';
import {
  ActionForm,
  ConfigureSheet,
  FormSelect,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import RunbookTargetSelect from '@/components/runbooks/RunbookTargetSelect';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
import AutomaticTargetGuard from '@/components/runbooks/AutomaticTargetGuard';
import RuleWizard from '@/components/runbooks/RuleWizard';
import Field from '@/components/runbooks/RunbookField';
import { attachRunbookAction } from '@/app/(app)/services/[id]/runbook-actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import RunbookBindingVersionInputs from '../RunbookBindingVersionInputs';
import { InputFields, hasAgentWrites } from './rule-fields';
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
}: {
  serviceId: string;
  runbooks: AvailableRunbook[];
  agents: ServiceRunbookAgent[];
  pools: ServiceRunbookAgentPool[];
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
  const loaded = useVersionConfiguration(
    metadata?.metadataOnly ? metadata.id : null,
    runbook?.id
  );
  const version = metadata?.metadataOnly ? loaded.data : metadata;
  const versionWrites = version
    ? (version.hasAgentWrite ??
      hasAgentWrites('definition' in version ? version.definition : undefined))
    : false;

  return (
    <ConfigureSheet
      title="Create service automation rule"
      description="Pick a workflow from the library, then set its version, target, inputs and trigger."
      trigger={
        <Button size="sm" className="h-9 gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          <span>Create rule</span>
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Workflow</Label>
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
          <ActionForm
            key={runbook.id}
            action={attachRunbookAction.bind(null, serviceId)}
            className="space-y-4 rounded-xl border bg-muted/10 p-4"
            successMessage="Rule created"
          >
            <input
              type="hidden"
              name="runbookSelection"
              value={`${runbook.id}:${runbook.publishedVersionId}`}
            />
            <div className="rounded-lg border bg-background p-3">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span>{runbook.name}</span>
                <Badge variant="outline" className="text-[11px]">
                  v{runbook.publishedVersion?.version ?? '1'} published
                </Badge>
              </div>
              {runbook.description && (
                <p className="mt-1 text-xs text-muted-foreground">{runbook.description}</p>
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
                      <Field label="Rule name">
                        <Input name="ruleName" placeholder="Production recovery" maxLength={200} />
                      </Field>
                      <Field label="Initial status">
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
                          agents={agents}
                          pools={pools}
                          hasAgentWrite={versionWrites}
                        />
                      </Field>
                      {metadata?.metadataOnly && !version && (
                        <p data-form-invalid="true" role="status">
                          {loaded.error
                            ? 'Version configuration unavailable. Reload to retry.'
                            : 'Loading selected version configuration…'}
                        </p>
                      )}
                      <RunbookSelectorBuilder />
                      <AutomaticTargetGuard />
                      {(version?.inputs?.length ?? 0) > 0 && (
                        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-3">
                          <InputFields
                            key={version?.id}
                            definitions={version?.inputs ?? []}
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
                        Manual mode never arms a trigger. Incident-created triggers apply to future
                        events. After saving, use Configure to narrow conditions before enabling
                        automation.
                      </p>
                    </>
                  ),
                },
                {
                  title: 'Review and save',
                  content: (
                    <>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        <li>Automatic rules always save paused.</li>
                        <li>
                          Activate them from Rule evidence after fresh configuration and Agent policy
                          checks.
                        </li>
                        <li>Configuration checks do not prove platform permissions.</li>
                      </ul>
                      <div className="pt-2 lg:col-span-3">
                        <SubmitButton pendingLabel="Attaching…">Attach {runbook.name}</SubmitButton>
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
  );
}
