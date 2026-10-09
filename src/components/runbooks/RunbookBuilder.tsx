'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Copy,
  ListOrdered,
  Plus,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
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
  RUNBOOK_INPUT_TYPES,
  RUNBOOK_STEP_TYPES,
  type RunbookDefinition,
  type RunbookStepDefinition,
  type RunbookStepType,
} from '@/lib/runbooks/types';
import {
  runbookDefinitionSchema,
  runbookInputsSchema,
  type RunbookInputInput,
} from '@/lib/runbooks/schemas';
import { newBuilderStep } from '@/lib/runbooks/builder';
import {
  ActionForm,
  ConfigureSheet,
  FormSelect,
  SubmitButton,
  type RunbookFormAction,
} from './RunbookControls';

import StepEditor from './builder/StepEditor';
import ReadinessBar from './builder/ReadinessBar';
import { validateRunbook } from './builder/validation';

export default function RunbookBuilder({
  initialDefinition,
  initialInputs,
  initialDraftRevision = 0,
  action,
  readOnly = false,
}: {
  initialDefinition: RunbookDefinition;
  initialInputs: RunbookInputInput[];
  initialDraftRevision?: number;
  action: RunbookFormAction;
  readOnly?: boolean;
}) {
  const [definition, setDefinition] = useState(initialDefinition);
  const [draftRevision, setDraftRevision] = useState(initialDraftRevision);
  const [stepIdentities, setStepIdentities] = useState(
    initialDefinition.steps.map(step => step.key || crypto.randomUUID())
  );
  const [stepType, setStepType] = useState<RunbookStepType>('MANUAL');
  const [inputs, setInputs] = useState(initialInputs);
  const [dirty, setDirty] = useState(false);
  const [advancedDefinition, setAdvancedDefinition] = useState(
    JSON.stringify(initialDefinition, null, 2)
  );
  const [advancedInputs, setAdvancedInputs] = useState(JSON.stringify(initialInputs, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [unappliedJson, setUnappliedJson] = useState(false);

  // Compute live validation results
  const { stepErrors, errorCount } = validateRunbook(definition, inputs);

  function updateStep(index: number, patch: Partial<RunbookStepDefinition>) {
    setDirty(true);
    setDefinition(current => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step
      ),
    }));
  }

  function moveStep(index: number, offset: number) {
    const nextSteps = [...definition.steps];
    const item = nextSteps.splice(index, 1)[0];
    if (!item) return;
    nextSteps.splice(index + offset, 0, item);

    const nextIdentities = [...stepIdentities];
    const id = nextIdentities.splice(index, 1)[0];
    nextIdentities.splice(index + offset, 0, id);

    setStepIdentities(nextIdentities);
    setDefinition({ ...definition, steps: nextSteps });
    setDirty(true);
  }

  function duplicateStep(index: number) {
    const source = definition.steps[index];
    if (!source) return;
    let sequence = definition.steps.length + 1;
    while (definition.steps.some(step => step.key === `${source.key}_copy_${sequence}`)) {
      sequence++;
    }
    const clonedKey = `${source.key}_copy_${sequence}`;
    const clone: RunbookStepDefinition = {
      ...JSON.parse(JSON.stringify(source)),
      key: clonedKey,
      name: `${source.name} (Copy)`,
    };

    const nextSteps = [...definition.steps];
    nextSteps.splice(index + 1, 0, clone);
    const nextIds = [...stepIdentities];
    nextIds.splice(index + 1, 0, crypto.randomUUID());

    setDefinition({ ...definition, steps: nextSteps });
    setStepIdentities(nextIds);
    setDirty(true);
  }

  function removeStep(index: number) {
    if (definition.steps.length <= 1) return;
    const nextSteps = definition.steps.filter((_, position) => position !== index);
    const nextIds = stepIdentities.filter((_, position) => position !== index);
    setDefinition({ ...definition, steps: nextSteps });
    setStepIdentities(nextIds);
    setDirty(true);
  }

  function addStep(type: RunbookStepType) {
    let sequence = definition.steps.length + 1;
    while (definition.steps.some(step => step.key === `step_${sequence}`)) {
      sequence++;
    }
    const key = `step_${sequence}`;
    const newStep = newBuilderStep(type, key);
    setDefinition({ ...definition, steps: [...definition.steps, newStep] });
    setStepIdentities([...stepIdentities, crypto.randomUUID()]);
    setDirty(true);
  }

  const builderView = (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
        <span>
          Steps execute in strict top-to-bottom sequence. Mutations require explicit approval or non-idempotent safeguards. Agent policy remains authoritative.
        </span>
      </div>

      <ol aria-label="Runbook steps" className="space-y-0">
        {definition.steps.map((step, index) => {
          const errors = stepErrors.get(index);
          const hasErrors = errors && Object.keys(errors).length > 0;
          const isApprovalRequired =
            step.riskClass === 'NON_IDEMPOTENT' || step.requiresApproval || step.type === 'APPROVAL';

          return (
            <li
              key={stepIdentities[index] ?? step.key}
              className="relative ml-3 border-l-2 border-border pb-5 pl-6 last:border-transparent"
            >
              <span
                className={`absolute -left-3 top-5 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                  hasErrors ? 'border-destructive bg-destructive/10 text-destructive' : 'bg-background'
                }`}
              >
                {index + 1}
              </span>

              <div className="rounded-xl border bg-card p-4 shadow-2xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground">{step.name || 'Untitled step'}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {step.type.replaceAll('_', ' ')} · {step.key}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {step.riskClass === 'NON_IDEMPOTENT' ? (
                      <Badge variant="destructive" className="text-xs">
                        MUTATION
                      </Badge>
                    ) : step.riskClass === 'IDEMPOTENT_WRITE' ? (
                      <Badge variant="warning" className="text-xs">
                        WRITE
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        READ ONLY
                      </Badge>
                    )}

                    {isApprovalRequired && (
                      <Badge variant="warning" className="text-xs flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" />
                        Approval required
                      </Badge>
                    )}

                    {hasErrors && (
                      <Badge variant="destructive" className="text-xs flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {Object.keys(errors).length} issues
                      </Badge>
                    )}
                  </div>
                </div>

                {step.description && (
                  <p className="mt-3 break-words text-sm text-muted-foreground">{step.description}</p>
                )}

                {(step.precheck || step.verification) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Before: {step.precheck?.steps.map(check => check.name).join(' → ') || 'None'}
                    {' · '}After:{' '}
                    {step.verification?.steps.map(check => check.name).join(' → ') || 'None'}
                  </p>
                )}

                {!readOnly && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ConfigureSheet
                      title={`Configure ${step.name}`}
                      description="Changes remain local until you save the draft."
                      trigger={
                        <Button type="button" size="sm" variant="outline">
                          <Settings2 className="h-4 w-4 mr-1.5" />
                          Configure step
                        </Button>
                      }
                    >
                      <StepEditor
                        step={step}
                        inputs={inputs}
                        editorId={String(stepIdentities[index] ?? step.key)}
                        depth={1}
                        errors={errors ?? {}}
                        readOnly={readOnly}
                        onChange={patch => updateStep(index, patch)}
                      />
                    </ConfigureSheet>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${step.name} up`}
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${step.name} down`}
                      disabled={index === definition.steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Duplicate ${step.name}`}
                      onClick={() => duplicateStep(index)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${step.name}`}
                      disabled={definition.steps.length === 1}
                      onClick={() => removeStep(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
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
          <Button type="button" variant="outline" onClick={() => addStep(stepType)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add step
          </Button>
        </div>
      )}

      {/* Sticky Bottom Readiness Bar */}
      <ReadinessBar
        definition={definition}
        errorCount={errorCount}
        dirty={dirty}
        unappliedJson={unappliedJson}
        readOnly={readOnly}
        draftRevision={draftRevision}
      />
    </div>
  );

  const inputEditor = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define reusable parameters for this runbook. Parameters can be bound to services, passed at manual launch, or evaluated from incident metadata.
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
            key={input.key || index}
            disabled={readOnly}
            className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 bg-card"
          >
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parameter {index + 1}: {input.label || input.key}
            </legend>
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input
                aria-label={`Input ${index + 1} key`}
                value={input.key}
                disabled={readOnly}
                onChange={e => update({ key: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                aria-label={`Input ${index + 1} label`}
                value={input.label}
                disabled={readOnly}
                onChange={e => update({ label: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <FormSelect
                name={`inputType-${index}`}
                label={`Input ${index + 1} type`}
                value={input.type}
                disabled={readOnly}
                onValueChange={v => update({ type: v as RunbookInputInput['type'] })}
                options={RUNBOOK_INPUT_TYPES.map(t => ({
                  value: t,
                  label: t.replaceAll('_', ' '),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default value / secret reference</Label>
              <Input
                aria-label={`Input ${index + 1} default`}
                value={input.defaultValue ?? ''}
                disabled={readOnly}
                onChange={e => update({ defaultValue: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Help text</Label>
              <Input
                aria-label={`Input ${index + 1} help`}
                value={input.description}
                disabled={readOnly}
                onChange={e => update({ description: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between sm:col-span-2 pt-2 border-t">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={input.required}
                  disabled={readOnly}
                  onChange={e => update({ required: e.target.checked })}
                />
                Required parameter
              </label>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove input ${index + 1}`}
                  className="text-xs text-destructive hover:text-destructive h-7"
                  onClick={() => {
                    setInputs(inputs.filter((_, position) => position !== index));
                    setDirty(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove parameter
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}

      {inputs.length === 0 && (
        <EmptyState
          title="No inputs defined"
          description="Add typed parameters to reuse this workflow across multiple environments or incidents."
          size="sm"
        />
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs font-semibold"
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
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add input
        </Button>
      )}
    </div>
  );

  const advanced = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Advanced JSON editing remains compatible with all builder checks. Apply JSON to synchronize
        with the builder before saving draft.
      </p>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => {
          setAdvancedDefinition(JSON.stringify(definition, null, 2));
          setAdvancedInputs(JSON.stringify(inputs, null, 2));
          setJsonError('');
          setUnappliedJson(false);
        }}
      >
        Refresh JSON from builder
      </Button>

      <div className="space-y-1.5">
        <Label>Definition JSON</Label>
        <Textarea
          aria-label="Definition JSON"
          value={advancedDefinition}
          onChange={e => {
            setAdvancedDefinition(e.target.value);
            setUnappliedJson(true);
          }}
          readOnly={readOnly}
          className="min-h-72 font-mono text-xs"
          spellCheck={false}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Typed inputs JSON</Label>
        <Textarea
          aria-label="Typed inputs JSON"
          value={advancedInputs}
          onChange={e => {
            setAdvancedInputs(e.target.value);
            setUnappliedJson(true);
          }}
          readOnly={readOnly}
          className="min-h-40 font-mono text-xs"
          spellCheck={false}
        />
      </div>

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs font-semibold"
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
        <p role="alert" className="text-sm text-destructive font-medium">
          {jsonError}
        </p>
      )}
    </div>
  );

  return (
    <ActionForm
      action={action}
      className="space-y-6"
      onSuccess={result => {
        setDirty(false);
        if (typeof result?.draftRevision === 'number') {
          setDraftRevision(result.draftRevision);
        }
      }}
    >
      <input type="hidden" name="draftRevision" value={draftRevision} />
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
            content: builderView,
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
          <span aria-live="polite" className="text-xs text-muted-foreground font-medium">
            {dirty ? 'Unsaved changes' : 'Saved draft'}
          </span>
        </div>
      )}
    </ActionForm>
  );
}
