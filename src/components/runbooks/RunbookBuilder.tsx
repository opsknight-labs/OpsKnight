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
import { Badge } from '@/components/ui/shadcn/badge';
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
import { cloneStepRecursively, newBuilderStep } from '@/lib/runbooks/builder';
import { flattenSteps } from '@/lib/runbooks/definition';
import {
  ActionForm,
  FormSelect,
  SubmitButton,
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
  const [stepIdentities, setStepIdentities] = useState<string[]>(() =>
    initialDefinition.steps.map(() => crypto.randomUUID())
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [inputs, setInputs] = useState(initialInputs);
  const [inputIdentities, setInputIdentities] = useState(() =>
    initialInputs.map(() => crypto.randomUUID())
  );
  const [dirty, setDirty] = useState(false);
  const [advancedDefinition, setAdvancedDefinition] = useState(
    JSON.stringify(initialDefinition, null, 2)
  );
  const [advancedInputs, setAdvancedInputs] = useState(JSON.stringify(initialInputs, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [unappliedJson, setUnappliedJson] = useState(false);

  // Compute live validation results
  const { stepErrors, inputErrors, errorCount } = validateRunbook(definition, inputs);

  // Derive active index and selected step from stable selectedStepId
  const foundIndex = selectedStepId ? stepIdentities.indexOf(selectedStepId) : -1;
  const selectedStepIndex =
    foundIndex >= 0 ? foundIndex : definition.steps.length > 0 ? 0 : 0;
  const selectedStep = definition.steps.at(selectedStepIndex);
  const activeStepId = stepIdentities.at(selectedStepIndex) ?? selectedStep?.key ?? 'active-step';

  function handleSelectStep(index: number) {
    const id = stepIdentities.at(index);
    if (id) {
      setSelectedStepId(id);
    }
  }

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
    const item = nextSteps.splice(index, 1).at(0);
    if (!item) return;
    nextSteps.splice(index + offset, 0, item);

    const nextIdentities = [...stepIdentities];
    const id = nextIdentities.splice(index, 1).at(0);
    if (id) nextIdentities.splice(index + offset, 0, id);

    setStepIdentities(nextIdentities);
    setDefinition({ ...definition, steps: nextSteps });
    // Stable selectedStepId ensures the selected step stays selected regardless of move
    setDirty(true);
  }

  function duplicateStep(index: number) {
    const source = definition.steps.at(index);
    if (!source) return;
    const existingKeys = new Set(flattenSteps(definition).map(step => step.key));
    const clone = cloneStepRecursively(source, existingKeys);

    const nextSteps = [...definition.steps];
    nextSteps.splice(index + 1, 0, clone);
    const newId = crypto.randomUUID();
    const nextIds = [...stepIdentities];
    nextIds.splice(index + 1, 0, newId);

    setDefinition({ ...definition, steps: nextSteps });
    setStepIdentities(nextIds);
    setSelectedStepId(newId);
    setDirty(true);
  }

  function removeStep(index: number) {
    if (definition.steps.length <= 1) return;
    const removedId = stepIdentities.at(index);
    const currentlySelectedId = selectedStepId ?? stepIdentities.at(selectedStepIndex);

    const nextSteps = definition.steps.filter((_, position) => position !== index);
    const nextIds = stepIdentities.filter((_, position) => position !== index);

    setDefinition({ ...definition, steps: nextSteps });
    setStepIdentities(nextIds);

    if (removedId === currentlySelectedId) {
      const nextIndex = Math.min(index, nextSteps.length - 1);
      setSelectedStepId(nextIds.at(nextIndex) ?? null);
    } else {
      setSelectedStepId(currentlySelectedId ?? null);
    }
    setDirty(true);
  }

  function addStep(type: RunbookStepType) {
    const allKeys = new Set(flattenSteps(definition).map(step => step.key));
    let sequence = definition.steps.length + 1;
    while (allKeys.has(`step_${sequence}`)) {
      sequence++;
    }
    const key = `step_${sequence}`;
    const newStep = newBuilderStep(type, key);
    const newId = crypto.randomUUID();
    setDefinition({ ...definition, steps: [...definition.steps, newStep] });
    setStepIdentities([...stepIdentities, newId]);
    setSelectedStepId(newId);
    setDirty(true);
  }

  const builderView = (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/20 p-3 sm:p-4 text-xs text-muted-foreground hidden sm:flex flex-wrap items-center justify-between gap-3">
        <span>
          Steps execute in strict top-to-bottom sequence. Mutations require explicit approval or non-idempotent safeguards. Agent policy remains authoritative.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column: Step navigator */}
        <div className="lg:col-span-5 xl:col-span-4 min-w-0">
          <StepNavigator
            steps={definition.steps}
            stepIdentities={stepIdentities}
            selectedIndex={selectedStepIndex}
            stepErrors={stepErrors}
            readOnly={readOnly}
            onSelectStep={handleSelectStep}
            onMoveStep={moveStep}
            onDuplicateStep={duplicateStep}
            onRemoveStep={removeStep}
            onAddStep={addStep}
          />
        </div>

        {/* Right column: Active step editor */}
        <div className="lg:col-span-7 xl:col-span-8 min-w-0">
          {selectedStep ? (
            <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-2xs space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Step {selectedStepIndex + 1}: {selectedStep.name || 'Untitled step'}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    Key: {selectedStep.key} · Type: {selectedStep.type.replaceAll('_', ' ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedStep.riskClass === 'NON_IDEMPOTENT' ? (
                    <Badge variant="destructive" className="text-xs">
                      MUTATION
                    </Badge>
                  ) : selectedStep.riskClass === 'IDEMPOTENT_WRITE' ? (
                    <Badge variant="warning" className="text-xs">
                      WRITE
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      READ ONLY
                    </Badge>
                  )}
                </div>
              </div>

              <StepEditor
                key={activeStepId}
                step={selectedStep}
                inputs={inputs}
                editorId={activeStepId}
                depth={1}
                errors={stepErrors.get(selectedStepIndex) ?? {}}
                readOnly={readOnly}
                onChange={patch => updateStep(selectedStepIndex, patch)}
              />
            </div>
          ) : (
            <EmptyState
              title="No step selected"
              description="Select a step from the navigator to configure its actions, prechecks, and verification."
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
        const currentErrors = inputErrors.get(index);
        return (
          <fieldset
            key={inputIdentities.at(index) ?? index}
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
                className={currentErrors?.key ? 'border-destructive' : ''}
              />
              {currentErrors?.key && (
                <p className="text-xs text-destructive">{currentErrors.key}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                aria-label={`Input ${index + 1} label`}
                value={input.label}
                disabled={readOnly}
                onChange={e => update({ label: e.target.value })}
                className={currentErrors?.label ? 'border-destructive' : ''}
              />
              {currentErrors?.label && (
                <p className="text-xs text-destructive">{currentErrors.label}</p>
              )}
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
                    setInputIdentities(inputIdentities.filter((_, position) => position !== index));
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
            setInputIdentities([...inputIdentities, crypto.randomUUID()]);
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
              const newIds = parsedDefinition.steps.map(() => crypto.randomUUID());
              setStepIdentities(newIds);
              setSelectedStepId(newIds.at(0) ?? null);
              setInputs(parsedInputs);
              setInputIdentities(parsedInputs.map(() => crypto.randomUUID()));
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
