'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Code2,
  ListOrdered,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import DetailTabs from '@/components/ui/DetailTabs';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  RUNBOOK_STEP_TYPES,
  RUNBOOK_INPUT_TYPES,
  type RunbookDefinition,
  type RunbookStepDefinition,
  type RunbookStepType,
} from '@/lib/runbooks/types';
import {
  runbookDefinitionSchema,
  runbookInputsSchema,
  type RunbookInputInput,
} from '@/lib/runbooks/schemas';
import {
  newBuilderStep,
  builderRisk,
  CONDITION_FIELDS,
  canonicalConditionField,
} from '@/lib/runbooks/builder';
import {
  ActionForm,
  ConfigureSheet,
  FormSelect,
  SubmitButton,
  type RunbookFormAction,
} from './RunbookControls';

type ConfigField = {
  key: string;
  label: string;
  options?: string[];
  number?: boolean;
  multiline?: boolean;
};
function fieldsFor(type: RunbookStepType): ConfigField[] {
  switch (type) {
    case 'HTTP':
      return [
        {
          key: 'method',
          label: 'Method',
          options: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
        },
        { key: 'url', label: 'URL or input reference' },
        { key: 'body', label: 'Request body', multiline: true },
      ];
    case 'SYSTEMD':
      return [
        { key: 'action', label: 'Action', options: ['status', 'start', 'stop', 'restart'] },
        { key: 'unit', label: 'Service unit or input reference' },
      ];
    case 'DOCKER':
      return [
        {
          key: 'action',
          label: 'Action',
          options: ['inspect', 'logs', 'start', 'stop', 'restart'],
        },
        { key: 'container', label: 'Container or input reference' },
      ];
    case 'KUBERNETES':
      return [
        { key: 'action', label: 'Action', options: ['get', 'describe', 'logs', 'rollout-restart'] },
        { key: 'namespace', label: 'Namespace' },
        { key: 'resource', label: 'Resource type' },
        { key: 'name', label: 'Resource name' },
      ];
    case 'LINUX_DIAGNOSTICS':
      return [
        {
          key: 'diagnostic',
          label: 'Diagnostic',
          options: ['summary', 'disk', 'memory', 'processes', 'network'],
        },
      ];
    case 'BASH':
      return [{ key: 'command', label: 'Exact allowlisted command', multiline: true }];
    case 'WAIT':
      return [{ key: 'durationSeconds', label: 'Wait duration (seconds)', number: true }];
    case 'CONDITION':
      return [
        { key: 'field', label: 'Incident field' },
        {
          key: 'operator',
          label: 'Operator',
          options: [
            'EQUALS',
            'NOT_EQUALS',
            'CONTAINS',
            'STARTS_WITH',
            'IN',
            'NOT_IN',
            'EXISTS',
            'NOT_EXISTS',
          ],
        },
        { key: 'value', label: 'Match value (comma-separated for IN / NOT_IN)' },
      ];
    default:
      return [];
  }
}

