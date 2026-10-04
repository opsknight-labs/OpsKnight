import Link from 'next/link';
import type { Prisma, RunbookInput } from '@prisma/client';
import { BookOpen, Link2, Settings2 } from 'lucide-react';
import { flattenSteps, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { requiresAgent } from '@/lib/runbooks/types';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfirmAction,
  ConfigureSheet,
  SubmitButton,
  FormSelect,
} from '@/components/runbooks/RunbookControls';
import RunbookTargetSelect from '@/components/runbooks/RunbookTargetSelect';
import { Textarea } from '@/components/ui/shadcn/textarea';
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
import RunbookBindingVersionInputs from './RunbookBindingVersionInputs';

type Binding = Prisma.ServiceRunbookBindingGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}>;

type AvailableRunbook = Prisma.RunbookGetPayload<{
  include: {
    publishedVersion: { include: { inputs: true } };
    versions: { include: { inputs: true } };
  };
}>;

export default function ServiceRunbooks({
  serviceId,
  bindings,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  canManage,
}: {
  serviceId: string;
  bindings: Binding[];
  availableRunbooks: AvailableRunbook[];
  availableAgents: Array<{ id: string; name: string; hostname: string | null }>;
  availableAgentPools: Array<{
    id: string;
    name: string;
    mode: string;
    _count?: { members: number };
  }>;
  canManage: boolean;
}) {
  const unattached = availableRunbooks.filter(
    runbook => !bindings.some(binding => binding.runbookId === runbook.id)
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Service runbooks</h2>
          <p className="text-sm text-muted-foreground">
            Attach reusable published workflows with service-specific inputs and execution policy.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/runbooks">
            <BookOpen /> Library
          </Link>
        </Button>
      </div>
      {bindings.map(binding => (
        <Card key={binding.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/runbooks/${binding.runbookId}`} className="hover:underline">
                    {binding.runbook.name}
                  </Link>
                </CardTitle>
                <CardDescription>{binding.runbook.description}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant={binding.enabled ? 'default' : 'secondary'}>
                  {binding.enabled ? binding.mode : 'DISABLED'}
                </Badge>
                <Badge variant="outline">
                  {binding.versionStrategy === 'PINNED'
                    ? `v${binding.runbookVersion?.version ?? '?'}`
                    : 'Latest published'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Target:{' '}
                {availableAgents.find(agent => agent.id === binding.defaultAgentId)?.name ??
                  availableAgentPools.find(pool => pool.id === binding.defaultAgentPoolId)?.name ??
                  'Control plane'}{' '}
                · Trigger:{' '}
                {binding.triggers.length
                  ? `${binding.triggers[0]?.event.replaceAll('_', ' ')} · ${binding.triggers[0]?.conditions.length ?? 0} conditions`
                  : 'Manual only'}
              </p>
              <InputSummary
                definitions={
                  binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
                }
                values={binding.inputValues as Record<string, unknown>}
              />
            </div>
            {canManage && (
              <ConfigureSheet
                title={`Configure ${binding.runbook.name}`}
                description="Review version, inputs, target and trigger policy before saving."
                trigger={
                  <Button variant="outline" size="sm">
                    <Settings2 className="h-4 w-4" />
                    Configure
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
                  <RunbookBindingVersionInputs
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
                  <Field label="Agent selector (JSON)">
                    <Textarea
                      name="agentSelector"
                      aria-label="Agent selector"
                      defaultValue={JSON.stringify(binding.agentSelector)}
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
                      <Settings2 /> Save binding
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
                      defaultValue={binding.triggers[0]?.conditionLogic ?? 'AND'}
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
                    {(binding.triggers[0]?.conditions ?? []).map(condition => (
                      <TriggerConditionRow
                        key={condition.id}
                        field={condition.field}
                        operator={condition.operator}
                        value={condition.value}
                      />
                    ))}
                    <TriggerConditionRow />
                    <p className="text-xs text-muted-foreground">
                      Leave the final field empty to add no condition. Comma-separate values for
                      “in” operators. Automatic mode still stops at approval gates.
                    </p>
                  </div>
                </ActionForm>
              </ConfigureSheet>
            )}
          </CardContent>
        </Card>
      ))}
      {bindings.length === 0 && (
        <EmptyState
          title="No service runbooks"
          description="Attach a published workflow with this service’s inputs and execution target."
          icon={<BookOpen />}
        />
      )}
      {canManage && unattached.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 /> Attach a runbook
            </CardTitle>
            <CardDescription>Automatic mode requires an immutable pinned version.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {unattached.map(runbook => (
              <ConfigureSheet
                key={runbook.id}
                title={`Attach ${runbook.name}`}
                description="Set inputs and execution policy for this service."
                trigger={
                  <Button variant="outline" className="mr-2 mb-2">
                    Attach {runbook.name}
                  </Button>
                }
              >
                <ActionForm
                  key={runbook.id}
                  action={attachRunbookAction.bind(null, serviceId)}
                  className="grid gap-3 rounded-md border p-4 lg:grid-cols-3"
                >
                  <input
                    type="hidden"
                    name="runbookSelection"
                    value={`${runbook.id}:${runbook.publishedVersionId}`}
                  />
                  <div className="lg:col-span-3">
                    <div className="font-medium">{runbook.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Published version {runbook.publishedVersion?.version}
                    </div>
                  </div>
                  <Field label="Mode">
                    <FormSelect
                      name="mode"
                      label="Execution mode"
                      defaultValue="MANUAL"
                      options={[
                        { value: 'MANUAL', label: 'Manual' },
                        { value: 'SUGGESTED', label: 'Suggested' },
                        { value: 'AUTOMATIC', label: 'Automatic · requires pinned version' },
                      ]}
                    />
                  </Field>
                  <Field label="Version strategy">
                    <FormSelect
                      name="versionStrategy"
                      label="Version strategy"
                      defaultValue="LATEST_PUBLISHED"
                      options={[
                        { value: 'LATEST_PUBLISHED', label: 'Latest published' },
                        { value: 'PINNED', label: 'Pinned' },
                      ]}
                    />
                  </Field>
                  <Field label="Execution target">
                    <RunbookTargetSelect
                      agents={availableAgents}
                      pools={availableAgentPools}
                      hasAgentWrite={
                        runbook.publishedVersion
                          ? hasAgentWrites(runbook.publishedVersion.definition)
                          : false
                      }
                    />
                  </Field>
                  <Field label="Agent selector (JSON)">
                    <Textarea name="agentSelector" aria-label="Agent selector" defaultValue="{}" />
                  </Field>
                  {(runbook.publishedVersion?.inputs.length ?? 0) > 0 && (
                    <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-3">
                      <InputFields
                        definitions={runbook.publishedVersion?.inputs ?? []}
                        values={{}}
                      />
                    </div>
                  )}
                  <div className="lg:col-span-3">
                    <SubmitButton pendingLabel="Attaching…">Attach {runbook.name}</SubmitButton>
                  </div>
                </ActionForm>
              </ConfigureSheet>
            ))}
          </CardContent>
        </Card>
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
            {input.type === 'SECRET_REF' && values[input.key]
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function hasAgentWrites(definition: Prisma.JsonValue): boolean {
  return flattenSteps(parseRunbookDefinition(definition)).some(
    step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY'
  );
}
