import Link from 'next/link';
import type { Prisma, RunbookInput } from '@prisma/client';
import { BookOpen, Link2, Settings2, Trash2 } from 'lucide-react';
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
  availableAgentPools: Array<{ id: string; name: string; mode: string }>;
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
            {canManage ? (
              <form
                action={updateRunbookBindingAction.bind(null, serviceId, binding.id)}
                className="grid gap-3 lg:grid-cols-4"
              >
                <Field label="Mode">
                  <select
                    name="mode"
                    defaultValue={binding.mode}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="SUGGESTED">Suggested</option>
                    <option value="AUTOMATIC">Automatic</option>
                  </select>
                </Field>
                <RunbookBindingVersionInputs
                  versions={
                    availableRunbooks
                      .find(item => item.id === binding.runbookId)
                      ?.versions.map(version => ({
                        id: version.id,
                        version: version.version,
                        state: version.state,
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
                />
                <Field label="Status">
                  <select
                    name="enabled"
                    defaultValue={String(binding.enabled)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </Field>
                <Field label="Execution target">
                  <TargetSelect
                    agents={availableAgents}
                    pools={availableAgentPools}
                    defaultValue={
                      binding.defaultAgentId
                        ? `agent:${binding.defaultAgentId}`
                        : binding.defaultAgentPoolId
                          ? `pool:${binding.defaultAgentPoolId}`
                          : ''
                    }
                  />
                </Field>
                <div className="order-2 flex gap-2 lg:col-span-4">
                  <Button type="submit" variant="outline">
                    <Settings2 /> Save binding
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    formAction={detachRunbookAction.bind(null, serviceId, binding.id)}
                  >
                    <Trash2 /> Detach
                  </Button>
                </div>
              </form>
            ) : (
              <InputSummary
                definitions={
                  binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
                }
                values={binding.inputValues as Record<string, unknown>}
              />
            )}
            {canManage && (
              <form
                action={configureRunbookTriggerAction.bind(null, serviceId, binding.id)}
                className="mt-4 grid gap-3 border-t pt-4 lg:grid-cols-3"
              >
                <Field label="Trigger event">
                  <select
                    name="event"
                    defaultValue="INCIDENT_CREATED"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="INCIDENT_CREATED">Incident created</option>
                  </select>
                </Field>
                <Field label="Condition logic">
                  <select
                    name="conditionLogic"
                    defaultValue={binding.triggers[0]?.conditionLogic ?? 'AND'}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="AND">Match all</option>
                    <option value="OR">Match any</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <Button type="submit" variant="outline">
                    Save trigger
                  </Button>
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
                    Leave the final field empty to add no condition. Comma-separate values for “in”
                    operators. Automatic mode still stops at approval gates.
                  </p>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
      {bindings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No runbooks are attached to this service.
          </CardContent>
        </Card>
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
              <form
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
                  <select
                    name="mode"
                    defaultValue="MANUAL"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="SUGGESTED">Suggested</option>
                    <option value="AUTOMATIC">Automatic</option>
                  </select>
                </Field>
                <Field label="Version strategy">
                  <select
                    name="versionStrategy"
                    defaultValue="LATEST_PUBLISHED"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="LATEST_PUBLISHED">Latest published</option>
                    <option value="PINNED">Pinned</option>
                  </select>
                </Field>
                <Field label="Execution target">
                  <TargetSelect agents={availableAgents} pools={availableAgentPools} />
                </Field>
                {(runbook.publishedVersion?.inputs.length ?? 0) > 0 && (
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-3">
                    <InputFields definitions={runbook.publishedVersion?.inputs ?? []} values={{}} />
                  </div>
                )}
                <div className="lg:col-span-3">
                  <Button type="submit">Attach {runbook.name}</Button>
                </div>
              </form>
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
      <select
        name="conditionField"
        defaultValue={field}
        className="h-10 rounded-md border bg-background px-3 text-sm"
      >
        <option value="">No additional condition</option>
        {field && !knownField && <option value={field}>{field}</option>}
        {triggerFields.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <select
        name="conditionOperator"
        defaultValue={operator}
        className="h-10 rounded-md border bg-background px-3 text-sm"
      >
        <option value="EQUALS">Equals</option>
        <option value="NOT_EQUALS">Does not equal</option>
        <option value="CONTAINS">Contains</option>
        <option value="STARTS_WITH">Starts with</option>
        <option value="IN">Is one of</option>
        <option value="NOT_IN">Is not one of</option>
        <option value="EXISTS">Exists</option>
        <option value="NOT_EXISTS">Does not exist</option>
      </select>
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

function TargetSelect({
  agents,
  pools,
  defaultValue = '',
}: {
  agents: Array<{ id: string; name: string; hostname: string | null }>;
  pools: Array<{ id: string; name: string; mode: string }>;
  defaultValue?: string;
}) {
  return (
    <select
      name="executionTarget"
      defaultValue={defaultValue}
      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
    >
      <option value="">No Agent target</option>
      {pools.length > 0 && (
        <optgroup label="Agent pools">
          {pools.map(pool => (
            <option key={pool.id} value={`pool:${pool.id}`}>
              {pool.name} · {pool.mode.replaceAll('_', ' ')}
            </option>
          ))}
        </optgroup>
      )}
      {agents.length > 0 && (
        <optgroup label="Specific Agents">
          {agents.map(agent => (
            <option key={agent.id} value={`agent:${agent.id}`}>
              {agent.name}
              {agent.hostname ? ` · ${agent.hostname}` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
