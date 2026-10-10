'use client';

import { useState } from 'react';
import {
  AlertTriangle,
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
import { flattenSteps, referencedStepInputKeys } from '@/lib/runbooks/definition';
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

export function collectAllReferencedInputKeys(def: RunbookDefinition): Set<string> {
  const referenced = new Set<string>();
  for (const step of flattenSteps(def)) {
    for (const key of referencedStepInputKeys(step)) {
      referenced.add(key);
    }
  }
  return referenced;
}

export function getInputUsage(
  def: RunbookDefinition,
  inputKey: string
): { isReferenced: boolean; stepNames: string[] } {
  if (!inputKey) return { isReferenced: false, stepNames: [] };
  const normalizedKey = inputKey.trim().toLowerCase();
  if (!normalizedKey) return { isReferenced: false, stepNames: [] };
  const stepNames: string[] = [];

  for (const step of flattenSteps(def)) {
    if (referencedStepInputKeys(step).has(normalizedKey)) {
      stepNames.push(step.name || step.key);
    }
  }

  return {
    isReferenced: stepNames.length > 0,
    stepNames,
  };
}

export function getNextUnusedInputKey(
  existingInputs: RunbookInputInput[],
  definition?: RunbookDefinition
): string {
  const existingKeys = new Set(existingInputs.map(i => i.key));
  if (definition) {
    for (const key of collectAllReferencedInputKeys(definition)) {
      existingKeys.add(key);
    }
  }
  let counter = 1;
  while (existingKeys.has(`input_${counter}`)) {
    counter++;
  }
  return `input_${counter}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function refactorInputReference(
  def: RunbookDefinition,
  oldKey: string,
  newKey: string
): RunbookDefinition {
  if (!oldKey || !newKey || oldKey === newKey) return def;

  const escapedOld = escapeRegex(oldKey);
  const oldTemplateRegex = new RegExp(`\\$\\{\\{\\s*inputs\\.${escapedOld}\\s*\\}\\}`, 'g');
  const newTemplate = `\${{ inputs.${newKey} }}`;

  const oldUpper = oldKey.toUpperCase();
  const newUpper = newKey.toUpperCase();
  const escapedOldUpper = escapeRegex(oldUpper);
  const bashWordRegex = new RegExp(`\\bOPSKNIGHT_INPUT_${escapedOldUpper}\\b`, 'g');

  function replaceInStep(step: RunbookStepDefinition): RunbookStepDefinition {
    // 1. Config serialization replacement for embedded templates
    let serialized = JSON.stringify(step.config);
    serialized = serialized.replace(oldTemplateRegex, newTemplate);
    const newConfig: Record<string, unknown> = JSON.parse(serialized);

    // 2. Condition fields: input.oldKey -> input.newKey
    if (step.type === 'CONDITION' && typeof newConfig.field === 'string') {
      if (newConfig.field === `input.${oldKey}`) {
        newConfig.field = `input.${newKey}`;
      } else if (newConfig.field === `inputs.${oldKey}`) {
        newConfig.field = `inputs.${newKey}`;
      }
    }

    // 3. Bash environment references: bare, $, ${}, %
    if (step.type === 'BASH' && typeof newConfig.command === 'string') {
      newConfig.command = newConfig.command.replace(bashWordRegex, `OPSKNIGHT_INPUT_${newUpper}`);
    }

    // 4. Update step name or description if template was used
    const newName = step.name ? step.name.replace(oldTemplateRegex, newTemplate) : step.name;
    const newDesc = step.description
      ? step.description.replace(oldTemplateRegex, newTemplate)
      : step.description;

    const updated: RunbookStepDefinition = {
      ...step,
      name: newName,
      description: newDesc,
      config: newConfig,
    };

    if (updated.precheck?.steps) {
      updated.precheck = {
        ...updated.precheck,
        steps: updated.precheck.steps.map(replaceInStep),
      };
    }
    if (updated.verification?.steps) {
      updated.verification = {
        ...updated.verification,
        steps: updated.verification.steps.map(replaceInStep),
      };
    }
    return updated;
  }

  return {
    ...def,
    steps: def.steps.map(replaceInStep),
  };
}

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
  const [initialIdentities] = useState(() => initialInputs.map(() => crypto.randomUUID()));
  const [inputIdentities, setInputIdentities] = useState<string[]>(initialIdentities);
  const [committedInputKeys, setCommittedInputKeys] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    initialInputs.forEach((inp, idx) => {
      map.set(initialIdentities.at(idx) ?? String(idx), inp.key);
    });
    return map;
  });
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState('builder');
  const [advancedDefinition, setAdvancedDefinition] = useState(
    JSON.stringify(initialDefinition, null, 2)
  );
  const [advancedInputs, setAdvancedInputs] = useState(JSON.stringify(initialInputs, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [unappliedJson, setUnappliedJson] = useState(false);

  // Compute live validation results
  const { stepErrors, inputErrors, generalInputErrors, errorCount } = validateRunbook(
    definition,
    inputs
  );

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

  function handleTabChange(nextTab: string) {
    if (nextTab === 'advanced' && !unappliedJson) {
      setAdvancedDefinition(JSON.stringify(definition, null, 2));
      setAdvancedInputs(JSON.stringify(inputs, null, 2));
      setJsonError('');
    }
    setActiveTab(nextTab);
  }

  function handleNavigateToStep(index: number) {
    handleTabChange('builder');
    handleSelectStep(index);
  }

  function handleNavigateToInputs() {
    handleTabChange('inputs');
  }

  function updateStep(index: number, patch: Partial<RunbookStepDefinition>) {
    setDirty(true);
    const nextDef = {
      ...definition,
      steps: definition.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step
      ),
    };
    setDefinition(nextDef);
    if (!unappliedJson) {
      setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
    }
  }

  function moveStep(index: number, offset: number) {
    const nextSteps = [...definition.steps];
    const item = nextSteps.splice(index, 1).at(0);
    if (!item) return;
    nextSteps.splice(index + offset, 0, item);

    const nextIdentities = [...stepIdentities];
    const id = nextIdentities.splice(index, 1).at(0);
    if (id) nextIdentities.splice(index + offset, 0, id);

    const nextDef = { ...definition, steps: nextSteps };
    setStepIdentities(nextIdentities);
    setDefinition(nextDef);
    if (!unappliedJson) {
      setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
    }
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

    const nextDef = { ...definition, steps: nextSteps };
    setDefinition(nextDef);
    setStepIdentities(nextIds);
    setSelectedStepId(newId);
    if (!unappliedJson) {
      setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
    }
    setDirty(true);
  }

  function removeStep(index: number) {
    if (definition.steps.length <= 1) return;
    const removedId = stepIdentities.at(index);
    const currentlySelectedId = selectedStepId ?? stepIdentities.at(selectedStepIndex);

    const nextSteps = definition.steps.filter((_, position) => position !== index);
    const nextIds = stepIdentities.filter((_, position) => position !== index);

    const nextDef = { ...definition, steps: nextSteps };
    setDefinition(nextDef);
    setStepIdentities(nextIds);

    if (removedId === currentlySelectedId) {
      const nextIndex = Math.min(index, nextSteps.length - 1);
      setSelectedStepId(nextIds.at(nextIndex) ?? null);
    } else {
      setSelectedStepId(currentlySelectedId ?? null);
    }
    if (!unappliedJson) {
      setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
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
    const nextDef = { ...definition, steps: [...definition.steps, newStep] };
    setDefinition(nextDef);
    setStepIdentities([...stepIdentities, newId]);
    setSelectedStepId(newId);
    if (!unappliedJson) {
      setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
    }
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
        stepErrors={stepErrors}
        inputErrors={inputErrors}
        generalInputErrors={generalInputErrors}
        onNavigateToStep={handleNavigateToStep}
        onNavigateToInputs={handleNavigateToInputs}
      />
    </div>
  );

  const inputEditor = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define reusable parameters for this runbook. Parameters can be bound to services, passed at manual launch, or evaluated from incident metadata.
      </p>
      {generalInputErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive space-y-1"
        >
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Parameter configuration issues:
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            {generalInputErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {inputs.map((input, index) => {
        const identity = inputIdentities.at(index) ?? String(index);
        const effectiveKey = committedInputKeys.get(identity) || input.key;
        const usage = getInputUsage(definition, effectiveKey);

        const update = (patch: Partial<RunbookInputInput>) => {
          let nextDef = definition;
          const lastKey = committedInputKeys.get(identity) || input.key;

          if (patch.key !== undefined) {
            const nextKey = patch.key.trim();
            if (nextKey !== '' && /^[a-z0-9_]+$/.test(nextKey)) {
              if (lastKey && lastKey !== nextKey) {
                nextDef = refactorInputReference(definition, lastKey, nextKey);
                setDefinition(nextDef);
                setCommittedInputKeys(prev => new Map(prev).set(identity, nextKey));
              }
            }
          }

          const nextInputs = inputs.map((item, position) =>
            position === index ? { ...item, ...patch } : item
          );
          setInputs(nextInputs);
          if (!unappliedJson) {
            setAdvancedDefinition(JSON.stringify(nextDef, null, 2));
            setAdvancedInputs(JSON.stringify(nextInputs, null, 2));
          }
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
                  disabled={usage.isReferenced}
                  title={
                    usage.isReferenced
                      ? `Cannot remove parameter while referenced by: ${usage.stepNames.join(', ')}`
                      : undefined
                  }
                  className={`text-xs h-7 ${
                    usage.isReferenced
                      ? 'text-muted-foreground cursor-not-allowed opacity-50'
                      : 'text-destructive hover:text-destructive'
                  }`}
                  onClick={() => {
                    if (usage.isReferenced) return;
                    setCommittedInputKeys(prev => {
                      const next = new Map(prev);
                      next.delete(identity);
                      return next;
                    });
                    const nextInputs = inputs.filter((_, position) => position !== index);
                    setInputs(nextInputs);
                    setInputIdentities(inputIdentities.filter((_, position) => position !== index));
                    if (!unappliedJson) {
                      setAdvancedInputs(JSON.stringify(nextInputs, null, 2));
                    }
                    setDirty(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove parameter
                </Button>
              )}
            </div>
            {usage.isReferenced && (
              <div
                role="status"
                className="sm:col-span-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2 flex items-center gap-1.5"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>
                  Referenced by <strong>{usage.stepNames.join(', ')}</strong>. Remove references from those steps before deleting this parameter.
                </span>
              </div>
            )}
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
            const nextKey = getNextUnusedInputKey(inputs, definition);
            const newId = crypto.randomUUID();
            setCommittedInputKeys(prev => new Map(prev).set(newId, nextKey));
            const nextInputs = [
              ...inputs,
              {
                key: nextKey,
                label: 'New input',
                type: 'STRING' as const,
                required: false,
                description: '',
                sequence: inputs.length,
              },
            ];
            setInputs(nextInputs);
            setInputIdentities([...inputIdentities, newId]);
            if (!unappliedJson) {
              setAdvancedInputs(JSON.stringify(nextInputs, null, 2));
            }
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

      {unappliedJson && dirty && (
        <div
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground space-y-1"
        >
          <p className="font-semibold text-foreground">
            Conflict Warning: Visual Builder and JSON Editor Both Have Modifications
          </p>
          <p>
            You have unapplied edits in the JSON editor and modifications in the visual builder.
            Click <strong>Apply JSON to builder</strong> to overwrite visual edits with the JSON above,
            or click <strong>Refresh JSON from builder</strong> to discard unapplied JSON edits.
          </p>
        </div>
      )}

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
              const newInputIds = parsedInputs.map(() => crypto.randomUUID());
              setInputIdentities(newInputIds);
              const newCommitted = new Map<string, string>();
              parsedInputs.forEach((inp, idx) => {
                const id = newInputIds.at(idx);
                if (id) newCommitted.set(id, inp.key);
              });
              setCommittedInputKeys(newCommitted);
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
        activeTab={activeTab}
        onTabChange={handleTabChange}
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
