'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Code2,
  ListChecks,
  ListOrdered,
  Lock,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import DetailTabs from '@/components/ui/DetailTabs';
import { registerNavigationGuard } from '@/lib/client-navigation-guard';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { cn } from '@/lib/utils';
import { stepRequiresApproval } from '@/lib/runbooks/safety';
import { EmptyHint, Pill } from './ui/primitives';
import { RISK_META, STEP_CATALOG } from './builder/step-catalog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
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
import {
  normalizeConditionValue,
  conditionValueType,
  supportedConditionOperators,
} from '@/lib/runbooks/conditions';
import { rewriteInputReferences } from '@/lib/runbooks/input-references';
import { cloneStepRecursively, newBuilderStep } from '@/lib/runbooks/builder';
import { flattenSteps, referencedStepInputKeys } from '@/lib/runbooks/shared-definition';
import { ActionForm, FormSelect, SubmitButton, type RunbookFormAction } from './RunbookControls';

import StepNavigator, { getStepSummary } from './builder/StepNavigator';
import StepEditor from './builder/StepEditor';
import ReadinessBar from './builder/ReadinessBar';
import { validateRunbook } from './builder/validation';
import { JsonCodeEditor } from './builder/JsonCodeEditor';

function firstSchemaIssue(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): string | null {
  if (result.success) return null;
  const issues = result.error?.issues ?? [];
  const path = issues[0]?.path.map(String).join('.');
  const where = path ? ` at ${path}` : '';
  return `Does not match the runbook schema${where} (${issues.length || 1} issue${issues.length === 1 ? '' : 's'}). Apply to see details.`;
}

const validateDefinitionJson = (parsed: unknown) =>
  firstSchemaIssue(runbookDefinitionSchema.safeParse(parsed));
const validateInputsJson = (parsed: unknown) =>
  firstSchemaIssue(runbookInputsSchema.safeParse(parsed));

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

export { rewriteInputReferences as refactorInputReference } from '@/lib/runbooks/input-references';