export default function RunbookBuilder({
  initialDefinition,
  initialInputs,
  action,
  readOnly = false,
}: {
  initialDefinition: RunbookDefinition;
  initialInputs: RunbookInputInput[];
  action: RunbookFormAction;
  readOnly?: boolean;
}) {
  const [definition, setDefinition] = useState(initialDefinition);
  // Keep editor identity independent of editable keys and list positions.
  const [stepIdentities, setStepIdentities] = useState(
    initialDefinition.steps.map(step => step.key)
  );
  const [inputs, setInputs] = useState(initialInputs);
  const [stepType, setStepType] = useState<RunbookStepType>('MANUAL');
  const [dirty, setDirty] = useState(false);
  const [advancedDefinition, setAdvancedDefinition] = useState(
    JSON.stringify(initialDefinition, null, 2)
  );
  const [advancedInputs, setAdvancedInputs] = useState(JSON.stringify(initialInputs, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [unappliedJson, setUnappliedJson] = useState(false);
  function changeStep(index: number, patch: Partial<RunbookStepDefinition>) {
    setDirty(true);
    setDefinition(current => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step
      ),
    }));
  }
  function move(index: number, offset: number) {
    const steps = [...definition.steps];
    const item = steps.splice(index, 1)[0];
    if (!item) return;
    steps.splice(index + offset, 0, item);
    const identities = [...stepIdentities];
    const identity = identities.splice(index, 1)[0];
    identities.splice(index + offset, 0, identity);
    setStepIdentities(identities);
    setDefinition({ ...definition, steps });
    setDirty(true);
  }
  const builder = (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
        Steps execute in order. Non-idempotent actions require approval; Agent policy and server
        validation remain authoritative.
      </div>
      <ol aria-label="Runbook steps" className="space-y-0">
        {definition.steps.map((step, index) => (
          <li
            key={stepIdentities.at(index)}
            className="relative ml-3 border-l-2 border-border pb-5 pl-6 last:border-transparent"
          >
            <span className="absolute -left-3 top-5 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-xs font-semibold">
              {index + 1}
            </span>
            <div className="rounded-xl border bg-card p-4 shadow-2xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{step.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {step.type.replaceAll('_', ' ')} · {step.key}
                  </p>
                </div>
                <Badge variant={step.riskClass === 'READ_ONLY' ? 'secondary' : 'warning'}>
                  {step.riskClass === 'NON_IDEMPOTENT' || step.requiresApproval
                    ? 'Approval required'
                    : step.riskClass.replaceAll('_', ' ')}
                </Badge>
              </div>
              {step.description && (
                <p className="mt-3 break-words text-sm text-muted-foreground">{step.description}</p>
              )}
              {(step.precheck || step.verification) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Includes nested checks. Preserved during editing; inspect them in Advanced.
                </p>
              )}
              {!readOnly && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <ConfigureSheet
                    title={`Configure ${step.name}`}
                    description="Changes remain local until you save the draft."
                    trigger={
                      <Button type="button" size="sm" variant="outline">
                        <Settings2 className="h-4 w-4" />
                        Configure step
                      </Button>
                    }
                  >
                    <div className="space-y-4">
                      <Field label="Name">
                        <Input
                          aria-label="Step name"
                          value={step.name}
                          maxLength={200}
                          onChange={event => changeStep(index, { name: event.target.value })}
                        />
                      </Field>
                      <Field label="Step key">
                        <Input
                          aria-label="Step key"
                          value={step.key}
                          onChange={event => changeStep(index, { key: event.target.value })}
                        />
                      </Field>
                      <Field label="Description / responder instructions">
                        <Textarea
                          aria-label="Step description"
                          value={step.description ?? ''}
                          onChange={event => changeStep(index, { description: event.target.value })}
                        />
                      </Field>
                      {fieldsFor(step.type).map(field => {
                        if (step.type === 'CONDITION' && field.key === 'field') {
                          return (
                            <Field key={field.key} label="Condition field">
                              <FormSelect
                                name={`condition-field-${index}`}
                                label="Condition field"
                                value={canonicalConditionField(String(step.config.field ?? ''))}
                                onValueChange={value =>
                                  changeStep(index, { config: { ...step.config, field: value } })
                                }
                                options={[
                                  ...CONDITION_FIELDS,
                                  ...inputs.map(input => ({
                                    value: `input.${input.key}`,
                                    label: `Input → ${input.label} (${input.key})`,
                                  })),
                                ]}
                              />
                              <p className="text-xs text-muted-foreground">
                                A false condition skips all remaining pending steps.
                                Incident/service fields are unavailable when execution has no
                                corresponding resource.
                              </p>
                            </Field>
                          );
                        }
                        const raw = Object.entries(step.config).find(
                          ([key]) => key === field.key
                        )?.[1];
                        const value =
                          raw === undefined
                            ? ''
                            : Array.isArray(raw)
                              ? raw.join(', ')
                              : typeof raw === 'object'
                                ? JSON.stringify(raw)
                                : String(raw);
                        const update = (next: string) => {
                          const config = {
                            ...step.config,
                            [field.key]: field.number ? Number(next) : next,
                          };
                          if (step.type === 'CONDITION') {
                            if (['IN', 'NOT_IN'].includes(String(config.operator))) {
                              config.value = String(
                                field.key === 'value' ? next : (step.config.value ?? '')
                              )
                                .split(',')
                                .map(value => value.trim())
                                .filter(Boolean);
                            } else if (['EXISTS', 'NOT_EXISTS'].includes(String(config.operator))) {
                              config.value = null;
                            }
                          }
                          const updated = { ...step, config };
                          const minimumRisk = builderRisk(updated);
                          const ranks = new Map([
                            ['READ_ONLY', 0],
                            ['IDEMPOTENT_WRITE', 1],
                            ['NON_IDEMPOTENT', 2],
                          ]);
                          const riskClass =
                            ranks.get(step.riskClass)! > ranks.get(minimumRisk)!
                              ? step.riskClass
                              : minimumRisk;
                          changeStep(index, {
                            config,
                            riskClass,
                            requiresApproval:
                              riskClass === 'NON_IDEMPOTENT' || step.requiresApproval,
                          });
                        };
                        return (
                          <Field key={field.key} label={field.label}>
                            {field.options ? (
                              <FormSelect
                                name={`config-${field.key}`}
                                label={field.label}
                                value={value}
                                onValueChange={update}
                                options={field.options.map(option => ({
                                  value: option,
                                  label: option,
                                }))}
                              />
                            ) : field.multiline ? (
                              <Textarea
                                aria-label={field.label}
                                value={value}
                                onChange={event => update(event.target.value)}
                                className="font-mono text-xs"
                              />
                            ) : (
                              <Input
                                aria-label={field.label}
                                value={value}
                                type={field.number ? 'number' : 'text'}
                                min={field.number ? 0 : undefined}
                                onChange={event => update(event.target.value)}
                              />
                            )}
                          </Field>
                        );
                      })}
                      <Field label="Timeout (seconds)">
                        <Input
                          aria-label="Step timeout"
                          type="number"
                          min={1}
                          max={86400}
                          value={step.timeoutSeconds ?? 300}
                          onChange={event =>
                            changeStep(index, { timeoutSeconds: Number(event.target.value) })
                          }
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={step.requiresApproval || step.riskClass === 'NON_IDEMPOTENT'}
                          disabled={step.riskClass === 'NON_IDEMPOTENT'}
                          onChange={event =>
                            changeStep(index, { requiresApproval: event.target.checked })
                          }
                        />
                        Require explicit approval
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Use {'${{ inputs.key }}'} for typed input references. Keep credentials in
                        scoped secrets, not command text or headers.
                      </p>
                    </div>
                  </ConfigureSheet>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${step.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${step.name} down`}
                    disabled={index === definition.steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${step.name}`}
                    disabled={definition.steps.length === 1}
                    onClick={() => {
                      setStepIdentities(stepIdentities.filter((_, position) => position !== index));
                      setDefinition({
                        ...definition,
                        steps: definition.steps.filter((_, position) => position !== index),
                      });
                      setDirty(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:w-64">
            <FormSelect
              name="newStepType"
              label="New step type"
              value={stepType}
              onValueChange={value => setStepType(value as RunbookStepType)}
              options={RUNBOOK_STEP_TYPES.map(type => ({
                value: type,
                label: type.replaceAll('_', ' '),
              }))}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              let sequence = definition.steps.length + 1;
              while (definition.steps.some(step => step.key === `step_${sequence}`)) sequence++;
              setStepIdentities([...stepIdentities, crypto.randomUUID()]);
              setDefinition({
                ...definition,
                steps: [...definition.steps, newBuilderStep(stepType, `step_${sequence}`)],
              });
              setDirty(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add step
          </Button>
        </div>
      )}
    </div>
  );
  const inputEditor = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define reusable parameters. SECRET_REF inputs contain secret references, never plaintext
        values.
      </p>
      {inputs.map((input, index) => {
        const update = (patch: Partial<RunbookInputInput>) => {
          setInputs(current =>
            current.map((item, position) => (position === index ? { ...item, ...patch } : item))
          );
          setDirty(true);
        };
        return (
          <fieldset
            key={index}
            disabled={readOnly}
            className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
          >
            <legend className="px-2 text-sm font-semibold">Input {index + 1}</legend>
            <Field label="Key">
              <Input
                aria-label={`Input ${index + 1} key`}
                value={input.key}
                onChange={event => update({ key: event.target.value })}
              />
            </Field>
            <Field label="Label">
              <Input
                aria-label={`Input ${index + 1} label`}
                value={input.label}
                onChange={event => update({ label: event.target.value })}
              />
            </Field>
            <Field label="Type">
              <FormSelect
                name={`inputType-${index}`}
                label={`Input ${index + 1} type`}
                value={input.type}
                onValueChange={value => update({ type: value as RunbookInputInput['type'] })}
                options={RUNBOOK_INPUT_TYPES.map(type => ({
                  value: type,
                  label: type.replaceAll('_', ' '),
                }))}
                disabled={readOnly}
              />
            </Field>
            <Field label="Default value / secret reference">
              <Input
                aria-label={`Input ${index + 1} default`}
                value={input.defaultValue ?? ''}
                onChange={event => update({ defaultValue: event.target.value || undefined })}
              />
            </Field>
            <Field label="Help text">
              <Input
                aria-label={`Input ${index + 1} help`}
                value={input.description}
                onChange={event => update({ description: event.target.value })}
              />
            </Field>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={input.required}
                  onChange={event => update({ required: event.target.checked })}
                />
                Required
              </label>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove input ${index + 1}`}
                  onClick={() => {
                    setInputs(inputs.filter((_, position) => position !== index));
                    setDirty(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}
      {inputs.length === 0 && (
        <EmptyState
          title="No inputs defined"
          description="Add typed parameters to reuse this workflow across services."
          size="sm"
        />
      )}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setInputs([
              ...inputs,
              {
                key: `input_${inputs.length + 1}`,
                label: 'New input',
                type: 'STRING',
                required: false,
                description: '',
                sequence: inputs.length,
              },
            ]);
            setDirty(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add input
        </Button>
      )}
    </div>
  );
  const advanced = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Advanced editing includes nested prechecks, verification and additional configuration. Apply
        JSON before saving. Refresh from the builder before editing to avoid replacing newer
        changes.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setAdvancedDefinition(JSON.stringify(definition, null, 2));
          setAdvancedInputs(JSON.stringify(inputs, null, 2));
          setJsonError('');
          setUnappliedJson(false);
        }}
      >
        Refresh JSON from builder
      </Button>
      <Field label="Definition JSON">
        <Textarea
          aria-label="Definition JSON"
          value={advancedDefinition}
          onChange={event => {
            setAdvancedDefinition(event.target.value);
            setUnappliedJson(true);
          }}
          readOnly={readOnly}
          className="min-h-72 font-mono text-xs"
          spellCheck={false}
        />
      </Field>
      <Field label="Typed inputs JSON">
        <Textarea
          aria-label="Typed inputs JSON"
          value={advancedInputs}
          onChange={event => {
            setAdvancedInputs(event.target.value);
            setUnappliedJson(true);
          }}
          readOnly={readOnly}
          className="min-h-40 font-mono text-xs"
          spellCheck={false}
        />
      </Field>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            try {
              const parsedDefinition = runbookDefinitionSchema.parse(
                JSON.parse(advancedDefinition)
              );
              const parsedInputs = runbookInputsSchema.parse(JSON.parse(advancedInputs));
              setDefinition(parsedDefinition as RunbookDefinition);
              setStepIdentities(parsedDefinition.steps.map(() => crypto.randomUUID()));
              setInputs(parsedInputs);
              setDirty(true);
              setJsonError('');
              setUnappliedJson(false);
            } catch {
              setJsonError(
                'Invalid definition or inputs. Check JSON syntax, unique keys and supported fields.'
              );
            }
          }}
        >
          Apply JSON to builder
        </Button>
      )}
      {jsonError && (
        <p role="alert" className="text-sm text-destructive">
          {jsonError}
        </p>
      )}
    </div>
  );
  return (
    <ActionForm action={action} className="space-y-6" onSuccess={() => setDirty(false)}>
      <input type="hidden" name="definition" value={JSON.stringify(definition)} />
      <input
        type="hidden"
        name="inputs"
        value={JSON.stringify(inputs.map((input, sequence) => ({ ...input, sequence })))}
      />
      <DetailTabs
        urlParamName="editor"
        tabs={[
          {
            id: 'builder',
            label: 'Builder',
            icon: <ListOrdered className="h-4 w-4" />,
            content: builder,
          },
          { id: 'inputs', label: 'Inputs', count: inputs.length, content: inputEditor },
          {
            id: 'advanced',
            label: 'Advanced · Edit JSON',
            icon: <Code2 className="h-4 w-4" />,
            content: advanced,
          },
        ]}
      />
      {unappliedJson && !readOnly && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          Advanced JSON has unapplied changes. Apply JSON to the builder before saving, or refresh
          JSON from the builder to discard those edits.
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <SubmitButton pendingLabel="Saving draft…" disabled={unappliedJson}>
            <ShieldCheck className="h-4 w-4" />
            Save draft
          </SubmitButton>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {dirty ? 'Unsaved changes' : 'Saved draft'}
          </span>
        </div>
      )}
    </ActionForm>
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
