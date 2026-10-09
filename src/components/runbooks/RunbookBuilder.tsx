'use client';

import { useState } from 'react';
import {
  Code2,
  ListOrdered,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import DetailTabs from '@/components/ui/DetailTabs';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
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
import { newBuilderStep } from '@/lib/runbooks/builder';
import {
  ActionForm,
  FormSelect,
  type RunbookFormAction,
} from './RunbookControls';

import StepNavigator from './builder/StepNavigator';
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
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  // Ensure selectedIndex is always within bounds
  const activeIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, definition.steps.length - 1));
  const activeStep = definition.steps[activeIndex];

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
    setSelectedIndex(index + offset);
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
    setSelectedIndex(index + 1);
    setDirty(true);
  }

  function removeStep(index: number) {
    if (definition.steps.length <= 1) return;
    const nextSteps = definition.steps.filter((_, position) => position !== index);
    const nextIds = stepIdentities.filter((_, position) => position !== index);
    setDefinition({ ...definition, steps: nextSteps });
    setStepIdentities(nextIds);
    setSelectedIndex(Math.max(0, index - 1));
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
    setSelectedIndex(definition.steps.length);
    setDirty(true);
  }

  const builderView = (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
        <span>
          Steps execute in strict top-to-bottom sequence. Mutations require explicit approval or non-idempotent safeguards. Agent policy remains authoritative.
        </span>
        {activeStep && (activeStep.precheck || activeStep.verification) && (
          <span className="font-mono text-[11px] text-foreground">
            Before: {activeStep.precheck?.steps.map(c => c.name).join(' → ') || 'None'}
            {' · '}After: {activeStep.verification?.steps.map(c => c.name).join(' → ') || 'None'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Persistent Workflow Navigator */}
        <div className="lg:col-span-4 xl:col-span-3">
          <StepNavigator
            steps={definition.steps}
            stepIdentities={stepIdentities}
            selectedIndex={activeIndex}
            stepErrors={stepErrors}
            readOnly={readOnly}
            onSelectStep={setSelectedIndex}
            onMoveStep={moveStep}
            onDuplicateStep={duplicateStep}
            onRemoveStep={removeStep}
            onAddStep={addStep}
          />
        </div>

        {/* Right / Main Column: Active Step Editor */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-6">
          {activeStep ? (
            <StepEditor
              key={stepIdentities[activeIndex] ?? activeStep.key}
              step={activeStep}
              inputs={inputs}
              editorId={String(stepIdentities[activeIndex] ?? activeStep.key)}
              depth={1}
              errors={stepErrors.get(activeIndex) ?? {}}
              readOnly={readOnly}
              onChange={patch => updateStep(activeIndex, patch)}
            />
          ) : (
            <EmptyState
              title="No step selected"
              description="Select a step from the workflow navigator or add a new step."
            />
          )}
        </div>
      </div>

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
                onChange={event => update({ key: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                aria-label={`Input ${index + 1} label`}
                value={input.label}
                disabled={readOnly}
                onChange={event => update({ label: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label>Default value / secret reference</Label>
              <Input
                aria-label={`Input ${index + 1} default`}
                value={input.defaultValue ?? ''}
                disabled={readOnly}
                onChange={event => update({ defaultValue: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Help text / description</Label>
              <Input
                aria-label={`Input ${index + 1} help`}
                value={input.description ?? ''}
                disabled={readOnly}
                onChange={event => update({ description: event.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-2 sm:col-span-2 border-t pt-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={input.required}
                  disabled={readOnly}
                  onChange={event => update({ required: event.target.checked })}
                />
                Required parameter
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
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" />
                  Remove
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}
      {inputs.length === 0 && (
        <EmptyState
          title="No parameters defined"
          description="Add typed parameters to reuse this workflow across multiple environments and services."
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
          <Plus className="h-4 w-4 mr-1" />
          Add parameter
        </Button>
      )}
    </div>
  );

  const advanced = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Direct JSON authoring for experienced operators. Sync JSON before saving to apply changes back to the visual builder.
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
        Refresh JSON from visual builder
      </Button>
      <div className="space-y-2">
        <Label>Definition JSON</Label>
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
      </div>
      <div className="space-y-2">
        <Label>Typed inputs JSON</Label>
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
      </div>
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
          Advanced JSON has unapplied edits. Click &quot;Apply JSON to builder&quot; before saving, or refresh to discard.
        </p>
      )}
    </ActionForm>
  );
}