export default function RunbookBuilder({
  initialDefinition,
  initialInputs,
  initialDraftRevision = 0,
  initialEditorTab = 'builder',
  initialStepIdentities,
  initialInputIdentities,
  action,
  readOnly = false,
}: {
  initialDefinition: RunbookDefinition;
  initialInputs: RunbookInputInput[];
  initialDraftRevision?: number;
  initialEditorTab?: string;
  initialStepIdentities?: string[];
  initialInputIdentities?: string[];
  action: RunbookFormAction;
  readOnly?: boolean;
}) {
  const editorSeed = useId();
  const [editor, setEditor] = useState({ definition: initialDefinition, inputs: initialInputs });
  const { definition, inputs } = editor;
  const setDefinition = (next: RunbookDefinition) =>
    setEditor(prev => ({ ...prev, definition: next }));
  const setInputs = (next: RunbookInputInput[]) => setEditor(prev => ({ ...prev, inputs: next }));
  const [pendingKeys, setPendingKeys] = useState<Map<string, string>>(new Map());
  const [renameErrors, setRenameErrors] = useState<Map<string, string>>(new Map());
  const [draftRevision, setDraftRevision] = useState(initialDraftRevision);
  const [stepIdentities, setStepIdentities] = useState<string[]>(
    () =>
      initialStepIdentities ??
      initialDefinition.steps.map((_, index) => `${editorSeed}-step-${index}`)
  );
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [initialIdentities] = useState(
    () => initialInputIdentities ?? initialInputs.map((_, index) => `${editorSeed}-input-${index}`)
  );
  const [inputIdentities, setInputIdentities] = useState<string[]>(initialIdentities);
  const [committedInputKeys, setCommittedInputKeys] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    initialInputs.forEach((inp, idx) => {
      map.set(initialIdentities.at(idx) ?? String(idx), inp.key);
    });
    return map;
  });
  const [dirty, setDirty] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [activeTab, setActiveTab] = useState(
    ['builder', 'inputs', 'advanced'].includes(initialEditorTab) ? initialEditorTab : 'builder'
  );
  const [advancedDefinition, setAdvancedDefinition] = useState(
    JSON.stringify(initialDefinition, null, 2)
  );
  const [advancedInputs, setAdvancedInputs] = useState(JSON.stringify(initialInputs, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [unappliedJson, setUnappliedJson] = useState(false);
  const bypassNavigationGuard = useRef(false);
  const [discardPrompt, setDiscardPrompt] = useState<{
    title: string;
    onConfirm: () => void;
  } | null>(null);

  // Compute live validation results
  const { stepErrors, inputErrors, generalInputErrors, errorCount } = useMemo(
    () => validateRunbook(definition, inputs),
    [definition, inputs]
  );

  useEffect(() => {
    if (!dirty && !unappliedJson && pendingKeys.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const guard = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !link ||
        bypassNavigationGuard.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        link.getAttribute('href')?.startsWith('#') ||
        link.getAttribute('target') === '_blank' ||
        link.hasAttribute('download')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setDiscardPrompt({
        title: 'Leave this draft and discard unsaved changes?',
        onConfirm: () => {
          // Replay the original link so its Next.js navigation behavior is preserved.
          window.removeEventListener('beforeunload', warn);
          bypassNavigationGuard.current = true;
          (link as HTMLAnchorElement).click();
          bypassNavigationGuard.current = false;
        },
      });
    };
    const unregisterHistoryGuard = registerNavigationGuard(resume => {
      setDiscardPrompt({
        title: 'Leave this draft and discard unsaved changes?',
        onConfirm: () => {
          window.removeEventListener('beforeunload', warn);
          resume();
        },
      });
    });
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guard, true);
    return () => {
      unregisterHistoryGuard();
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guard, true);
    };
  }, [dirty, unappliedJson, pendingKeys.size]);

  function commitInputKey(identity: string, index: number) {
    const nextKey = pendingKeys.get(identity)?.trim();
    if (nextKey === undefined) return;
    const occupied = inputs.some(
      (input, position) =>
        position !== index &&
        (input.key === nextKey ||
          pendingKeys.get(inputIdentities.at(position) ?? '')?.trim() === nextKey)
    );
    if (!/^[a-z0-9_]{1,80}$/.test(nextKey) || occupied) {
      setRenameErrors(prev =>
        new Map(prev).set(
          identity,
          occupied
            ? 'Another input already uses or is editing this key.'
            : 'Use 1–80 lowercase letters, numbers or underscores.'
        )
      );
      return;
    }
    setEditor(prev => {
      const current = prev.inputs.at(index);
      if (!current) return prev;
      return {
        definition: rewriteInputReferences(prev.definition, current.key, nextKey),
        inputs: prev.inputs.map((input, position) =>
          position === index ? { ...input, key: nextKey } : input
        ),
      };
    });
    setCommittedInputKeys(prev => new Map(prev).set(identity, nextKey));
    setPendingKeys(prev => {
      const next = new Map(prev);
      next.delete(identity);
      return next;
    });
    setRenameErrors(prev => {
      const next = new Map(prev);
      next.delete(identity);
      return next;
    });
    setDirty(true);
  }

  // Derive active index and selected step from stable selectedStepId
  const foundIndex = selectedStepId ? stepIdentities.indexOf(selectedStepId) : -1;
  const selectedStepIndex = foundIndex >= 0 ? foundIndex : definition.steps.length > 0 ? 0 : 0;
  const selectedStep = definition.steps.at(selectedStepIndex);
  const activeStepId = stepIdentities.at(selectedStepIndex) ?? selectedStep?.key ?? 'active-step';

  function handleSelectStep(index: number) {
    setMobileEditorOpen(true);
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

  useEffect(() => {
    if (selectedStepId) document.getElementById(`step-heading-${selectedStepId}`)?.focus();
  }, [selectedStepId]);

  const selectedCatalog = selectedStep ? STEP_CATALOG[selectedStep.type] : null;
  const selectedRisk = selectedStep ? RISK_META[selectedStep.riskClass] : null;

  const builderView = (
    <div className="space-y-4 pb-32">
      <ReadinessBar
        definition={definition}
        errorCount={errorCount}
        stepErrors={stepErrors}
        inputErrors={inputErrors}
        generalInputErrors={generalInputErrors}
        onNavigateToStep={handleNavigateToStep}
        onNavigateToInputs={handleNavigateToInputs}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-6">
        <div
          className={cn(
            'min-w-0 md:col-span-5 lg:col-span-4 xl:col-span-3',
            mobileEditorOpen ? 'hidden md:block' : 'block'
          )}
        >
          <div className="md:sticky md:top-4">
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
            <details className="group mt-3 hidden px-1 text-xs text-muted-foreground md:block">
              <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                How this works
              </summary>
              <p className="mt-1.5 pl-5 leading-relaxed">
                Steps run strictly top to bottom. Anything that changes a system needs a safe-write
                classification or approval, and Agent policy on the host always has the final say.
              </p>
            </details>
          </div>
        </div>

        <div
          className={cn(
            'min-w-0 md:col-span-7 lg:col-span-8 xl:col-span-9',
            mobileEditorOpen ? 'block' : 'hidden md:block'
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-3 min-h-11 gap-1.5 md:hidden"
            onClick={() => setMobileEditorOpen(false)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to steps
          </Button>
          {selectedStep && selectedCatalog && selectedRisk ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                    <selectedCatalog.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      id={`step-heading-${activeStepId}`}
                      tabIndex={-1}
                      className="break-words !text-lg !leading-snug font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Step {selectedStepIndex + 1}: {selectedStep.name || 'Untitled step'}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {selectedCatalog.label} ·{' '}
                        <span className="font-mono">{selectedStep.key}</span> · step{' '}
                        <span className="tabular-nums">{selectedStepIndex + 1}</span> of{' '}
                        <span className="tabular-nums">{definition.steps.length}</span>
                      </p>
                      {getStepSummary(selectedStep) && (
                        <span className="rounded-md border border-border/70 bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground">
                          {getStepSummary(selectedStep)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={selectedRisk.tone}>{selectedRisk.label}</Pill>
                  {stepRequiresApproval(selectedStep) && (
                    <Pill tone="warning" icon={Lock}>
                      Approval
                    </Pill>
                  )}
                </div>
              </div>

              <StepEditor
                key={activeStepId}
                step={selectedStep}
                inputs={inputs}
                editorId={activeStepId}
                depth={1}
                expandedChecks={expandedChecks}
                onToggleCheck={(key, open) =>
                  setExpandedChecks(prev => {
                    if (prev.has(key) === open) return prev;
                    const next = new Set(prev);
                    if (open) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
                errors={stepErrors.get(selectedStepIndex) ?? {}}
                readOnly={readOnly}
                onChange={patch => updateStep(selectedStepIndex, patch)}
              />
            </div>
          ) : (
            <EmptyHint
              icon={ListOrdered}
              title="No step selected"
              description="Pick a step on the left to edit its action, safety settings and checks."
            />
          )}
        </div>
      </div>
    </div>
  );

  const inputEditor = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Inputs let one runbook work across services. Responders fill them in at launch, service
        rules can bind them, and steps reference them as{' '}
        <code className="rounded bg-muted px-1 font-mono text-xs">{'${{ inputs.key }}'}</code>.
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
          const nextInputs = inputs.map((item, position) =>
            position === index ? { ...item, ...patch } : item
          );
          let nextDefinition = definition;
          if (patch.type && patch.type !== input.type) {
            const normalize = (step: RunbookStepDefinition): RunbookStepDefinition => {
              let config = step.config;
              if (
                step.type === 'CONDITION' &&
                [`input.${input.key}`, `inputs.${input.key}`].includes(String(config.field))
              ) {
                const previousType = conditionValueType(String(config.field), inputs);
                const nextType = conditionValueType(String(config.field), nextInputs);
                const operator = supportedConditionOperators(nextType).includes(
                  String(config.operator)
                )
                  ? String(config.operator)
                  : 'EQUALS';
                config = {
                  ...config,
                  operator,
                  value: normalizeConditionValue({
                    previousValue: config.value,
                    previousType,
                    nextType,
                    operator,
                  }),
                };
              }
              return {
                ...step,
                config,
                ...(step.precheck
                  ? { precheck: { ...step.precheck, steps: step.precheck.steps.map(normalize) } }
                  : {}),
                ...(step.verification
                  ? {
                      verification: {
                        ...step.verification,
                        steps: step.verification.steps.map(normalize),
                      },
                    }
                  : {}),
              };
            };
            nextDefinition = { ...definition, steps: definition.steps.map(normalize) };
          }
          setEditor({ definition: nextDefinition, inputs: nextInputs });
          if (!unappliedJson) {
            setAdvancedDefinition(JSON.stringify(nextDefinition, null, 2));
            setAdvancedInputs(JSON.stringify(nextInputs, null, 2));
          }
          setDirty(true);
        };
        const currentErrors = inputErrors.get(index);
        return (
          <fieldset
            key={inputIdentities.at(index) ?? index}
            disabled={readOnly}
            className="grid min-w-0 gap-4 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs sm:grid-cols-2"
          >
            <legend className="float-left mb-1 flex w-full flex-wrap items-center gap-2 text-sm font-semibold sm:col-span-2">
              <span>
                Input {index + 1}: {input.label || input.key}
              </span>
              <code className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                {'${{ inputs.'}
                {input.key}
                {' }}'}
              </code>
              {input.required && <Pill tone="warning">required</Pill>}
            </legend>
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input
                aria-label={`Input ${index + 1} key`}
                value={pendingKeys.get(identity) ?? input.key}
                disabled={readOnly}
                onChange={e => {
                  setPendingKeys(prev => new Map(prev).set(identity, e.target.value));
                  setDirty(true);
                }}
                onBlur={() => commitInputKey(identity, index)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitInputKey(identity, index);
                  }
                }}
                className={
                  renameErrors.has(identity) || currentErrors?.key ? 'border-destructive' : ''
                }
              />
              {renameErrors.has(identity) && (
                <p role="alert" className="text-xs text-destructive">
                  {renameErrors.get(identity)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Rename applies on blur or Enter. References change together.
              </p>
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
                onValueChange={v =>
                  update({
                    type: v as RunbookInputInput['type'],
                    options: v === 'SELECT' ? (input.options ?? []) : undefined,
                  })
                }
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
                onChange={e => update({ defaultValue: e.target.value })}
              />
            </div>
            {input.type === 'SELECT' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`input-options-${identity}`}>Options · one per line</Label>
                <Textarea
                  id={`input-options-${identity}`}
                  aria-label={`Input ${index + 1} options`}
                  value={(input.options ?? []).join('\n')}
                  disabled={readOnly}
                  rows={Math.min(8, Math.max(3, (input.options?.length ?? 0) + 1))}
                  onChange={e =>
                    update({
                      options: e.target.value
                        .split('\n')
                        .map(option => option.trim())
                        .filter(Boolean),
                    })
                  }
                  className={cn(
                    'font-mono text-xs',
                    currentErrors?.options && 'border-destructive'
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Responders choose one of these values. The default must match an option.
                </p>
                {currentErrors?.options && (
                  <p className="text-xs text-destructive">{currentErrors.options}</p>
                )}
              </div>
            )}
            {currentErrors?.general && (
              <p role="alert" className="text-xs text-destructive sm:col-span-2">
                {currentErrors.general}
              </p>
            )}
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
                    setPendingKeys(prev => {
                      const next = new Map(prev);
                      next.delete(identity);
                      return next;
                    });
                    setRenameErrors(prev => {
                      const next = new Map(prev);
                      next.delete(identity);
                      return next;
                    });
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
                  Referenced by <strong>{usage.stepNames.join(', ')}</strong>. Remove references
                  from those steps before deleting this parameter.
                </span>
              </div>
            )}
          </fieldset>
        );
      })}

      {inputs.length === 0 && (
        <EmptyHint
          icon={SlidersHorizontal}
          title="No inputs yet"
          description="Add typed inputs to reuse this workflow across services, environments and incidents."
        />
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs font-semibold"
          onClick={() => {
            const reserved = [
              ...inputs,
              ...inputs.map((input, index) => ({
                ...input,
                key: pendingKeys.get(inputIdentities.at(index) ?? '') ?? input.key,
              })),
            ];
            const nextKey = getNextUnusedInputKey(reserved, definition);
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

  function refreshAdvancedJson() {
    setAdvancedDefinition(JSON.stringify(definition, null, 2));
    setAdvancedInputs(JSON.stringify(inputs, null, 2));
    setJsonError('');
    setUnappliedJson(false);
  }

  function applyAdvancedJson() {
    try {
      const parsedDefinition = runbookDefinitionSchema.parse(JSON.parse(advancedDefinition));
      const parsedInputs = runbookInputsSchema.parse(JSON.parse(advancedInputs));
      setEditor({
        definition: parsedDefinition as RunbookDefinition,
        inputs: parsedInputs,
      });
      setPendingKeys(new Map());
      setRenameErrors(new Map());
      const newIds = parsedDefinition.steps.map(
        step =>
          stepIdentities[definition.steps.findIndex(existing => existing.key === step.key)] ??
          crypto.randomUUID()
      );
      setStepIdentities(newIds);
      setSelectedStepId(
        selectedStepId && newIds.includes(selectedStepId) ? selectedStepId : (newIds.at(0) ?? null)
      );
      const newInputIds = parsedInputs.map(
        input =>
          inputIdentities[inputs.findIndex(existing => existing.key === input.key)] ??
          crypto.randomUUID()
      );
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
  }

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
            Click <strong>Apply JSON to builder</strong> to overwrite visual edits with the JSON
            above, or click <strong>Refresh JSON from builder</strong> to discard unapplied JSON
            edits.
          </p>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => {
          if (unappliedJson) {
            setDiscardPrompt({
              title: 'Discard unapplied JSON changes?',
              onConfirm: refreshAdvancedJson,
            });
          } else refreshAdvancedJson();
        }}
      >
        Refresh JSON from builder
      </Button>

      <JsonCodeEditor
        label="Definition JSON"
        value={advancedDefinition}
        onChange={next => {
          setAdvancedDefinition(next);
          setUnappliedJson(true);
        }}
        readOnly={readOnly}
        minRows={18}
        validate={validateDefinitionJson}
      />

      <JsonCodeEditor
        label="Typed inputs JSON"
        value={advancedInputs}
        onChange={next => {
          setAdvancedInputs(next);
          setUnappliedJson(true);
        }}
        readOnly={readOnly}
        minRows={8}
        validate={validateInputsJson}
      />

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs font-semibold"
          onClick={() => {
            if (unappliedJson && dirty) {
              setDiscardPrompt({
                title: 'Replace the visual draft with this JSON?',
                onConfirm: applyAdvancedJson,
              });
            } else applyAdvancedJson();
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
      successMessage="Draft saved"
      className="space-y-6 max-sm:[&_input]:min-h-11 max-sm:[&_button]:min-h-11 max-sm:[&_[role=combobox]]:min-h-11"
      onSuccess={result => {
        setDirty(false);
        if (typeof result?.draftRevision === 'number') {
          setDraftRevision(result.draftRevision);
        }
      }}
    >
      <AlertDialog
        open={discardPrompt !== null}
        onOpenChange={open => {
          if (!open) setDiscardPrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{discardPrompt?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved edits will be discarded. Choose Keep editing to preserve them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const confirm = discardPrompt?.onConfirm;
                setDiscardPrompt(null);
                confirm?.();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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
          {
            id: 'inputs',
            label: 'Inputs',
            icon: <SlidersHorizontal className="h-4 w-4" />,
            count: inputs.length,
            content: inputEditor,
          },
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
        <div className="sticky bottom-0 z-20 rounded-2xl border border-border/80 dark:border-border/60 bg-background/95 dark:bg-background/80 px-5 py-3.5 shadow-lg backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span aria-live="polite" className="inline-flex items-center gap-1.5 font-medium">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-2 rounded-full',
                    unappliedJson || dirty ? 'bg-amber-500' : 'bg-emerald-500'
                  )}
                />
                {unappliedJson ? 'Unapplied JSON' : dirty ? 'Unsaved changes' : 'Saved draft'}
              </span>
              <span className="tabular-nums text-muted-foreground">Revision {draftRevision}</span>
              {validationMessage && (
                <p role="status" className="text-muted-foreground">
                  {validationMessage}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 max-sm:w-full">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-sm:flex-1"
                onClick={() => {
                  if (errorCount > 0) {
                    const firstStepWithIssue = [...stepErrors.keys()].sort((a, b) => a - b).at(0);
                    if (firstStepWithIssue !== undefined) handleNavigateToStep(firstStepWithIssue);
                    else handleNavigateToInputs();
                  }
                  setValidationMessage(
                    errorCount > 0
                      ? `${errorCount} ${errorCount === 1 ? 'issue needs' : 'issues need'} fixing before you can save.`
                      : 'All checks pass. Validation doesn’t run actions or check live Agent policy.'
                  );
                }}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Validate draft
              </Button>
              <SubmitButton
                size="sm"
                className="max-sm:flex-1"
                pendingLabel="Saving draft…"
                disabled={unappliedJson || pendingKeys.size > 0 || errorCount > 0}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save draft
              </SubmitButton>
            </div>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
